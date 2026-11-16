"""Read selected chats through the existing local assistant; never send WeChat messages."""
import argparse
import contextlib
from datetime import datetime, timedelta, timezone
import getpass
import hashlib
from http.client import HTTPConnection, HTTPSConnection, HTTPException
from http.cookies import SimpleCookie
import io
import json
import os
from pathlib import Path
import sqlite3
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from xml.etree import ElementTree

ROOT = Path(__file__).resolve().parents[2]


class Api:
    def __init__(self, origin, proxy=None):
        url = urlsplit(origin)
        if (url.username or url.password or url.query or url.fragment or url.path
                or url.scheme not in ('https', 'http') or not url.netloc
                or (url.scheme == 'http' and url.hostname not in ('127.0.0.1', 'localhost'))):
            raise ValueError('origin must be HTTPS or loopback HTTP, without path or credentials')
        self.origin = origin
        self.url = url
        self.proxy = None
        self.connection = None
        self.cookie = None
        if proxy:
            local = urlsplit(proxy)
            if (url.scheme != 'https' or local.scheme != 'http' or local.hostname not in ('localhost', '127.0.0.1')
                    or not local.port or local.username or local.password or local.path or local.query or local.fragment):
                raise ValueError('Expected an HTTP proxy on localhost for the HTTPS destination')
            self.proxy = local

    def _connect(self, proxy):
        connection_cls = HTTPSConnection if self.url.scheme == 'https' else HTTPConnection
        address = proxy or self.url
        connection = connection_cls(address.hostname, address.port, timeout=10)
        if proxy:
            connection.set_tunnel(self.url.hostname, self.url.port or 443)
        return connection

    def post(self, path, payload):
        return self._request('POST', path, json.dumps(payload, ensure_ascii=False).encode('utf-8'))

    def _request(self, method, path, body=None):
        path = '/api/' + path
        headers = {'Host': self.url.netloc, 'Origin': self.origin, 'X-ClassFlow-Request': '1'}
        if body is not None:
            headers['Content-Type'] = 'application/json'
        if self.cookie:
            headers['Cookie'] = self.cookie
        for attempt, proxy in enumerate((self.proxy, None)):
            if self.connection is None:
                self.connection = self._connect(proxy)
            try:
                self.connection.request(method, path, body, headers)
                response = self.connection.getresponse()
                raw = response.read()
            except (OSError, HTTPException) as error:
                self.connection.close()
                self.connection = None
                if attempt:
                    raise URLError(error) from error
                continue
            if not 200 <= response.status < 300:
                raise HTTPError(self.origin + path, response.status, response.reason, response.headers, None)
            if path == '/api/auth/login':
                key = '__Host-classflow' if self.url.scheme == 'https' else 'classflow_dev'
                cookie = SimpleCookie(response.getheader('Set-Cookie', ''))
                self.cookie = f'{key}={cookie[key].coded_value}' if key in cookie else None
            return json.loads(raw) if raw else {}


class Queue:
    def __init__(self, path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path)
        self.db.executescript('''
            CREATE TABLE IF NOT EXISTS cursors (scope TEXT PRIMARY KEY, seq INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY, scope TEXT NOT NULL, body TEXT NOT NULL);
        ''')

    def cursor(self, scope):
        row = self.db.execute('SELECT seq FROM cursors WHERE scope=?', (scope,)).fetchone()
        return row[0] if row else None

    def stage(self, scope, sequence, payloads):
        with self.db:
            for payload in payloads:
                key = hashlib.sha256(json.dumps([scope, payload['messageId']]).encode()).hexdigest()
                self.db.execute('INSERT OR IGNORE INTO outbox VALUES (?,?,?)',
                                (key, scope, json.dumps(payload, ensure_ascii=False)))
            self.db.execute('INSERT INTO cursors VALUES (?,?) ON CONFLICT(scope) DO UPDATE SET seq=MAX(seq,excluded.seq)',
                            (scope, sequence))

    def flush(self, api, allowed_scopes):
        counts = {'created': 0, 'duplicate': 0, 'ignored': 0, 'tasks': 0}
        for scope in allowed_scopes:
            rows = self.db.execute('SELECT id,body FROM outbox WHERE scope=? ORDER BY rowid', (scope,)).fetchall()
            for key, body in rows:
                result = api.post('integrations/wechat/messages', json.loads(body))
                if result.get('status') not in ('created', 'duplicate', 'ignored'):
                    raise ValueError('Unexpected API response; message retained')
                with self.db:
                    self.db.execute('DELETE FROM outbox WHERE id=?', (key,))
                counts[result['status']] += 1
                counts['tasks'] += result.get('taskCount', 0)
        return counts


def scope_key(origin, account, chat_id):
    return hashlib.sha256(json.dumps([origin, account, chat_id]).encode()).hexdigest()


def payload_for(account, contact, message):
    # Forwarding to File Transfer Assistant is a supported personal inbox.
    group = contact.get('type') == 'group'
    if message['is_self'] and not group and contact['id'] != 'filehelper':
        return None
    text = message['content']
    if message['type'] == 'text' and text.strip():
        content = {'text': text}
    elif group and message['type'] == '文件/链接/卡片':
        label = '[微信卡片]'
        title, description, url = '', '', ''
        markup = text[text.find('<'):] if '<' in text else ''
        if len(markup) <= 200000 and '<!DOCTYPE' not in markup and '<!ENTITY' not in markup:
            try:
                root = ElementTree.fromstring(markup)
                card = root if root.tag == 'appmsg' else root.find('appmsg')
                if card is not None:
                    label = {'6': '[微信文件]', '57': '[引用回复]'}.get(card.findtext('type'), label)
                    title = (card.findtext('title') or '').strip()[:4000]
                    description = (card.findtext('des') or '').strip()[:4000]
                    url = (card.findtext('url') or '').strip()[:1500]
            except ElementTree.ParseError:
                pass
        if label == '[引用回复]' and title:
            # The title is the new reply. Do not import the quoted message body.
            content = {'text': title}
        else:
            content = {'format': 'card', 'text': '\n'.join(x for x in [f'{label} {title}'.strip(), description, url] if x)}
    else:
        return None
    return {'account': account, 'chatId': contact['id'], 'chatName': contact['name'],
            'messageId': message['id'], 'sender': message['sender'], **content,
            'sentAt': datetime.fromtimestamp(message['timestamp_epoch'], timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')}


def poll_chat(client, queue, origin, account, contact):
    scope = scope_key(origin, account, contact['id'])
    since = queue.cursor(scope)
    if since is None:
        queue.stage(scope, client.latest_seq(contact), [])
        return scope  # First connection establishes a baseline, never imports old history.
    with client.lock:
        raw = client.db.get_new_messages(contact['id'], since_seq=since, limit=200)
        rows = [client.normalize(contact, row) for row in raw]
    if rows:
        payloads = [p for row in rows if (p := payload_for(account, contact, row)) is not None]
        queue.stage(scope, max(row['sort_seq'] for row in rows), payloads)
    return scope


def stage_recent(client, queue, origin, account, contact, cutoff):
    rows = [m for m in client.get_messages(contact, 100) if m['timestamp_epoch'] >= cutoff]
    payloads = [p for row in rows if (p := payload_for(account, contact, row)) is not None]
    if rows:
        scope = scope_key(origin, account, contact['id'])
        cursor = queue.cursor(scope)
        queue.stage(scope, cursor if cursor is not None else max(row['sort_seq'] for row in rows), payloads)
    return len(payloads)


def main():
    parser = argparse.ArgumentParser(description='ClassFlow 微信只读连接器')
    parser.add_argument('--config', default=str(Path(__file__).with_name('wechat.local.json')))
    parser.add_argument('--credentials-file', type=Path, help='后台模式：读取本机已有的 ClassFlow 登录 JSON')
    parser.add_argument('--log-file', type=Path, help='将状态写入指定的本机日志')
    parser.add_argument('--check', action='store_true', help='只检查助手与微信进程，不读聊天')
    parser.add_argument('--once', action='store_true', help='只同步一轮；首次只建立水位')
    parser.add_argument('--backfill', action='store_true', help='补录指定群最近100条中属于过去7天的消息')
    args = parser.parse_args()
    if args.log_file:
        args.log_file.parent.mkdir(parents=True, exist_ok=True)
        sys.stdout = sys.stderr = args.log_file.open('a', encoding='utf-8', buffering=1)
        print('启动 ' + datetime.now().astimezone().isoformat(timespec='seconds'))
    if args.credentials_file:
        args.credentials_file = args.credentials_file.resolve()
    cfg = json.loads(Path(args.config).read_text(encoding='utf-8-sig'))
    assistant = Path(cfg['assistantRoot']).resolve()
    if not (assistant / 'app/wechat/client.py').is_file():
        raise ValueError('Configured local WeChat assistant is missing')
    sys.path.insert(0, str(assistant))
    os.chdir(assistant)
    from app.wechat.client import WeChatClient, process_status
    from app.config import load_config
    status = process_status()
    if args.check:
        print(json.dumps({'assistant': True, 'wechatRunning': status['running'], 'version': status['version']}, ensure_ascii=False))
        return
    contacts = cfg.get('contacts', [])
    if not contacts or not all(isinstance(c, str) and c.strip() for c in contacts):
        raise ValueError('Specify exact allowed contacts in wechat.local.json first')
    api = Api(cfg['origin'], cfg.get('proxy'))
    if args.credentials_file:
        def login():
            saved = json.loads(args.credentials_file.read_text(encoding='utf-8-sig'))
            api.post('auth/login', {'username': saved['username'], 'password': saved['password']})
    else:
        credentials = {'username': input('ClassFlow 用户名: ').strip(),
                       'password': getpass.getpass('ClassFlow 密码（不保存）: ')}
        def login():
            api.post('auth/login', credentials)
    state_dir = ROOT / 'data/wechat'
    state_dir.mkdir(parents=True, exist_ok=True)
    # Prevent two connectors from racing on initial baselines or the same SQLite queue.
    import msvcrt
    with (state_dir / 'bridge.lock').open('a+b') as lock:
        lock.seek(0)
        if not lock.read(1):
            lock.write(b'0'); lock.flush()
        lock.seek(0)
        msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        queue = Queue(state_dir / 'queue.sqlite')
        try:
            # A scheduled run can begin before the desktop client is logged in.
            waiting = False
            while True:
                status = process_status()
                if status['running'] and status['version'] != cfg['wechatVersion']:
                    raise ValueError('WeChat version changed; revalidate compatibility before connecting')
                try:
                    if status['running']:
                        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                            client = WeChatClient(load_config()).connect()
                        break
                except Exception:
                    if args.once or not args.credentials_file:
                        raise
                if args.once or not args.credentials_file:
                    raise ValueError('Open and log into desktop WeChat first')
                if not waiting:
                    print('等待电脑微信登录。')
                    waiting = True
                time.sleep(15)
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                selected = [client.resolve(name) for name in contacts]
            account = client.db.wxid
            scopes = [scope_key(api.origin, account, c['id']) for c in selected]
            print('已连接指定会话；首次仅建立水位。Ctrl+C 停止。')
            if args.backfill:
                cutoff = (datetime.now(timezone.utc) - timedelta(days=7)).timestamp()
                with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                    counts = [stage_recent(client, queue, api.origin, account, c, cutoff) for c in selected]
                print(json.dumps({'backfill': counts}, ensure_ascii=False))
            logged_in = False
            last_status = None
            while True:
                if process_status()['version'] != cfg['wechatVersion']:
                    raise ValueError('WeChat stopped or changed version; connector stopped')
                with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                    for contact in selected:
                        poll_chat(client, queue, api.origin, account, contact)
                try:
                    if not logged_in:
                        login()
                        logged_in = True
                    counts = queue.flush(api, scopes)
                    if last_status != 'ok' or any(counts.values()):
                        print(json.dumps({'status': 'ok', **counts}, ensure_ascii=False))
                    last_status = 'ok'
                except HTTPError as error:
                    if error.code == 401 and logged_in:
                        logged_in = False  # The next iteration signs in again after session expiry.
                        if args.once:
                            return 1
                        continue
                    if last_status != error.code:
                        print(f'HTTP {error.code}，消息已在本机排队。')
                    last_status = error.code
                except (URLError, TimeoutError):
                    if last_status != 'offline':
                        print('连接暂时失败，消息已在本机排队。')
                    last_status = 'offline'
                if args.once:
                    return 0 if last_status == 'ok' else 1
                time.sleep(5 if last_status == 'ok' else 30)
        finally:
            queue.db.close()


if __name__ == '__main__':
    try:
        sys.exit(main() or 0)
    except (KeyboardInterrupt, EOFError):
        print('已停止；未发送任何微信消息。')
        sys.exit(130)
    except Exception as error:
        # Do not log bodies, credentials, account identifiers or third-party exception details.
        print(f'连接器停止（{type(error).__name__}）。请检查会话名单、微信登录/版本、路径和 ClassFlow 登录。')
        sys.exit(1)
