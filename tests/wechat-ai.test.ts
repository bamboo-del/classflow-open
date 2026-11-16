import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../apps/api/src/app.js';
import { openRepository } from '../apps/api/src/repository.js';
import { aiPending, makeWechatAi, type AiJob } from '../apps/api/src/wechat-ai.js';
import { client, provision, signIn } from './auth-fixture.js';

const sentAt = '2026-11-15T08:00:00Z';
const message = { account: 'qa', chatId: 'group-a', chatName: '验收团支书群', sender: '老师', messageId: 'msg',
  text: '各团支部把团日活动记录整理后发到群文件，时间按上一条。', sentAt };
const aiConfig = { endpoint: 'https://fixture.example/v1/chat/completions', model: 'test-model', apiKey: 'fake-key', groups: [message.chatName] };
const item = { title: '提交团日活动记录', actionQuote: '各团支部把团日活动记录整理后发到群文件',
  deadlineQuote: '明天18:00前', deadlineFrom: 1, audience: '各团支部', category: '材料' };
const output = (result: unknown) => Response.json({ choices: [{ message: { content: JSON.stringify(result) } }] });

test('微信 AI：群消息先入库，异步读同群上下文，失败重启不丢单，重复投递只生成一项', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'classflow-ai-'));
  const seed = openRepository(dir);
  seed.ingestWechat({ ...message, messageId: 'earlier', text: '本轮截止明天18:00前。', sentAt: '2026-11-15T07:45:00Z' });
  seed.ingestWechat({ ...message, chatName: '另一个群', chatId: 'group-b', messageId: 'other', text: '隔离群正文。', sentAt: '2026-11-15T07:50:00Z' });
  seed.close();
  let failed = false;
  let first = createApp(dir, undefined, makeWechatAi(aiConfig, async () => {
    failed = true;
    return new Response('', { status: 503 });
  }));
  t.after(async () => { await first.close(); rmSync(dir, { recursive: true, force: true }); });
  const credentials = await provision(dir);
  const writer = client(first, await signIn(first, credentials));
  const ingest = (app: typeof writer) => app.inject({ method: 'POST', url: '/api/integrations/wechat/messages', payload: message });
  const imported = await ingest(writer);
  assert.equal(imported.json().taskCount, 0);
  const id = imported.json().noticeId;
  const before = (await writer.inject('/api/workspace')).json();
  assert.equal(before.notices.find((n: { id: string }) => n.id === id).original, message.text);
  assert.ok(before.notices.find((n: { id: string }) => n.id === id).notes.startsWith(aiPending));
  assert.equal(before.tasks.length, 0);
  const failureTimeout = Date.now() + 12000;
  while (!failed && Date.now() < failureTimeout) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(failed);
  assert.equal((await writer.inject('/api/workspace')).json().tasks.length, 0);
  await first.close();

  let called = 0;
  const analyzer = makeWechatAi(aiConfig, async (_url, options) => {
    called++;
    const payload = JSON.parse(String(options?.body));
    assert.equal(payload.model, 'test-model');
    assert.equal(payload.response_format.type, 'json_object');
    assert.equal(options?.redirect, 'error');
    const messages = JSON.parse(payload.messages[1].content);
    assert.deepEqual(messages, [{ index: 0, sentAt, text: message.text },
      { index: 1, sentAt: '2026-11-15T07:45:00Z', text: '本轮截止明天18:00前。' }]);
    return output({ summary: '整理团日活动记录并发到群文件。', review: [], items: [item, item] });
  });
  first = createApp(dir, undefined, analyzer);
  const restarted = client(first, await signIn(first, credentials));
  const after = (await restarted.inject('/api/workspace')).json();
  assert.equal(called, 1);
  assert.equal(after.tasks.length, 1);
  assert.equal(after.tasks[0].sourceNoticeId, id);
  assert.equal(after.tasks[0].dueDate, '2026-11-16');
  assert.equal(after.tasks[0].dueTime, '18:00');
  assert.equal(after.tasks[0].visibility, '私人');
  assert.match(after.notices.find((n: { id: string }) => n.id === id).notes, /AI 摘要/);
  assert.equal((await ingest(restarted)).json().status, 'duplicate');
  assert.equal((await restarted.inject('/api/workspace')).json().tasks.length, 1);
});

test('微信 AI：编造的截止依据、改期通知和无效结果均不落任务', async () => {
  const job: AiJob = { notice: { id: randomUUID(), original: message.text, receivedAt: sentAt, notes: aiPending },
    context: [{ id: randomUUID(), original: '截止明天18:00前', receivedAt: sentAt }] };
  for (const [input, candidate] of [[job, { ...item, deadlineQuote: '本周一17:00' }],
    [{ ...job, notice: { ...job.notice, original: message.text + '之前的安排取消。' } }, item]] as const) {
    const ai = makeWechatAi(aiConfig, async () => output({ summary: '需核对', review: [], items: [candidate] }));
    const result = await ai.analyze(input, new AbortController().signal);
    assert.equal(result.tasks.length, 0);
    assert.ok(result.review.length);
  }
  const invalid = makeWechatAi(aiConfig, async () => output({ notTheSchema: true }));
  const result = await invalid.analyze(job, new AbortController().signal);
  assert.equal(result.tasks.length, 0);
  assert.match(result.review[0], /无法校验/);
});
