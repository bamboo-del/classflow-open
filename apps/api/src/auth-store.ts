import Database from 'better-sqlite3';
import { argon2, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { RequestError } from './repository.js';

export const sessionSeconds = 12 * 60 * 60;
export const loginSchema = z.strictObject({
  username: z.string().min(1).max(80),
  password: z.string().min(1).max(256),
});
const newAdminSchema = loginSchema.extend({
  username: z.string().trim().min(1).max(80),
  password: z.string().min(12).max(256),
});
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const derive = promisify(argon2);
const format = '$argon2id$v=19$m=65536,t=3,p=1$';
async function digest(password: string, salt: Buffer) {
  return derive('argon2id', {
    message: password,
    nonce: salt,
    memory: 65536,
    passes: 3,
    parallelism: 1,
    tagLength: 32,
  });
}
type Account = { username: string; hash: string };
export function openAuth(directory: string) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const db = new Database(join(directory, 'security.sqlite'));
  // 独立身份库使 MVP 业务迁移和 JSON 恢复均无法替换登录凭据。
  db.transaction(() => {
    const version = db.pragma('user_version', { simple: true });
    if (version === 1) return;
    if (version !== 0) throw new Error('身份库版本不兼容');
    db.exec(`CREATE TABLE admin(id INTEGER PRIMARY KEY CHECK(id=1),username TEXT NOT NULL,hash TEXT NOT NULL);
      CREATE TABLE sessions(digest TEXT PRIMARY KEY, expires INTEGER NOT NULL);
      CREATE TABLE attempts(bucket TEXT PRIMARY KEY, hits INTEGER NOT NULL, until INTEGER NOT NULL);
      PRAGMA user_version=1;`);
  }).immediate();
  const account = () => db.prepare('SELECT username,hash FROM admin WHERE id=1').get() as Account | undefined;
  const reserve = db.transaction((ip: string, now: number) => {
    db.prepare('DELETE FROM attempts WHERE until<=?').run(now);
    for (const [key, limit] of [
      ['ip:' + ip, 6],
      ['total', 48],
    ] as const) {
      const row = db.prepare('SELECT hits FROM attempts WHERE bucket=?').get(key) as
        { hits: number } | undefined;
      if (row && row.hits >= limit) throw new RequestError(429, '尝试过于频繁，请在 10 分钟后重试。');
      db.prepare('INSERT INTO attempts VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET hits=hits+1').run(
        key,
        now + 600000,
      );
    }
  });
  let verifying = 0;
  return {
    close: () => db.close(),
    async configure(mode: 'init' | 'reset', username: string, password: string) {
      const input = newAdminSchema.parse({ username, password });
      const salt = randomBytes(16),
        hash =
          format + salt.toString('base64') + '$' + (await digest(input.password, salt)).toString('base64');
      db.transaction(() => {
        const old = account();
        if ((mode === 'init' && old) || (mode === 'reset' && old?.username !== input.username))
          throw new Error('当前账号状态与操作不匹配。');
        db.prepare('INSERT INTO admin VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET hash=excluded.hash').run(
          input.username,
          hash,
        );
        db.exec('DELETE FROM sessions; DELETE FROM attempts;');
      }).immediate();
    },
    async login(username: string, password: string, ip: string) {
      if (verifying >= 3) throw new RequestError(429, '登录请求繁忙，请稍后再试。');
      reserve.immediate(ip, Date.now());
      verifying++;
      try {
        const admin = account();
        const [salt, expected] = (
          admin?.hash.startsWith(format) ? admin.hash.slice(format.length) : ''
        ).split('$');
        const computed = await digest(password, salt ? Buffer.from(salt, 'base64') : Buffer.alloc(16));
        const valid = expected && timingSafeEqual(computed, Buffer.from(expected, 'base64'));
        const token = randomBytes(32).toString('base64url');
        db.transaction(() => {
          if (!valid || !admin || admin.username !== username || account()?.hash !== admin.hash)
            throw new RequestError(401, '账号或密码错误。');
          const now = Date.now();
          db.prepare('DELETE FROM sessions WHERE expires<=?').run(now);
          db.prepare('INSERT INTO sessions VALUES(?,?)').run(hashToken(token), now + sessionSeconds * 1000);
          db.prepare('DELETE FROM attempts WHERE bucket=?').run('ip:' + ip);
        }).immediate();
        return token;
      } finally {
        verifying--;
      }
    },
    authenticated(token?: string) {
      return (
        !!token &&
        token.length === 43 &&
        !!db.prepare('SELECT 1 FROM sessions WHERE digest=? AND expires>?').get(hashToken(token), Date.now())
      );
    },
    revoke(token: string) {
      db.prepare('DELETE FROM sessions WHERE digest=?').run(hashToken(token));
    },
  };
}
