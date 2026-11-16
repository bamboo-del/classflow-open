import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp } from '../../apps/api/src/app.js';
import { settings } from '../../apps/api/src/config.js';
import { provision } from '../../tests/auth-fixture.js';

const root = resolve('data/qa');
mkdirSync(root, { recursive: true });
const directory = mkdtempSync(resolve(root, 'wechat-http-'));
const config = settings({ CLASSFLOW_ORIGIN: 'http://127.0.0.1:1' });
const app = createApp(directory, config);
try {
  const credentials = await provision(directory);
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  config.origin.port = new URL(address).port;
  const result = await new Promise<string>((done, fail) => {
    const child = spawn(process.env.PYTHON ?? 'python', ['-c', `
import json, sys
from bridge import Api
data = json.load(sys.stdin)
api = Api(data['origin'])
api.post('auth/login', data['credentials'])
message = {'account':'http-test','chatId':'test','chatName':'HTTP test',
           'messageId':'1','sender':'teacher','sentAt':'2026-11-09T00:00:00Z',
           'text':'\\u8bf7\\u660e\\u592918:00\\u63d0\\u4ea4\\u6750\\u6599'}
first = api.post('integrations/wechat/messages', message)
second = api.post('integrations/wechat/messages', message)
assert first['taskCount'] == 1 and second['status'] == 'duplicate'
print('PYTHON_FASTIFY_HTTP_OK')
`], { cwd: resolve('tools/wechat'), stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', () => {});
    child.once('error', fail);
    child.once('exit', (code) => code === 0 ? done(output) : fail(new Error('Python HTTP integration failed: ' + code)));
    child.stdin.end(JSON.stringify({ origin: address, credentials }));
  });
  assert.match(result, /PYTHON_FASTIFY_HTTP_OK/);
  console.log('Python connector → real Fastify HTTP: login cookie, origin guard, task creation and deduplication passed.');
} finally {
  await app.close();
}
