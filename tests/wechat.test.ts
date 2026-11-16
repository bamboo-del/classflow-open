import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createApp } from '../apps/api/src/app.js';
import { extractWechat } from '../apps/api/src/wechat-extract.js';
import { browserHeaders, client, provision, signIn } from './auth-fixture.js';
import { summarize, type Backup } from '@classflow/shared';

const sentAt = '2026-11-08T16:30:00Z'; // Beijing November 9, independent of host timezone.
const message = { account: 'test-account', chatId: 'test-group', chatName: '验收班群',
  messageId: 'message-001', sender: '老师', sentAt,
  text: '  请明天18:00前提交材料。\n请下周一下午3点参加会议。  ' };

test('规则：北京时间、跨月跨年、独立事项、私人默认值', () => {
  const result = extractWechat(message.text, sentAt);
  assert.equal(result.tasks.length, 2);
  assert.deepEqual(result.tasks.map((t) => [t.dueDate, t.dueTime, t.visibility]),
    [['2026-11-10', '18:00', '私人'], ['2026-11-16', '15:00', '私人']]);
  assert.equal(extractWechat('请明天提交报告', '2026-12-31T08:00:00Z').tasks[0].dueDate, '2027-01-01');
  assert.equal(extractWechat('请后天提交报告', '2026-11-30T08:00:00Z').tasks[0].dueDate, '2026-12-02');
  assert.equal(extractWechat('请今晚18:30报名活动', sentAt).tasks[0].dueTime, '18:30');
});

test('规则：闲聊不建任务，不猜缺失/非法/多重日期、含糊时间或取消事项', () => {
  assert.equal(extractWechat('好的，谢谢', sentAt).actionable, false);
  for (const text of ['请提交材料', '请2026年2月30日提交材料', '请明天9点提交材料',
    '请明天下午三点提交材料', '请明天14:00至16:00参加会议', '请今天或明天提交材料',
    '明天会议取消', '请明天18:00提交材料\n上述安排取消', '请明天25:00提交材料',
    '请明天12:88提交材料', '请明天晚上提交材料', '是否明天提交材料？']) {
    const result = extractWechat(text, sentAt);
    assert.equal(result.tasks.length, 0, text);
    assert.ok(result.warnings.length, text);
  }
});

test('微信 API：鉴权、原文、一对多、去重、编辑删除、重启与备份恢复', async (t) => {
  const base = fileURLToPath(new URL('../data/qa/', import.meta.url));
  mkdirSync(base, { recursive: true });
  const directory = mkdtempSync(join(base, 'wechat-'));
  let raw = createApp(directory);
  t.after(async () => raw.close());
  const credentials = await provision(directory);
  const cookie = await signIn(raw, credentials);
  let app = client(raw, cookie);
  const post = (payload: object = message) => app.inject({ method: 'POST',
    url: '/api/integrations/wechat/messages', payload });
  assert.equal((await raw.inject({ method: 'POST', url: '/api/integrations/wechat/messages',
    headers: browserHeaders, payload: message })).statusCode, 401);
  assert.equal((await raw.inject({ method: 'POST', url: '/api/integrations/wechat/messages',
    headers: { host: browserHeaders.host, cookie }, payload: message })).statusCode, 403);
  const first = await post();
  assert.equal(first.statusCode, 200);
  assert.equal(first.json().taskCount, 2);
  let backup = (await app.inject('/api/backup')).json<Backup>();
  assert.equal(backup.notices[0].original, message.text);
  assert.equal(backup.notices[0].processed, false);
  assert.ok(backup.tasks.every((task) => task.sourceNoticeId === backup.notices[0].id));
  assert.equal((await post()).json().status, 'duplicate');
  assert.equal((await post({ ...message, text: 'changed' })).statusCode, 409);
  assert.equal((await post({ ...message, sentAt: 'invalid' })).statusCode, 400);
  assert.equal((await post({ ...message, messageId: 'bad', visibility: '未来可公开' })).statusCode, 400);
  const chat = { ...message, messageId: 'chat', text: '好的，谢谢' };
  const chatResult = (await post(chat)).json();
  assert.equal(chatResult.status, 'created');
  assert.equal(chatResult.taskCount, 0);
  assert.equal((await post(chat)).json().status, 'duplicate');
  const card = (await post({ ...message, messageId: 'file', format: 'card' })).json();
  assert.equal(card.status, 'created');
  assert.equal(card.taskCount, 0);
  const task = backup.tasks[0];
  const { id, createdAt: _created, updatedAt: _updated, completedAt: _completed, ...fields } = task;
  void _created; void _updated; void _completed;
  await app.inject({ method: 'PUT', url: '/api/tasks/' + id, payload: { ...fields, status: '已完成' } });
  assert.equal(summarize((await app.inject('/api/workspace')).json()).rate, 50);
  await app.inject({ method: 'DELETE', url: '/api/tasks/' + id });
  assert.equal((await post()).json().status, 'duplicate');
  backup = (await app.inject('/api/backup')).json<Backup>();
  assert.equal(backup.tasks.length, 1);
  assert.equal(backup.notices[0].original, message.text);
  await raw.close();
  raw = createApp(directory);
  app = client(raw, await signIn(raw, credentials));
  assert.equal((await post()).json().status, 'duplicate');
  assert.equal((await app.inject('/api/workspace')).json().tasks.length, 1);
  const preview = await app.inject({ method: 'POST', url: '/api/backup/preview', payload: backup });
  const restored = await app.inject({ method: 'POST', url: '/api/backup/restore',
    payload: { backup, confirmed: true, revision: preview.json().revision } });
  assert.equal(restored.statusCode, 200);
  assert.equal((await post()).json().status, 'duplicate');
  assert.deepEqual((await app.inject('/api/workspace')).json(), { tasks: backup.tasks, notices: backup.notices, handbook: [] });
  const unclear = await post({ ...message, messageId: 'unclear', text: '请尽快提交材料' });
  assert.equal(unclear.json().taskCount, 0);
  assert.ok(unclear.json().warnings.length);
  assert.equal((await app.inject('/api/workspace')).json().notices.length, 4);
});
