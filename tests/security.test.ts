import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import { createApp } from '../apps/api/src/app.js';
import { openAuth } from '../apps/api/src/auth-store.js';
import { settings } from '../apps/api/src/config.js';
import { provision, signIn, browserHeaders } from './auth-fixture.js';

test('匿名全部业务路由、安全 Cookie、同源写入、会话到期/退出/重置、持久限流', async (t) => {
  const qa = resolve('data/qa');
  mkdirSync(qa, { recursive: true });
  const directory = mkdtempSync(join(qa, 'security-'));
  const app = createApp(directory);
  const db = new Database(join(directory, 'security.sqlite'));
  t.after(async () => {
    db.close();
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const headers = browserHeaders;
  for (const [method, url] of [
    ['GET', 'workspace'],
    ['GET', 'backup'],
    ['POST', 'tasks'],
    ['PUT', 'tasks/x'],
    ['DELETE', 'tasks/x'],
    ['POST', 'notices'],
    ['PATCH', 'notices/x'],
    ['POST', 'backup/preview'],
    ['POST', 'backup/restore'],
    ['POST', 'handbook'],
    ['PUT', 'handbook/x'],
    ['DELETE', 'handbook/x'],
  ] as const) {
    const result = await app.inject({ method, url: '/api/' + url, headers });
    assert.equal(result.statusCode, 401);
    assert.deepEqual(result.json(), { message: '请登录后访问。' });
  }
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/init', headers })).statusCode, 404);
  const credentials = await provision(directory);
  const cookie = await signIn(app, credentials);
  const row = db.prepare('SELECT hash FROM admin').get() as { hash: string };
  assert.ok(row.hash.startsWith('$argon2id$'));
  assert.ok(!row.hash.includes(credentials.password));
  const sessionRow = db.prepare('SELECT digest FROM sessions').get() as { digest: string };
  assert.notEqual(sessionRow.digest, cookie.split('=')[1]);
  const get = () => app.inject({ url: '/api/backup', headers: { ...headers, cookie } });
  const exported = await get();
  assert.equal(exported.statusCode, 200);
  assert.deepEqual(Object.keys(exported.json()).sort(), ['exportedAt', 'handbook', 'notices', 'tasks', 'version']);
  for (const extra of [
    { origin: 'https://other.example' },
    { origin: undefined },
    { 'x-classflow-request': undefined },
  ]) {
    const sent = Object.fromEntries(
      Object.entries({ ...headers, cookie, ...extra }).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
    assert.equal(
      (await app.inject({ method: 'POST', url: '/api/auth/logout', headers: sent })).statusCode,
      403,
    );
  }
  assert.equal(
    (await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { ...headers, cookie } }))
      .statusCode,
    204,
  );
  assert.equal((await get()).statusCode, 401);
  const exp = await signIn(app, credentials);
  db.prepare('UPDATE sessions SET expires=0').run();
  assert.equal(
    (await app.inject({ url: '/api/workspace', headers: { ...headers, cookie: exp } })).statusCode,
    401,
  );
  const beforeReset = await signIn(app, credentials);
  const auth = openAuth(directory);
  const fresh = { ...credentials, password: randomBytes(24).toString('hex') };
  try {
    await auth.configure('reset', fresh.username, fresh.password);
  } finally {
    auth.close();
  }
  assert.equal(
    (await app.inject({ url: '/api/workspace', headers: { ...headers, cookie: beforeReset } })).statusCode,
    401,
  );
  const login = (pwd: string) =>
    app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { ...headers, 'x-forwarded-for': randomBytes(4).join('.') },
      payload: { username: credentials.username, password: pwd },
    });
  for (let i = 0; i < 6; i++) assert.equal((await login(credentials.password)).statusCode, 401);
  assert.equal((await login(fresh.password)).statusCode, 429);
  const second = createApp(directory);
  try {
    assert.equal(
      (await second.inject({ method: 'POST', url: '/api/auth/login', headers, payload: fresh })).statusCode,
      429,
    );
  } finally {
    await second.close();
  }
  assert.throws(() => settings({ NODE_ENV: 'production', CLASSFLOW_ORIGIN: 'http://insecure.test' }));
  assert.throws(() => settings({ CLASSFLOW_TRUST_PROXY: '*' }));
  db.exec('DELETE FROM attempts');
  const prod = createApp(
    directory,
    settings({ NODE_ENV: 'production', CLASSFLOW_ORIGIN: 'https://classflow.test' }),
  );
  try {
    const result = await prod.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { host: 'classflow.test', origin: 'https://classflow.test', 'x-classflow-request': '1' },
      payload: fresh,
    });
    assert.equal(result.statusCode, 200);
    assert.match(String(result.headers['set-cookie']), /__Host-classflow=/);
    for (const s of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/'])
      assert.ok(String(result.headers['set-cookie']).includes(s));
    assert.ok(result.headers['strict-transport-security']);
    assert.ok(result.headers['content-security-policy']);
    assert.equal(result.headers['access-control-allow-origin'], undefined);
  } finally {
    await prod.close();
  }
});
