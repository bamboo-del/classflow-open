import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { openAuth } from './auth-store.js';
import { dataDirectory } from './config.js';

async function password() {
  if (!process.stdin.isTTY || !process.stderr.isTTY) throw new Error('请使用交互式终端，密码不会回显。');
  const silent = new Writable({
    write(_chunk, _encoding, done) {
      done();
    },
  });
  const rl = createInterface({ input: process.stdin, output: silent, terminal: true });
  const cancel = new AbortController();
  rl.once('SIGINT', () => cancel.abort());
  try {
    process.stderr.write('新密码（12–256 个字符，不回显） ');
    const first = await rl.question('', { signal: cancel.signal });
    process.stderr.write('\n再次输入 ');
    const second = await rl.question('', { signal: cancel.signal });
    if (first !== second) throw new Error('两次密码不同。');
    return first;
  } finally {
    rl.close();
    process.stderr.write('\n');
  }
}
async function readSecret() {
  if (process.stdin.isTTY) throw new Error('标准输入模式仅接受安全管道');
  let value = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) {
    value += chunk;
    if (value.length > 258) throw new Error('输入过长');
  }
  value = value.replace(/\r?\n$/, '');
  if (/[\r\n]/.test(value)) throw new Error('需要一行密码');
  return value;
}
process.umask(0o077);
const [mode, username, ...extra] = process.argv.slice(2);
try {
  const piped = extra.length === 1 && extra[0] === '--password-stdin';
  if ((mode !== 'init' && mode !== 'reset') || !username || (extra.length && !piped))
    throw new Error('用法：admin init|reset <账号名> [--password-stdin]');
  const secret = piped ? await readSecret() : await password();
  if (secret.length < 12 || secret.length > 256) throw new Error('密码长度须为 12–256。');
  const auth = openAuth(dataDirectory());
  try {
    await auth.configure(mode, username, secret);
  } finally {
    auth.close();
  }
  console.log(mode === 'init' ? '管理员已初始化。' : '密码已重置，原会话已撤销。');
} catch (e) {
  console.error(e instanceof Error ? e.message : '操作失败');
  process.exitCode = 1;
}
