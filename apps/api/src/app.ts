import Fastify from 'fastify';
import { z } from 'zod';
import {
  backupSchema,
  noticeInput,
  noticeState,
  restoreRequest,
  taskCreate,
  taskInput,
} from '@classflow/shared/validation';
import { openRepository } from './repository.js';

import { settings } from './config.js';
import { secure } from './security.js';
import { presentationRoutes } from './presentations-routes.js';
import { wechatMessage } from './wechat-extract.js';
import { handbookInput } from '@classflow/shared/handbook';
import { loadWechatAi, startWechatAi, type WechatAi } from './wechat-ai.js';

export function createApp(directory: string, config = settings(), analyzer?: WechatAi) {
  const app = Fastify({ trustProxy: config.trustProxy, bodyLimit: 32 * 1024 * 1024 });
  let ai = analyzer;
  if (!ai) {
    try { ai = loadWechatAi(directory); }
    catch { console.warn('ClassFlow: 微信 AI 配置无效，继续使用现有规则。'); }
  }
  secure(app, directory, config);
  presentationRoutes(app, directory);
  const repo = openRepository(directory);
  let stopAi: (() => Promise<void>) | undefined;
  app.addHook('onReady', async () => {
    if (ai) stopAi = startWechatAi(repo, ai, () => console.warn('ClassFlow: 微信 AI 分析暂不可用，已保留待分析消息。'));
  });
  app.addHook('onClose', async () => { await stopAi?.(); repo.close(); });
  app.setErrorHandler((err: Error & { statusCode?: number }, _req, res) => {
    if (err instanceof z.ZodError) {
      const problem = err.issues[0];
      return res
        .code(400)
        .send({ message: '数据校验失败（' + (problem.path.join('.') || '备份') + '）' + problem.message });
    }
    const code = err.statusCode ?? 500;
    if (code >= 500) app.log.error(err);
    return res
      .code(code)
      .send({ message: code >= 500 ? '本地数据库或备份写入失败，请检查磁盘与权限。' : err.message });
  });
  app.get('/api/workspace', () => repo.workspace());
  app.post('/api/handbook', (req, res) => res.code(201).send(repo.saveHandbook(handbookInput.parse(req.body))));
  app.put<{ Params: { id: string } }>('/api/handbook/:id', (req) => repo.saveHandbook(handbookInput.parse(req.body), req.params.id));
  app.delete<{ Params: { id: string } }>('/api/handbook/:id', (req, res) => {
    repo.removeHandbook(req.params.id);
    return res.code(204).send();
  });
  app.post('/api/integrations/wechat/messages', { bodyLimit: 100000 }, (req) => {
    const input = wechatMessage.parse(req.body);
    return repo.ingestWechat(input, ai?.groups.includes(input.chatName));
  });
  app.post('/api/notices', (req, res) => res.code(201).send(repo.createNotice(noticeInput.parse(req.body))));
  app.patch<{ Params: { id: string } }>('/api/notices/:id', (req) =>
    repo.markNotice(req.params.id, noticeState.parse(req.body).processed),
  );
  app.post('/api/tasks', (req, res) => res.code(201).send(repo.saveTask(taskCreate.parse(req.body))));
  app.put<{ Params: { id: string } }>('/api/tasks/:id', (req) =>
    repo.saveTask(taskInput.parse(req.body), req.params.id),
  );
  app.delete<{ Params: { id: string } }>('/api/tasks/:id', (req, res) => {
    repo.removeTask(req.params.id);
    return res.code(204).send();
  });
  app.get('/api/backup', () => repo.export());
  app.post('/api/backup/preview', (req) => repo.preview(backupSchema.parse(req.body)));
  app.post('/api/backup/restore', (req) => {
    const input = restoreRequest.parse(req.body);
    return repo.restore(input.backup, input.revision);
  });
  return app;
}
