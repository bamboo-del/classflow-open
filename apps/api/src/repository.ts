import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { and, asc, desc, eq, gte, inArray, like, lt, sql } from 'drizzle-orm';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { Backup, NoticeInput, Preview, TaskInput } from '@classflow/shared';
import { notices, tasks, handbook } from './schema.js';
import type { HandbookInput } from '@classflow/shared/handbook';
import { extractWechat, type WechatMessage } from './wechat-extract.js';
import { aiPending, type AiJob, type AiResult } from './wechat-ai.js';

export class RequestError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export function openRepository(directory: string) {
  mkdirSync(directory, { recursive: true });
  const connection = new Database(join(directory, 'classflow.sqlite'));
  connection.pragma('foreign_keys = ON');
  try {
    connection
      .transaction(() => {
        const version = connection.pragma('user_version', { simple: true });
        if (version === 2) return;
        if (version !== 0 && version !== 1) throw new Error('数据库版本不兼容，请使用匹配的程序。');
        if (version === 0) connection.exec(readFileSync(new URL('../migrations/001_initial.sql', import.meta.url), 'utf8'));
        connection.exec(readFileSync(new URL('../migrations/002_handbook.sql', import.meta.url), 'utf8'));
        connection.pragma('user_version = 2');
      })
      .immediate();
  } catch (error) {
    connection.close();
    throw error;
  }
  const db = drizzle(connection);
  const snapshot = () => ({
    tasks: db
      .select()
      .from(tasks)
      .orderBy(asc(tasks.dueDate), sql`coalesce(${tasks.dueTime}, '23:59')`, asc(tasks.id))
      .all(),
    notices: db.select().from(notices).orderBy(desc(notices.receivedAt), asc(notices.id)).all(),
    handbook: db.select().from(handbook).orderBy(desc(handbook.updatedAt), asc(handbook.id)).all(),
  });
  const revision = (data: ReturnType<typeof snapshot>) =>
    createHash('sha256').update(JSON.stringify(data)).digest('hex');
  const exported = (): Backup => ({ version: 2, exportedAt: new Date().toISOString(), ...snapshot() });
  const requireNotice = (id: string) => {
    if (!db.select({ id: notices.id }).from(notices).where(eq(notices.id, id)).get())
      throw new RequestError(404, '找不到来源通知');
  };
  return {
    close: () => connection.close(),
    workspace: () => connection.transaction(snapshot)(),
    export: () => connection.transaction(exported)(),
    saveHandbook(input: HandbookInput, id?: string) {
      const now = new Date().toISOString();
      if (id) {
        const previous = db.select().from(handbook).where(eq(handbook.id, id)).get();
        if (!previous) throw new RequestError(404, '找不到手册记录');
        if (previous.kind !== input.kind) throw new RequestError(400, '不能更改记录类别');
        return db.update(handbook).set({ ...input, updatedAt: now }).where(eq(handbook.id, id)).returning().get();
      }
      return db.insert(handbook).values({ ...input, id: randomUUID(), createdAt: now, updatedAt: now }).returning().get();
    },
    removeHandbook(id: string) {
      if (!db.delete(handbook).where(eq(handbook.id, id)).run().changes) throw new RequestError(404, '找不到手册记录');
    },
    ingestWechat(input: WechatMessage, analyze = false) {
      const pending = analyze && input.format !== 'card';
      const extraction = input.format === 'card' || pending
        ? { tasks: [], warnings: [] }
        : extractWechat(input.text, input.sentAt);
      // Stable UUID survives JSON backup/restore without a second deduplication store.
      const digest = createHash('sha256')
        .update(JSON.stringify(['wechat-v1', input.account, input.chatId, input.messageId]))
        .digest('hex');
      const id = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
      return connection.transaction(() => {
        const previous = db.select().from(notices).where(eq(notices.id, id)).get();
        if (previous) {
          if (previous.original !== input.text || previous.receivedAt !== input.sentAt)
            throw new RequestError(409, '同一微信消息 ID 的原文或时间不一致，已拒绝覆盖。');
          return { status: 'duplicate', noticeId: id, taskCount: 0 };
        }
        const now = new Date().toISOString();
        db.insert(notices).values({
          id, original: input.text, source: `微信 · ${input.chatName}`,
          receivedAt: input.sentAt, createdAt: now, processed: false,
          notes: pending
            ? aiPending + `发信人：${input.sender || '未识别'}`
            : `发信人：${input.sender || '未识别'}\n` + (input.format === 'card'
              ? '已保存卡片信息，原附件请在微信中打开。'
              : `自动创建 ${extraction.tasks.length} 项私人待办。`
                + (extraction.warnings.length ? '\n待核对：\n' + extraction.warnings.join('\n') : '')),
        }).run();
        for (const task of extraction.tasks) {
          db.insert(tasks).values({ ...task, id: randomUUID(), sourceNoticeId: id,
            createdAt: now, updatedAt: now, completedAt: null }).run();
        }
        return { status: 'created', noticeId: id, taskCount: extraction.tasks.length,
          warnings: extraction.warnings };
      }).immediate();
    },
    nextWechatAi(groups: readonly string[]): AiJob | undefined {
      const notice = db.select().from(notices).where(and(
        inArray(notices.source, groups.map((name) => `微信 · ${name}`)),
        eq(notices.processed, false), like(notices.notes, aiPending + '%'),
      )).orderBy(asc(notices.createdAt), asc(notices.receivedAt)).limit(1).get();
      if (!notice) return;
      const cutoff = new Date(Date.parse(notice.receivedAt) - 24 * 3600000).toISOString();
      const context = db.select({ id: notices.id, original: notices.original, receivedAt: notices.receivedAt })
        .from(notices).where(and(eq(notices.source, notice.source),
          lt(notices.receivedAt, notice.receivedAt), gte(notices.receivedAt, cutoff),
        )).orderBy(desc(notices.receivedAt), asc(notices.id)).limit(4).all();
      return { notice, context };
    },
    finishWechatAi(job: AiJob, result: AiResult) {
      connection.transaction(() => {
        const n = db.select().from(notices).where(eq(notices.id, job.notice.id)).get();
        if (!n || n.processed || !n.notes.startsWith(aiPending) || n.notes !== job.notice.notes
          || n.original !== job.notice.original || n.receivedAt !== job.notice.receivedAt) return;
        const now = new Date().toISOString();
        const alreadyHasTask = db.select({ id: tasks.id }).from(tasks).where(eq(tasks.sourceNoticeId, n.id)).limit(1).get();
        const nextTasks = alreadyHasTask ? [] : result.tasks;
        for (const task of nextTasks) {
          db.insert(tasks).values({ ...task, id: randomUUID(), sourceNoticeId: n.id,
            status: '待办', visibility: '私人', createdAt: now, updatedAt: now, completedAt: null }).run();
        }
        const details = [n.notes.slice(aiPending.length).split('\n')[0],
          result.summary && `AI 摘要：${result.summary}`,
          alreadyHasTask ? '已有待办，AI 本次未新增。' : `AI 生成 ${nextTasks.length} 项私人待办。`,
          result.review.length && `待核对：\n${result.review.join('\n')}`,
        ].filter(Boolean).join('\n');
        db.update(notices).set({ notes: details }).where(eq(notices.id, n.id)).run();
      }).immediate();
    },
    createNotice(input: NoticeInput) {
      return db
        .insert(notices)
        .values({ ...input, id: randomUUID(), processed: false, createdAt: new Date().toISOString() })
        .returning()
        .get();
    },
    markNotice(id: string, processed: boolean) {
      const record = db.update(notices).set({ processed, ...(processed && {
        notes: sql`case when ${notices.notes} like ${aiPending + '%'} then ${'已手动处理\n'} || substr(${notices.notes}, ${aiPending.length + 1}) else ${notices.notes} end`,
      }) }).where(eq(notices.id, id)).returning().get();
      if (!record) throw new RequestError(404, '找不到通知');
      return record;
    },
    saveTask(input: TaskInput, id?: string) {
      return connection
        .transaction(() => {
          if (input.sourceNoticeId) requireNotice(input.sourceNoticeId);
          const now = new Date().toISOString();
          const previous = id ? db.select().from(tasks).where(eq(tasks.id, id)).get() : null;
          if (id && !previous) throw new RequestError(404, '找不到任务');
          const fields = {
            ...input,
            updatedAt: now,
            completedAt: input.status === '已完成' ? (previous?.completedAt ?? now) : null,
          };
          if (id) return db.update(tasks).set(fields).where(eq(tasks.id, id)).returning().get();
          return db
            .insert(tasks)
            .values({ ...fields, id: randomUUID(), createdAt: now })
            .returning()
            .get();
        })
        .immediate();
    },
    removeTask(id: string) {
      if (!db.delete(tasks).where(eq(tasks.id, id)).run().changes) throw new RequestError(404, '找不到任务');
    },
    preview(backup: Backup): Preview {
      const current = connection.transaction(snapshot)();
      return {
        revision: revision(current),
        current: { tasks: current.tasks.length, notices: current.notices.length, handbook: current.handbook.length },
        incoming: { tasks: backup.tasks.length, notices: backup.notices.length, handbook: backup.version === 2 ? backup.handbook.length : current.handbook.length },
      };
    },
    restore(backup: Backup, expected: string) {
      return connection
        .transaction(() => {
          const current = snapshot();
          if (revision(current) !== expected)
            throw new RequestError(409, '预览后数据有变化，请重新选择文件核对摘要。');
          const dir = join(directory, 'backups');
          mkdirSync(dir, { recursive: true });
          const now = new Date().toISOString();
          const backupFile = 'before-restore-' + now.replaceAll(':', '-') + '-' + randomUUID() + '.json';
          writeFileSync(
            join(dir, backupFile),
            JSON.stringify({ version: 2, exportedAt: now, ...current }, null, 2),
            { flag: 'wx', flush: true },
          );
          db.delete(tasks).run();
          db.delete(notices).run();
          for (const n of backup.notices) db.insert(notices).values(n).run();
          for (const t of backup.tasks) db.insert(tasks).values(t).run();
          // 老版本文件只含通知和任务，恢复时保留当前手册，避免静默清空。
          if (backup.version === 2) {
            db.delete(handbook).run();
            for (const record of backup.handbook) db.insert(handbook).values(record).run();
          }
          return { backupFile };
        })
        .immediate();
    },
  };
}
