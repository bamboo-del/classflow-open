import { randomBytes } from 'node:crypto';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { openAuth } from '../apps/api/src/auth-store.js';

export const localOrigin = 'http://127.0.0.1:5174';
export const browserHeaders = { host: '127.0.0.1:5174', origin: localOrigin, 'x-classflow-request': '1' };
export async function provision(directory: string, password = randomBytes(24).toString('hex')) {
  const auth = openAuth(directory);
  try {
    await auth.configure('init', 'tester', password);
  } finally {
    auth.close();
  }
  return { username: 'tester', password };
}
export async function signIn(app: FastifyInstance, credentials: Awaited<ReturnType<typeof provision>>) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: browserHeaders,
    payload: credentials,
  });
  if (res.statusCode !== 200) throw new Error('测试管理员登录失败 ' + res.statusCode);
  const c = res.cookies[0];
  return c.name + '=' + c.value;
}
export function client(raw: FastifyInstance, cookie: string) {
  return {
    close: () => raw.close(),
    inject: (input: string | InjectOptions) => {
      const opts = typeof input === 'string' ? { url: input } : input;
      return raw.inject({ ...opts, headers: { ...browserHeaders, cookie, ...opts.headers } });
    },
  };
}
