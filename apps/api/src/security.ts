import type { FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { loginSchema, openAuth, sessionSeconds } from './auth-store.js';
import { RequestError } from './repository.js';
import type { settings } from './config.js';

export function secure(app: FastifyInstance, directory: string, config: ReturnType<typeof settings>) {
  const auth = openAuth(directory),
    cookieName = config.production ? '__Host-classflow' : 'classflow_dev';
  const options = { httpOnly: true, secure: config.production, sameSite: 'strict' as const, path: '/' };
  app.register(cookie);
  app.addHook('onClose', async () => auth.close());
  app.addHook('onRequest', async (req, res) => {
    res
      .header('X-Content-Type-Options', 'nosniff')
      .header('X-Frame-Options', 'DENY')
      .header('Referrer-Policy', 'no-referrer');
    if (config.production)
      res
        .header('Strict-Transport-Security', 'max-age=31536000')
        .header(
          'Content-Security-Policy',
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
        );
    const route = req.routeOptions.url;
    if (route === '/healthz') return;
    // Host is checked against the configured authority, never against user-supplied forwarding headers.
    if (req.headers.host !== config.origin.host) throw new RequestError(403, '请求主机不受信任');
    if (!route?.startsWith('/api/')) return;
    res.header('Cache-Control', 'no-store');
    if (
      route !== '/api/auth/login' &&
      route !== '/api/auth/session' &&
      !auth.authenticated(req.cookies[cookieName])
    )
      throw new RequestError(401, '请登录后访问。');
    if (req.headers.origin && req.headers.origin !== config.origin.origin)
      throw new RequestError(403, '请求来源不受信任');
    if (
      !['GET', 'HEAD'].includes(req.method) &&
      (req.headers.origin !== config.origin.origin || req.headers['x-classflow-request'] !== '1')
    )
      throw new RequestError(403, '请求缺少同源凭证。');
  });
  app.get('/healthz', () => ({ ok: true }));
  app.get('/api/auth/session', (req) => ({ authenticated: auth.authenticated(req.cookies[cookieName]) }));
  app.post('/api/auth/login', { bodyLimit: 4096 }, async (req, res) => {
    const { username, password } = loginSchema.parse(req.body);
    const token = await auth.login(username, password, req.ip);
    if (req.cookies[cookieName]) auth.revoke(req.cookies[cookieName]!);
    res.setCookie(cookieName, token, { ...options, maxAge: sessionSeconds });
    return { authenticated: true };
  });
  app.post('/api/auth/logout', (req, res) => {
    auth.revoke(req.cookies[cookieName]!);
    res.clearCookie(cookieName, options).code(204).send();
  });
}
