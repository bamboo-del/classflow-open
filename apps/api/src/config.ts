import { fileURLToPath } from 'node:url';
import { isIP } from 'node:net';

export const dataDirectory = () =>
  process.env.CLASSFLOW_DATA_DIR ?? fileURLToPath(new URL('../../../data/', import.meta.url));
export function settings(env: NodeJS.ProcessEnv = process.env) {
  const production = env.NODE_ENV === 'production';
  const raw = env.CLASSFLOW_ORIGIN ?? (production ? '' : 'http://127.0.0.1:5174');
  const origin = URL.parse(raw);
  if (
    !origin ||
    raw !== origin.origin ||
    (production
      ? origin.protocol !== 'https:'
      : origin.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(origin.hostname))
  )
    throw new Error('请设置完整的 CLASSFLOW_ORIGIN，生产环境要求 HTTPS，本地环境要求回环 HTTP。');
  const proxy = env.CLASSFLOW_TRUST_PROXY;
  if (proxy && !isIP(proxy)) throw new Error('仅允许配置单个受信代理 IP。');
  return { origin, production, trustProxy: proxy || (false as const) };
}
