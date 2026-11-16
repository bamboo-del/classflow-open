import test from 'node:test';
import Database from 'better-sqlite3';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createApp } from '../apps/api/src/app.js';
import { client, provision, signIn } from './auth-fixture.js';
import {
  campusClock,
  overdue,
  summarize,
  type Backup,
  type TaskInput,
  type Workspace,
} from '@classflow/shared';

const input: TaskInput = {
  title: '收齐材料',
  description: '核对名单',
  category: '材料',
  priority: '高',
  status: '待办',
  dueDate: '2026-11-04',
  dueTime: '18:00',
  assignee: '各组长',
  sourceNoticeId: null,
  visibility: '私人',
};
async function fixture(t: import('node:test').TestContext) {
  const root = fileURLToPath(new URL('../data/qa/', import.meta.url));
  mkdirSync(root, { recursive: true });
  const directory = mkdtempSync(join(root, 'classflow-api-'));
  const app = createApp(directory);
  t.after(async () => {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const credentials = await provision(directory);
  const cookie = await signIn(app, credentials);
  return { app: client(app, cookie), directory, cookie };
}
test('通知原文保真、一对多、任务编辑与完成、重新打开及安全删除', async (t) => {
  const { app } = await fixture(t);
  const original = '  请提交材料。\n周五开会。  ';
  const n = await app.inject({
    method: 'POST',
    url: '/api/notices',
    payload: { original, source: '班群', notes: '原文留档', receivedAt: new Date().toISOString() },
  });
  assert.equal(n.statusCode, 201);
  const sourceNoticeId = n.json().id;
  const create = async () =>
    (
      await app.inject({
        method: 'POST',
        url: '/api/tasks',
        payload: { ...input, sourceNoticeId, visibility: undefined },
      })
    ).json();
  const first = await create();
  assert.equal(first.visibility, '私人');
  const second = await create();
  const workspace = async (): Promise<Workspace> => (await app.inject('/api/workspace')).json();
  let data = await workspace();
  assert.equal(data.tasks.filter((x) => x.sourceNoticeId === sourceNoticeId).length, 2);
  assert.equal(summarize(data).rate, 0);
  const update = (status: TaskInput['status']) =>
    app.inject({
      method: 'PUT',
      url: '/api/tasks/' + first.id,
      payload: { ...input, sourceNoticeId, title: '名单已核对', status },
    });
  assert.ok((await update('已完成')).json().completedAt);
  data = await workspace();
  assert.equal(summarize(data).rate, 50);
  assert.equal(data.tasks.find((x) => x.id === first.id)?.title, '名单已核对');
  assert.equal((await update('待办')).json().completedAt, null);
  assert.equal((await app.inject({ method: 'DELETE', url: '/api/tasks/' + second.id })).statusCode, 204);
  assert.equal((await workspace()).notices[0].original, original);
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url: '/api/notices/' + sourceNoticeId,
        payload: { processed: true },
      })
    ).json().processed,
    true,
  );
});
test('北京时间日期边界、当天可选时间、完成状态与未来七天', () => {
  const now = campusClock(new Date('2026-11-03T16:01:00Z'));
  assert.deepEqual(now, { date: '2026-11-04', time: '00:01' });
  const task = { ...input, id: 'x', createdAt: '', updatedAt: '', completedAt: null };
  assert.ok(overdue({ ...task, dueTime: '00:00' }, now));
  assert.ok(!overdue({ ...task, dueTime: '00:01' }, now));
  assert.ok(!overdue({ ...task, dueTime: null }, now));
  assert.ok(overdue({ ...task, dueDate: '2026-11-03', dueTime: null }, now));
  assert.ok(!overdue({ ...task, dueDate: '2026-11-03', status: '已完成' }, now));
  const dates = ['2026-11-04', '2026-11-05', '2026-11-11', '2026-11-12'];
  assert.equal(
    summarize({ tasks: dates.map((dueDate) => ({ ...task, dueDate })), notices: [] }, now).week.length,
    2,
  );
});
test('备份预览、确认、并发修改防护、恢复一致性、自动保存旧数据与重启', async (t) => {
  const { app, directory, cookie } = await fixture(t);
  const backup = async (): Promise<Backup> => (await app.inject('/api/backup')).json();
  await app.inject({ method: 'POST', url: '/api/tasks', payload: input });
  const file = await backup();
  const preview = async () =>
    (await app.inject({ method: 'POST', url: '/api/backup/preview', payload: file })).json();
  const restore = (revision: string, confirmed: boolean) =>
    app.inject({
      method: 'POST',
      url: '/api/backup/restore',
      payload: { backup: file, confirmed, revision },
    });
  const first = await preview();
  await app.inject({ method: 'POST', url: '/api/tasks', payload: { ...input, title: '新增任务' } });
  assert.equal((await restore(first.revision, true)).statusCode, 409);
  const next = await preview();
  assert.deepEqual(next.current, { tasks: 2, notices: 0, handbook: 0 });
  assert.deepEqual(next.incoming, { tasks: 1, notices: 0, handbook: 0 });
  assert.equal((await restore(next.revision, false)).statusCode, 400);
  const before = await backup();
  for (const invalid of [
    { ...file, version: 9 },
    { ...file, tasks: [...file.tasks, ...file.tasks] },
    { ...file, tasks: [{ ...file.tasks[0], dueDate: '2026-02-30' }] },
    { ...file, tasks: [{ ...file.tasks[0], sourceNoticeId: crypto.randomUUID() }] },
  ]) {
    assert.equal(
      (await app.inject({ method: 'POST', url: '/api/backup/preview', payload: invalid })).statusCode,
      400,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/backup/restore',
          payload: { backup: invalid, confirmed: true, revision: next.revision },
        })
      ).statusCode,
      400,
    );
  }
  assert.deepEqual((await backup()).tasks, before.tasks);
  // 验证覆盖已开始后的写入错误也能回滚，而不只验证请求校验失败。
  const disk=new Database(join(directory,'classflow.sqlite'));
  try{
    disk.exec("CREATE TRIGGER fail_restore BEFORE INSERT ON tasks BEGIN SELECT RAISE(ABORT,'simulated write failure'); END");
    assert.equal((await restore(next.revision,true)).statusCode,500);
    assert.deepEqual((await backup()).tasks,before.tasks);
    disk.exec('DROP TRIGGER fail_restore');
  }finally{disk.close();}
  const restored = await restore(next.revision, true);
  assert.equal(restored.statusCode, 200);
  assert.deepEqual(
    JSON.parse(readFileSync(join(directory, 'backups', restored.json().backupFile), 'utf8')).tasks,
    before.tasks,
  );
  await app.close();
  const restarted = client(createApp(directory), cookie);
  try {
    assert.deepEqual((await restarted.inject('/api/workspace')).json(), {
      tasks: file.tasks,
      notices: file.notices,
      handbook: [],
    });
  } finally {
    await restarted.close();
  }
});
test('拒绝外部浏览器来源、非法任务与未知关联', async (t) => {
  const { app } = await fixture(t);
  assert.equal((await app.inject({ url: '/api/workspace', headers: { host: 'evil.test' } })).statusCode, 403);
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/tasks',
        headers: { origin: 'https://external.example' },
        payload: input,
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (await app.inject({ method: 'POST', url: '/api/tasks', payload: { ...input, title: ' ' } })).statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/tasks',
        payload: { ...input, sourceNoticeId: crypto.randomUUID() },
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (await app.inject({ method: 'PUT', url: '/api/tasks/' + crypto.randomUUID(), payload: input }))
      .statusCode,
    404,
  );
});
