import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { handbookInput, handbookSections, handbookReminders } from '@classflow/shared/handbook';
import { createApp } from '../apps/api/src/app.js';
import { openRepository } from '../apps/api/src/repository.js';
import { backupDatabase, restoreFresh } from '../apps/api/src/snapshot.js';
import { browserHeaders, client, provision, signIn } from './auth-fixture.js';

function directory() {
  const root = resolve('data/qa');
  mkdirSync(root, { recursive: true });
  const path = mkdtempSync(join(root, 'handbook-'));
  return path;
}

test('手册字段校验：必填、未知栏目、日期、人数关系、金额、评议选项、300字和图片类型', () => {
  const valid = { kind: 'activity', values: { 团日活动名称: '安全学习', 活动时间: '2026-11-15', 活动情况: '实事求是'.repeat(75) } };
  assert.ok(handbookInput.safeParse(valid).success);
  const invalid = [
    { ...valid, values: { ...valid.values, 团日活动名称: ' ' } },
    { ...valid, values: { ...valid.values, 活动时间: '2026-02-30' } },
    { ...valid, values: { ...valid.values, 活动情况: '字'.repeat(301) } },
    { ...valid, values: { ...valid.values, 任意字段: '不应存入' } },
    { kind: 'assembly', values: { 会议主题: '会议', 时间: '2026-11-15', 应到人数: '30', 实到人数: '29', 缺席人数: '2' } },
    { kind: 'assembly', values: { 会议主题: '会议', 时间: '2026-11-15', 应到人数: '30', 实到人数: '31' } },
    { kind: 'dues', values: { 缴纳时间: '2026-11-15', 应缴人数: '-1' } },
    { kind: 'dues', values: { 缴纳时间: '2026-11-15', '应缴金额（元）': '1.001' } },
    { kind: 'reviews', values: { 姓名: '测试同学', 评议年度: '2026', 评议结果: '随意结果' } },
    { ...valid, photos: [{ name: 'unsafe.svg', data: 'data:image/svg+xml;base64,PHN2Zy8+' }] },
  ];
  for (const input of invalid) assert.equal(handbookInput.safeParse(input).success, false, JSON.stringify(input));
  assert.ok(handbookInput.safeParse({ kind: 'dues', values: { 缴纳时间: '2026-11-15', '应缴金额（元）': '0.29' } }).success);
  for (const section of handbookSections) {
    const values = Object.fromEntries(section.fields.filter((f) => f.required).map((f) => [f.label, f.options?.[0] ?? (f.type === 'date' ? '2026-11-15' : f.type === 'number' ? '2026' : '测试') ]));
    assert.ok(handbookInput.safeParse({ kind: section.id, values }).success, section.title);
  }
});

test('手册 API：会话保护、持久化、更新、删除、备份并发保护、旧版恢复保留手册', async (t) => {
  const dir = directory();
  const raw = createApp(dir);
  const credentials = await provision(dir);
  const cookie = await signIn(raw, credentials);
  const app = client(raw, cookie);
  t.after(async () => { await raw.close(); rmSync(dir, { recursive: true, force: true }); });
  const input = { kind: 'members', values: { 姓名: '测试同学', 学号: 'QA001' }, photos: [] };
  assert.equal((await raw.inject({ method: 'POST', url: '/api/handbook', headers: browserHeaders, payload: input })).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: '/api/handbook', payload: { ...input, values: {} } })).statusCode, 400);
  const created = await app.inject({ method: 'POST', url: '/api/handbook', payload: input });
  assert.equal(created.statusCode, 201);
  const id = created.json().id;
  const backup = (await app.inject('/api/backup')).json();
  assert.equal(backup.version, 2);
  assert.equal(backup.handbook[0].values.学号, 'QA001');
  const preview = (await app.inject({ method: 'POST', url: '/api/backup/preview', payload: backup })).json();
  const updated = await app.inject({ method: 'PUT', url: '/api/handbook/' + id, payload: { ...input, values: { ...input.values, 变动: '测试转专业' } } });
  assert.equal(updated.statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: '/api/backup/restore', payload: { backup, confirmed: true, revision: preview.revision } })).statusCode, 409);
  const legacy = { version: 1, exportedAt: backup.exportedAt, tasks: backup.tasks, notices: backup.notices };
  const oldPreview = (await app.inject({ method: 'POST', url: '/api/backup/preview', payload: legacy })).json();
  assert.equal(oldPreview.incoming.handbook, 1);
  assert.equal((await app.inject({ method: 'POST', url: '/api/backup/restore', payload: { backup: legacy, confirmed: true, revision: oldPreview.revision } })).statusCode, 200);
  assert.equal((await app.inject('/api/workspace')).json().handbook[0].values.变动, '测试转专业');
  const next = (await app.inject({ method: 'POST', url: '/api/backup/preview', payload: backup })).json();
  const restored = await app.inject({ method: 'POST', url: '/api/backup/restore', payload: { backup, confirmed: true, revision: next.revision } });
  assert.equal(restored.statusCode, 200);
  assert.equal(JSON.parse(readFileSync(join(dir, 'backups', restored.json().backupFile), 'utf8')).handbook[0].values.变动, '测试转专业');
  const second = openRepository(dir);
  try { assert.deepEqual(second.workspace().handbook, backup.handbook); } finally { second.close(); }
  assert.equal((await app.inject({ method: 'DELETE', url: '/api/handbook/' + id })).statusCode, 204);
  assert.equal((await app.inject({ method: 'DELETE', url: '/api/handbook/' + id })).statusCode, 404);
});

test('数据库从 v1 无损迁移，手册图片随 SQLite 快照恢复，旧版快照仍可恢复', async (t) => {
  const root = directory(), live = join(root, 'live');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(live);
  const old = new Database(join(live, 'classflow.sqlite'));
  old.exec(readFileSync(new URL('../apps/api/migrations/001_initial.sql', import.meta.url), 'utf8'));
  old.pragma('user_version = 1');
  const id = crypto.randomUUID(), instant = new Date().toISOString();
  old.prepare('INSERT INTO notices VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, '保留原通知', '测试', '', instant, instant, 0);
  old.close();
  const original = await backupDatabase(live, join(root, 'old-archive'), 2, 3);
  await restoreFresh(join(root, 'old-archive', original.name), join(root, 'old-restored'));
  const repo = openRepository(live);
  try {
    assert.equal(repo.workspace().notices[0].original, '保留原通知');
    assert.deepEqual(repo.workspace().handbook, []);
    const record = repo.saveHandbook(handbookInput.parse({ kind: 'activity', values: { 团日活动名称: '测试', 活动时间: '2026-11-15' }, photos: [{ name: 'test.png', data: 'data:image/png;base64,iVBORw0KGgo=' }] }));
    const saved = await backupDatabase(live, join(root, 'archive'), 2, 3);
    await restoreFresh(join(root, 'archive', saved.name), join(root, 'restored'));
    const copy = openRepository(join(root, 'restored'));
    try { assert.deepEqual(copy.workspace().handbook, [record]); } finally { copy.close(); }
    const duplicate = { ...repo.export(), version: 2, handbook: [record, record] };
    const { backupSchema } = await import('@classflow/shared/validation');
    assert.equal(backupSchema.safeParse(duplicate).success, false);
    const reminders = handbookReminders([record], '2026-11-15');
    assert.equal(reminders.find((r) => r.kind === 'activity')?.count, 1);
    assert.equal(handbookReminders([record], '2026-12-01').find((r) => r.kind === 'activity')?.count, 0);
  } finally { repo.close(); }
});
