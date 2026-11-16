import test from 'node:test';
import { provision, browserHeaders } from './auth-fixture.js';
import http from 'node:http';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('停止 API 进程并用同一目录启动新进程后，HTTP 仍能读到已保存的数据', { timeout: 30000 }, async (t) => {
  const qa = fileURLToPath(new URL('../data/qa/', import.meta.url));
  mkdirSync(qa, { recursive: true });
  const directory = mkdtempSync(join(qa, 'restart-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  async function launch() {
    const server = fileURLToPath(new URL('../apps/api/src/server.ts', import.meta.url));
    const child = spawn(process.execPath, ['--import', 'tsx', server], {
      env: { ...process.env, CLASSFLOW_PORT: '0', CLASSFLOW_DATA_DIR: directory },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const stopped = once(child, 'exit');
    const stop = async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await stopped;
    };
    try {
      const address = await new Promise<string>((resolve, reject) => {
        let logs = '';
        child.stdout.on('data', (chunk) => {
          logs += chunk;
          const url = logs.match(/http:\/\/127\.0\.0\.1:\d+/);
          if (url) resolve(url[0]);
        });
        child.stderr.on('data', (chunk) => {
          logs += chunk;
        });
        child.once('error', reject);
        child.once('exit', () => reject(new Error('API 未就绪。' + logs)));
      });
      return { address, stop };
    } catch (error) {
      await stop();
      throw error;
    }
  }
  const credentials = await provision(directory);
  // 以真实 HTTP 连接模拟可信反代转发的 Host。浏览器 origin 与后端临时端口分离。
  let cookie = '';
  async function request(address: string, path: string, body?: unknown) {
    const bytes = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    return new Promise<{ status: number; body: string; cookie?: string }>((resolve, reject) => {
      const req = http.request(
        address + path,
        {
          method: bytes ? 'POST' : 'GET',
          headers: {
            ...browserHeaders,
            cookie,
            ...(bytes ? { 'content-type': 'application/json', 'content-length': bytes.length } : {}),
          },
        },
        (res) => {
          let result = '';
          res.on('data', (b) => (result += b));
          res.on('end', () =>
            resolve({
              status: res.statusCode!,
              body: result,
              cookie: res.headers['set-cookie']?.[0].split(';')[0],
            }),
          );
        },
      );
      req.on('error', reject);
      req.end(bytes);
    });
  }
  const first = await launch();
  let id: string;
  try {
    const logged = await request(first.address, '/api/auth/login', credentials);
    assert.equal(logged.status, 200);
    cookie = logged.cookie!;
    const saved = await request(first.address, '/api/notices', {
      original: '请核对会议时间。',
      source: '测试',
      receivedAt: new Date().toISOString(),
      notes: '',
    });
    assert.equal(saved.status, 201);
    id = JSON.parse(saved.body).id;
  } finally {
    await first.stop();
  }
  const second = await launch();
  try {
    const response = await request(second.address, '/api/workspace');
    const data = JSON.parse(response.body);
    assert.equal(data.notices[0].id, id);
    assert.equal(data.notices[0].original, '请核对会议时间。');
  } finally {
    await second.stop();
  }
});
