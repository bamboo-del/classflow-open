import { randomUUID } from 'node:crypto';
import { mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { dataDirectory } from './config.js';
import { makeWechatAi } from './wechat-ai.js';

const [endpoint, model, ...groups] = process.argv.slice(2);
if (!endpoint || !model || !groups.length || !process.stdin.isTTY) {
  console.error('用法：wechat-ai-config <完整 HTTPS 接口> <模型> <群名> [群名...]。请使用交互式终端。');
  process.exit(1);
}

async function readKey() {
  const silent = new Writable({ write(_chunk, _encoding, done) { done(); } });
  const terminal = createInterface({ input: process.stdin, output: silent, terminal: true });
  const cancel = new AbortController();
  terminal.once('SIGINT', () => cancel.abort());
  try {
    process.stderr.write('AI API Key（不回显）：');
    return (await terminal.question('', { signal: cancel.signal })).trim();
  } finally {
    terminal.close();
    process.stderr.write('\n');
  }
}

try {
  const config = { endpoint, model, groups, apiKey: await readKey() };
  const ai = makeWechatAi(config);
  const sample = await ai.analyze({ notice: {
    id: randomUUID(), receivedAt: new Date().toISOString(), notes: '',
    original: '各团支部请于明天18:00前交齐团日活动记录。',
  }, context: [] }, AbortSignal.timeout(50000));
  if (sample.tasks.length !== 1) throw new Error('合成样例未生成可核验的待办');
  const dir = dataDirectory();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const target = join(dir, 'wechat-ai.local.json');
  const staging = target + '.' + randomUUID();
  writeFileSync(staging, JSON.stringify(config), { mode: 0o600, flag: 'wx' });
  try { renameSync(staging, target); }
  catch (error) { unlinkSync(staging); throw error; }
  console.log('合成消息验收通过。重启 ClassFlow 后启用微信 AI。');
} catch {
  console.error('配置未保存。请检查接口、模型、密钥或服务方是否支持 JSON 输出。');
  process.exitCode = 1;
}
