import { useState } from 'react';
import { Plus, Search, Pencil, Trash2 } from 'lucide-react';
import { categories, priorities, statuses, visibilities, type Task, type TaskInput } from '@classflow/shared';
import { Empty, Modal, SelectField, TaskRow, stamp, taskFields, type ScreenProps } from './ui';

export function Tasks({ data, actions, now }: ScreenProps) {
  const [q, search] = useState(''),
    [status, setStatus] = useState(''),
    [category, setCategory] = useState(''),
    [priority, setPriority] = useState('');
  const rows = data.tasks.filter(
    (t) =>
      (!status || t.status === status) &&
      (!category || t.category === category) &&
      (!priority || t.priority === priority) &&
      [t.title, t.description, t.assignee].join(' ').toLowerCase().includes(q.trim().toLowerCase()),
  );
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>
          全部任务 <small>{rows.length}</small>
        </h2>
        <button className="primary" onClick={() => actions.open({ kind: 'taskForm' })}>
          <Plus />
          新建任务
        </button>
      </div>
      <div className="filters">
        <label className="searchbox">
          <Search />
          <input
            aria-label="搜索任务"
            placeholder="搜索标题、描述或负责人"
            value={q}
            onChange={(e) => search(e.target.value)}
          />
        </label>
        {(
          [
            [status, setStatus, statuses, '状态'],
            [category, setCategory, categories, '分类'],
            [priority, setPriority, priorities, '优先级'],
          ] as const
        ).map((item) => {
          const [value, change, options, label] = item;
          return (
            <select
              key={label}
              aria-label={'筛选' + label}
              value={value}
              onChange={(e) => change(e.target.value)}
            >
              <option value="">{'全部' + label}</option>
              {options.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          );
        })}
      </div>
      {rows.length ? (
        rows.map((task) => <TaskRow key={task.id} {...{ task, actions, now }} />)
      ) : (
        <Empty title="没有符合条件的任务">新建任务或调整搜索与筛选条件。</Empty>
      )}
    </section>
  );
}
export function TaskForm({
  data,
  actions,
  now,
  task,
  source,
}: { task?: Task; source?: string } & ScreenProps) {
  const [error, setError] = useState('');
  const initial = task
    ? taskFields(task)
    : {
        title: '',
        description: '',
        category: '其他',
        priority: '中',
        status: '待办',
        dueDate: now.date,
        dueTime: null,
        assignee: '',
        sourceNoticeId: source ?? null,
        visibility: '私人',
      };
  return (
    <Modal title={task ? '编辑任务' : '新建任务'} close={actions.close} busy={actions.busy}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget),
            v = (name: string) => String(f.get(name) ?? '');
          if (!v('title').trim()) {
            setError('请填写任务标题');
            return;
          }
          const body = {
            ...Object.fromEntries(f),
            title: v('title').trim(),
            dueTime: v('dueTime') || null,
            sourceNoticeId: v('sourceNoticeId') || null,
          } as TaskInput;
          if (
            await actions.mutate(
              task ? 'tasks/' + task.id : 'tasks',
              task ? 'PUT' : 'POST',
              body,
              task ? '任务已更新' : '任务已创建',
            )
          ) {
            if (source) actions.open({ kind: 'notice', id: source });
            else actions.close();
          }
        }}
      >
        <div className="form-body">
          <label>
            任务标题
            <input
              name="title"
              required
              autoFocus
              maxLength={200}
              defaultValue={initial.title}
              placeholder="需要跟进什么事？"
            />
          </label>
          <label>
            描述
            <textarea name="description" rows={3} maxLength={20000} defaultValue={initial.description} />
          </label>
          <div className="form-grid">
            <SelectField label="分类" name="category" values={categories} initial={initial.category} />
            <SelectField label="优先级" name="priority" values={priorities} initial={initial.priority} />
            <label>
              截止日期
              <input type="date" name="dueDate" required defaultValue={initial.dueDate} />
            </label>
            <label>
              截止时间（可选）
              <input type="time" name="dueTime" defaultValue={initial.dueTime ?? ''} />
            </label>
            <SelectField label="状态" name="status" values={statuses} initial={initial.status} />
            <SelectField
              label="可见性"
              name="visibility"
              values={visibilities}
              initial={initial.visibility}
            />
          </div>
          <label>
            负责人或跟进对象
            <input name="assignee" maxLength={200} defaultValue={initial.assignee} />
          </label>
          <label>
            来源通知
            <select name="sourceNoticeId" defaultValue={initial.sourceNoticeId ?? ''}>
              <option value="">无来源通知</option>
              {data.notices.map((n) => (
                <option value={n.id} key={n.id}>
                  {n.source} · {n.original.slice(0, 55)}
                </option>
              ))}
            </select>
          </label>
          {error && <p role="alert">{error}</p>}
        </div>
        <footer>
          <button type="button" onClick={actions.close} disabled={actions.busy}>
            取消
          </button>
          <button className="primary" disabled={actions.busy}>
            保存任务
          </button>
        </footer>
      </form>
    </Modal>
  );
}
export function TaskDetail({ task: t, data, actions }: ScreenProps & { task: Task }) {
  const [confirm, setConfirm] = useState(false);
  const notice = data.notices.find((n) => n.id === t.sourceNoticeId);
  return (
    <Modal title="任务详情" close={actions.close} busy={actions.busy}>
      <div className="form-body">
        <h3>{t.title}</h3>
        <div className="meta">
          <span className="tag">{t.category}</span>
          <span className={'tag p' + t.priority}>{t.priority}优先级</span>
          <span className="tag">{t.status}</span>
        </div>
        <p className="original">{t.description || '暂无描述'}</p>
        <dl>
          {[
            ['截止时间', t.dueDate + ' ' + (t.dueTime ?? '全天')],
            ['负责人', t.assignee || '未填写'],
            ['可见性', t.visibility],
            ['创建时间', stamp(t.createdAt)],
            ['更新时间', stamp(t.updatedAt)],
            ...(t.completedAt ? [['完成时间', stamp(t.completedAt)]] : []),
          ].map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        {notice && (
          <button className="source-link" onClick={() => actions.open({ kind: 'notice', id: notice.id })}>
            查看来源通知 · {notice.source}
          </button>
        )}
        {confirm && (
          <div className="warning" role="alert">
            <strong>确认删除「{t.title}」？</strong>
            <p>任务将永久删除，来源通知会保留。</p>
            <button onClick={() => setConfirm(false)}>取消删除</button>{' '}
            <button
              className="danger"
              disabled={actions.busy}
              onClick={async () => {
                if (await actions.mutate('tasks/' + t.id, 'DELETE', undefined, '任务已删除')) actions.close();
              }}
            >
              确认删除
            </button>
          </div>
        )}
      </div>
      <footer>
        <button aria-label="删除任务" onClick={() => setConfirm(true)}>
          <Trash2 size={16} />
        </button>
        <button onClick={() => actions.open({ kind: 'taskForm', id: t.id })}>
          <Pencil size={15} />
          编辑任务
        </button>
        <button className="primary" disabled={actions.busy} onClick={() => actions.toggle(t)}>
          {t.status === '已完成' ? '重新打开' : '标记完成'}
        </button>
      </footer>
    </Modal>
  );
}
