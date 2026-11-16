import { fileURLToPath } from 'node:url';
import { dataDirectory, settings } from './config.js';
import { createApp } from './app.js';
import fastifyStatic from '@fastify/static';

process.umask(0o077);
const config = settings();
const app = createApp(dataDirectory(), config);
if (config.production)
  await app.register(fastifyStatic, {
    root: fileURLToPath(new URL('../../web/dist/', import.meta.url)),
    dotfiles: 'deny',
  });
const host = process.env.CLASSFLOW_BIND ?? '127.0.0.1';
if (!config.production && host !== '127.0.0.1') throw new Error('开发模式仅允许回环监听。');
const address = await app.listen({ host, port: Number(process.env.CLASSFLOW_PORT ?? 4318) });
console.log('ClassFlow ' + address);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    void app.close();
  });
