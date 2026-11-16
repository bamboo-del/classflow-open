import { z } from 'zod';
import { categories, priorities, statuses, visibilities } from '@classflow/shared';
import { handbookRecord, type HandbookRecord } from '@classflow/shared/handbook';

const meaningful = (limit: number) =>
  z
    .string()
    .max(limit)
    .refine((s) => s.trim().length > 0, '不能为空');
const instant = z.iso.datetime();
export const taskInput = z.strictObject({
  title: meaningful(200),
  description: z.string().max(20000),
  category: z.enum(categories),
  priority: z.enum(priorities),
  status: z.enum(statuses),
  dueDate: z.iso.date(),
  dueTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .nullable(),
  assignee: z.string().max(200),
  sourceNoticeId: z.uuid().nullable(),
  visibility: z.enum(visibilities),
});
export const taskCreate = taskInput.extend({ visibility: taskInput.shape.visibility.default('私人') });
const taskRecord = taskInput
  .extend({
    id: z.uuid(),
    createdAt: instant,
    updatedAt: instant,
    completedAt: instant.nullable(),
  })
  .refine((t) => (t.status === '已完成') === (t.completedAt !== null), '完成时间和状态不一致');
export const noticeInput = z.strictObject({
  original: meaningful(100000),
  source: meaningful(200),
  receivedAt: instant,
  notes: z.string().max(20000),
});
const noticeRecord = noticeInput.extend({ id: z.uuid(), processed: z.boolean(), createdAt: instant });
export const noticeState = z.strictObject({ processed: z.boolean() });
const backupFields = {
    exportedAt: instant,
    tasks: z.array(taskRecord),
    notices: z.array(noticeRecord),
};
export const backupSchema = z.union([
    z.strictObject({ version: z.literal(1), ...backupFields }),
    z.strictObject({ version: z.literal(2), ...backupFields, handbook: z.array(handbookRecord) }),
  ])
  .superRefine((b, ctx) => {
    const notices = new Set(b.notices.map((n) => n.id));
    if (notices.size !== b.notices.length || new Set(b.tasks.map((t) => t.id)).size !== b.tasks.length)
      ctx.addIssue({ code: 'custom', message: '备份包含重复 ID' });
    if (b.tasks.some((t) => t.sourceNoticeId && !notices.has(t.sourceNoticeId)))
      ctx.addIssue({ code: 'custom', message: '任务关联了不存在的通知' });
    if (b.version === 2 && new Set(b.handbook.map((r) => r.id)).size !== b.handbook.length)
      ctx.addIssue({ code: 'custom', message: '手册记录包含重复 ID' });
  });
export const restoreRequest = z.strictObject({
  backup: backupSchema,
  confirmed: z.literal(true),
  revision: z.string().length(64),
});
export type TaskInput = z.infer<typeof taskInput>;
export type Task = z.infer<typeof taskRecord>;
export type Notice = z.infer<typeof noticeRecord>;
export type NoticeInput = z.infer<typeof noticeInput>;
export type Backup = z.infer<typeof backupSchema>;
export type Workspace = Pick<Backup, 'tasks' | 'notices'> & { handbook: HandbookRecord[] };
export type Preview = {
  revision: string;
  current: { tasks: number; notices: number; handbook: number };
  incoming: { tasks: number; notices: number; handbook: number };
};
