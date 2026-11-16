import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { CalendarCheck2, Check, X } from 'lucide-react';
import { campusClock, overdue, type Task, type TaskInput, type Workspace } from '@classflow/shared';

export type Page = 'home' | 'handbook' | 'inbox' | 'tasks' | 'schedule' | 'backup' | 'presentations';
export type Overlay =
  | { kind: 'task'; id: string }
  | { kind: 'taskForm'; id?: string; source?: string }
  | { kind: 'notice'; id: string }
  | { kind: 'noticeForm' }
  | { kind: 'search' };
export type Actions = {
  open: (value: Overlay) => void;
  go: (page: Page) => void;
  close: () => void;
  mutate: (path: string, method: string, body: unknown, message: string) => Promise<boolean>;
  toggle: (task: Task) => void;
  busy: boolean;
};
export type ScreenProps = { data: Workspace; actions: Actions; now: ReturnType<typeof campusClock> };
export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch('/api/' + path, {
    method,
    credentials: 'same-origin',
    headers: {
      ...(method === 'GET' ? {} : { 'X-ClassFlow-Request': '1' }),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  if (!response.ok) {
    if (response.status === 401 && path !== 'auth/login')
      window.dispatchEvent(new Event('classflow-expired'));
    const problem = await response.json().catch(() => ({}));
    throw new Error(problem.message || '无法连接本地服务，请确认后端已启动。');
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
export function taskFields(t: Task): TaskInput {
  return {
    title: t.title,
    description: t.description,
    category: t.category,
    priority: t.priority,
    status: t.status,
    dueDate: t.dueDate,
    dueTime: t.dueTime,
    assignee: t.assignee,
    sourceNoticeId: t.sourceNoticeId,
    visibility: t.visibility,
  };
}
export function stamp(instant: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(instant));
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <CalendarCheck2 size={23} />
      </span>
      <strong>{title}</strong>
      {children && <small>{children}</small>}
    </div>
  );
}
export function Modal({
  title,
  children,
  close,
  busy = false,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) close();
      }}
    >
      <header className="modal-head">
        <h2>{title}</h2>
        <button className="icon" aria-label="关闭" onClick={close} disabled={busy}>
          <X size={18} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
export function TaskRow({
  task: t,
  actions,
  now,
}: {
  task: Task;
  actions: Actions;
  now: ScreenProps['now'];
}) {
  const done = t.status === '已完成',
    late = overdue(t, now);
  return (
    <div className={'task-row' + (done ? ' done' : '')}>
      <button
        className={'check' + (done ? ' checked' : '')}
        aria-label={(done ? '重新打开 ' : '完成 ') + t.title}
        disabled={actions.busy}
        onClick={() => actions.toggle(t)}
      >
        {done && <Check size={13} />}
      </button>
      <button className="row-link" onClick={() => actions.open({ kind: 'task', id: t.id })}>
        <strong>{t.title}</strong>
        <span className="meta">
          <span className="tag">{t.category}</span>
          <span className={'tag p' + t.priority}>{t.priority}优先级</span>
          <span className={late ? 'late' : ''}>
            {late ? '已逾期 · ' : ''}
            {t.dueDate}
            {t.dueTime ? ' ' + t.dueTime : ''}
          </span>
          <span>{t.status}</span>
        </span>
      </button>
    </div>
  );
}
export function SelectField({
  label,
  name,
  values,
  initial,
}: {
  label: string;
  name: string;
  values: readonly string[];
  initial: string;
}) {
  return (
    <label>
      {label}
      <select aria-label={label} name={name} defaultValue={initial}>
        {values.map((v) => (
          <option key={v}>{v}</option>
        ))}
      </select>
    </label>
  );
}
