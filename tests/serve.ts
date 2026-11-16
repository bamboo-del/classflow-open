import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createServer } from 'vite';
import { createApp } from '../apps/api/src/app.js';
import { provision } from './auth-fixture.js';

// 每次验收独立目录。即使测试进程被强行终止，也不会接触个人数据库。
const root = resolve('data', 'qa');
mkdirSync(root, { recursive: true });
const directory = mkdtempSync(join(root, 'run-'));
process.env.CLASSFLOW_ORIGIN = 'http://127.0.0.1:4273';
if (!process.env.CLASSFLOW_QA_PASSWORD) throw new Error('缺少运行时测试凭证');
await provision(directory, process.env.CLASSFLOW_QA_PASSWORD);
const api = createApp(directory);
await api.listen({ host: '127.0.0.1', port: 4274 });
process.env.CLASSFLOW_PORT = '4274';
const web = await createServer({ root: resolve('apps/web'), server: { port: 4273, strictPort: true } });
await web.listen();
async function close() {
  await web.close();
  await api.close();
  rmSync(directory, { recursive: true, force: true });
}
process.once('SIGINT', close);
process.once('SIGTERM', close);
