import contextlib
from pathlib import Path
import tempfile
import unittest
from urllib.error import URLError

from bridge import Api, Queue, payload_for, poll_chat, scope_key, stage_recent


class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / 'queue.sqlite'
        self.queue = Queue(self.path)
        self.contact = {'id': 'class-group', 'name': '测试班群'}
        self.message = {'id': '1', 'type': 'text', 'content': '请明天提交材料',
                        'sender': '测试老师', 'timestamp_epoch': 1794225600, 'is_self': False, 'sort_seq': 10}

    def tearDown(self):
        self.queue.db.close()
        self.temp.cleanup()

    def test_filters_and_utc(self):
        payload = payload_for('a', self.contact, self.message)
        self.assertTrue(payload['sentAt'].endswith('Z'))
        self.assertIsNone(payload_for('a', self.contact, {**self.message, 'is_self': True}))
        self.assertIsNotNone(payload_for('a', {'id': 'filehelper', 'name': '文件传输助手'},
                                        {**self.message, 'is_self': True}))
        self.assertIsNone(payload_for('a', self.contact, {**self.message, 'type': '图片'}))

    def test_backfill_preserves_cursor_and_imports_card_metadata(self):
        contact = {**self.contact, 'type': 'group'}
        rows = [self.message, {**self.message, 'id': '2', 'sort_seq': 11, 'is_self': True,
                               'type': '文件/链接/卡片',
                               'content': '<msg><appmsg><title>材料.docx</title><type>6</type></appmsg></msg>'}]
        class FakeClient:
            def get_messages(self, contact, limit):
                return rows
        origin = 'https://classflow.example'
        scope = scope_key(origin, 'a', contact['id'])
        self.queue.stage(scope, 9, [])
        self.assertEqual(stage_recent(FakeClient(), self.queue, origin, 'a', contact, 1794225600), 2)
        self.assertEqual(self.queue.cursor(scope), 9)
        self.assertEqual(payload_for('a', contact, rows[1])['text'], '[微信文件] 材料.docx')
        self.assertEqual(payload_for('a', contact, rows[1])['format'], 'card')

    def test_queue_survives_failure_restart_and_limits_scope(self):
        payload = payload_for('a', self.contact, self.message)
        self.queue.stage('allowed', 10, [payload])
        self.queue.stage('other', 10, [payload])
        class Offline:
            def post(self, *args):
                raise URLError('offline')
        with self.assertRaises(URLError):
            self.queue.flush(Offline(), ['allowed'])
        self.queue.db.close()
        self.queue = Queue(self.path)
        self.assertEqual(self.queue.cursor('allowed'), 10)
        class Online:
            def post(self, path, body):
                return {'status': 'duplicate', 'taskCount': 0}
        self.assertEqual(self.queue.flush(Online(), ['allowed'])['duplicate'], 1)
        self.assertEqual(self.queue.db.execute('SELECT scope FROM outbox').fetchall(), [('other',)])

    def test_baseline_and_atomic_cursor(self):
        contact, message = self.contact, self.message
        class FakeClient:
            lock = contextlib.nullcontext()
            def latest_seq(self, c):
                return 9
            def get_new_messages(self, user, since_seq, limit):
                return [message]
            def normalize(self, c, row):
                return row
        client = FakeClient()
        client.db = client
        scope = poll_chat(client, self.queue, 'https://classflow.example', 'account', contact)
        self.assertEqual(self.queue.cursor(scope), 9)
        self.assertEqual(self.queue.db.execute('SELECT COUNT(*) FROM outbox').fetchone()[0], 0)
        poll_chat(client, self.queue, 'https://classflow.example', 'account', contact)
        self.assertEqual(self.queue.cursor(scope), 10)
        self.assertEqual(self.queue.db.execute('SELECT COUNT(*) FROM outbox').fetchone()[0], 1)
        with self.assertRaises(TypeError):
            self.queue.stage(scope, 11, [{'messageId': 'bad', 'text': object()}])
        self.assertEqual(self.queue.cursor(scope), 10)

    def test_origin_validation_and_scope_isolation(self):
        for origin in ['http://example.com', 'https://user:secret@example.com',
                       'https://example.com/path', 'file:///tmp/x', 'https://example.com?x=1']:
            with self.assertRaises(ValueError):
                Api(origin)
        Api('http://127.0.0.1:5174')
        self.assertNotEqual(scope_key('https://one', 'a', 'c'), scope_key('https://two', 'a', 'c'))
        self.assertNotEqual(scope_key('https://one', 'a', 'c'), scope_key('https://one', 'b', 'c'))


if __name__ == '__main__':
    unittest.main()
