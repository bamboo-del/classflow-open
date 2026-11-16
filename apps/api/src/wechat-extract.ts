import { campusClock, monday, shiftDay, type TaskInput } from '@classflow/shared';
import { taskInput } from '@classflow/shared/validation';
import { z } from 'zod';

export const wechatMessage = z.strictObject({
  account: z.string().trim().min(1).max(200),
  chatId: z.string().trim().min(1).max(200),
  chatName: z.string().trim().min(1).max(150),
  messageId: z.string().trim().min(1).max(200),
  sender: z.string().max(200),
  text: z.string().min(1).max(20000).refine((s) => Boolean(s.trim()), '消息不能为空'),
  format: z.enum(['text', 'card']).optional(),
  sentAt: z.iso.datetime(),
});
export type WechatMessage = z.infer<typeof wechatMessage>;
export type Extraction = { actionable: boolean; tasks: TaskInput[]; warnings: string[] };

const action = /提交|上交|报送|填写|报名|参加|开会|会议|集合|收齐|统计|完成|缴纳|交齐|上传/;
const cancelled = /取消|不用|无需|不必|暂缓|延期|改期|推迟|已完成|已提交|已经提交|已上交/;
const datePattern = /\d{4}-\d{1,2}-\d{1,2}|(?:\d{4}年)?\d{1,2}月\d{1,2}[日号]|大后天|后天|明天|今天|今晚|明晚|(?:本周|下周|周|星期)[一二三四五六日天]/g;
function calendar(token: string, reference: string): string | null {
  const relative: Record<string, number> = { 今天: 0, 今晚: 0, 明天: 1, 明晚: 1, 后天: 2, 大后天: 3 };
  if (token in relative) return shiftDay(reference, relative[token]);
  if (/周|星期/.test(token)) {
    const weekday = '一二三四五六日'.indexOf(token.at(-1)!.replace('天', '日'));
    const day = shiftDay(monday(reference), weekday + (token.startsWith('下周') ? 7 : 0));
    return day < reference && !token.startsWith('本周') ? null : day;
  }
  const parts = token.match(/\d+/g)!;
  if (parts.length === 2) parts.unshift(reference.slice(0, 4));
  const day = parts.map((p, i) => p.padStart(i ? 2 : 4, '0')).join('-');
  return taskInput.shape.dueDate.safeParse(day).success ? day : null;
}

export function wechatDeadline(line: string, sentAt: string): Pick<TaskInput, 'dueDate' | 'dueTime'> | string {
  const dates = [...line.matchAll(datePattern)].map((m) => m[0]);
  if (dates.length !== 1 || /月底|月初|近期|稍后|待定|之前另行/.test(line)) return '截止日期不明确';
  const dueDate = calendar(dates[0], campusClock(new Date(sentAt)).date);
  if (!dueDate) return '日期无效或周次不明确';
  const times = [...line.matchAll(/(?:(凌晨|早上|上午|中午|下午|晚上|晚)\s*)?(\d{1,2})(?:[:：](\d{2})|点(?:(\d{1,2})分?|半)?|时(?:(\d{1,2})分)?)/g)];
  if (times.length > 1 || /[一二三四五六七八九十两]+点|[一二三四五六七八九十两]+时|点[一二三四五六七八九十两]/.test(line)) {
    return '时间范围或中文时刻需要核对';
  }
  if (!times.length) {
    return /上午|下午|中午|晚上|凌晨|晚|早上/.test(line) ? '没有明确截止时刻' : { dueDate, dueTime: null };
  }
  const m = times[0];
  let hour = Number(m[2]);
  const minute = Number(m[3] ?? m[4] ?? m[5] ?? (m[0].endsWith('半') ? 30 : 0));
  const period = m[1] ?? (dates[0].endsWith('晚') ? '晚上' : '');
  if (hour > 23 || minute > 59 || (m[1] && hour > 12 && !(m[1] === '晚' && dates[0].endsWith('晚')))) return '时刻无效';
  if (['下午', '晚上', '晚', '中午'].includes(period) && hour < 12) hour += 12;
  if (period === '凌晨' && hour === 12) hour = 0;
  if (!period && hour > 0 && hour < 12) return '请明确上午或下午';
  return { dueDate, dueTime: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` };
}

// Conservative local rules: every generated task needs its own unambiguous date.
// Unknown expressions remain in the original notice for manual processing.
export function extractWechat(text: string, sentAt: string): Extraction {
  const result: Extraction = { actionable: action.test(text), tasks: [], warnings: [] };
  if (!result.actionable) return result;
  if (cancelled.test(text)) {
    result.warnings.push('消息包含取消、变更或已办事项，请人工核对原文；未自动修改已有任务。');
    return result;
  }
  for (const raw of text.split(/[\n；;。]+/).filter((s) => s.trim())) {
    const line = raw.trim();
    if (!action.test(line)) continue;
    const warn = (reason: string) => result.warnings.push(reason + '：' + line.slice(0, 100));
    if (cancelled.test(line) || /[?？]|是否|能否|可否|如果|假如/.test(line)) {
      warn('可能是取消、变更、已办事项或询问，请核对');
      continue;
    }
    const deadline = wechatDeadline(line, sentAt);
    if (typeof deadline === 'string') { warn(deadline); continue; }
    const task = taskInput.parse({
      title: line.slice(0, 200), description: line,
      category: /会议|开会|集合/.test(line) ? '会议' : /材料|表格|名单|报告|提交|上交|报送/.test(line) ? '材料' : /活动|报名/.test(line) ? '活动' : '通知',
      priority: /紧急|务必|重要/.test(line) ? '高' : '中', status: '待办',
      ...deadline, assignee: '', sourceNoticeId: null, visibility: '私人',
    });
    result.tasks.push(task);
  }
  return result;
}
