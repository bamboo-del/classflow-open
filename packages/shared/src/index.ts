import type { Task, Workspace } from './validation.js';
export type { TaskInput, Task, NoticeInput, Notice, Backup, Workspace, Preview } from './validation.js';

export const categories = ['通知', '材料', '会议', '活动', '其他'] as const;
export const priorities = ['高', '中', '低'] as const;
export const statuses = ['待办', '进行中', '已完成'] as const;
export const visibilities = ['私人', '未来可公开'] as const;
// 校园截止日期始终是北京时间的日历值，不经过设备的本地时区。
export function campusClock(at = new Date()) {
  const local = new Date(at.getTime() + 8 * 3600000).toISOString();
  return { date: local.slice(0, 10), time: local.slice(11, 16) };
}
export function shiftDay(day: string, offset: number) {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}
export function monday(day: string) {
  return shiftDay(day, -((new Date(day + 'T00:00:00Z').getUTCDay() + 6) % 7));
}
export function overdue(t: Task, now: ReturnType<typeof campusClock>) {
  return (
    t.status !== '已完成' &&
    (t.dueDate < now.date || (t.dueDate === now.date && t.dueTime !== null && t.dueTime < now.time))
  );
}
export function summarize(data: Pick<Workspace, 'tasks' | 'notices'>, now = campusClock()) {
  const open = data.tasks.filter((t) => t.status !== '已完成');
  const done = data.tasks.length - open.length;
  return {
    today: open.filter((t) => t.dueDate === now.date),
    late: open.filter((t) => overdue(t, now)),
    week: open.filter((t) => t.dueDate > now.date && t.dueDate <= shiftDay(now.date, 7)),
    pending: data.notices.filter((n) => !n.processed).length,
    done,
    total: data.tasks.length,
    rate: data.tasks.length ? Math.round((100 * done) / data.tasks.length) : 0,
  };
}
