import { useState } from 'react';
import { Plus, Mail, CheckCheck, ArrowUpRight } from 'lucide-react';
import type { Notice } from '@classflow/shared';
import { Empty, Modal, TaskRow, stamp, type ScreenProps } from './ui';

export function Inbox({ data, actions }: ScreenProps) {
  const [filter, setFilter] = useState('全部');
  const rows = data.notices.filter((n) => filter === '全部' ||
    (filter === '微信' ? n.source.startsWith('微信 · ') : n.processed === (filter === '已处理')));
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>
          <Mail />
          历史通知 <small>{rows.length}</small>
        </h2>
        <button className="primary" onClick={() => actions.open({ kind: 'noticeForm' })}>
          <Plus />
          录入通知
        </button>
      </div>
      <div className="tabs">
        {['全部', '未处理', '已处理', '微信'].map((x) => (
          <button key={x} aria-pressed={filter === x} onClick={() => setFilter(x)}>
            {x}
          </button>
        ))}
      </div>
      {filter === '微信' && <p className="muted">指定会话同步后会显示在这里。明确事项自动生成私人待办；日期不明或变更通知请打开详情核对。页面每 15 秒更新。</p>}
      {rows.length ? (
        rows.map((n) => (
          <button
            className="notice-row"
            key={n.id}
            onClick={() => actions.open({ kind: 'notice', id: n.id })}
          >
            <i className={'dot' + (n.processed ? ' quiet' : '')} />
            <span>
              <strong>{n.original}</strong>
              <small>
                {n.source} · {stamp(n.receivedAt)} · {n.processed ? '已处理' : '未处理'}
              </small>
            </span>
            <ArrowUpRight />
          </button>
        ))
      ) : (
        <Empty title="这里还没有通知">粘贴班群或老师的原文，稍后可以拆成多个任务。</Empty>
      )}
    </section>
  );
}
export function NoticeForm({ actions, now }: ScreenProps) {
  const [error, setError] = useState('');
  return (
    <Modal title="录入通知" close={actions.close} busy={actions.busy}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget),
            v = (name: string) => String(f.get(name) ?? '');
          if (!v('original').trim() || !v('source').trim()) {
            setError('请填写通知原文和来源');
            return;
          }
          const body = {
            original: v('original'),
            source: v('source'),
            notes: v('notes'),
            receivedAt: new Date(v('receivedAt') + ':00+08:00').toISOString(),
          };
          if (await actions.mutate('notices', 'POST', body, '通知原文已保存')) actions.close();
        }}
      >
        <div className="form-body">
          <label>
            通知原文
            <textarea
              name="original"
              rows={7}
              required
              autoFocus
              maxLength={100000}
              placeholder="在这里粘贴通知，保留原始换行…"
            />
          </label>
          <div className="form-grid">
            <label>
              来源
              <input name="source" required maxLength={200} placeholder="例如：班级微信群" />
            </label>
            <label>
              接收时间（北京时间）
              <input
                name="receivedAt"
                type="datetime-local"
                required
                defaultValue={now.date + 'T' + now.time}
              />
            </label>
          </div>
          <label>
            备注
            <textarea name="notes" rows={2} maxLength={20000} placeholder="记录需要留意的事项" />
          </label>
          {error && <p role="alert">{error}</p>}
        </div>
        <footer>
          <button type="button" disabled={actions.busy} onClick={actions.close}>
            取消
          </button>
          <button className="primary" disabled={actions.busy}>
            保存通知
          </button>
        </footer>
      </form>
    </Modal>
  );
}
export function NoticeDetail({ notice: n, data, actions, now }: ScreenProps & { notice: Notice }) {
  const tasks = data.tasks.filter((t) => t.sourceNoticeId === n.id);
  return (
    <Modal title="通知详情" close={actions.close} busy={actions.busy}>
      <div className="form-body">
        <div className="meta">
          <span className="tag">{n.processed ? '已处理' : '未处理'}</span>
          <b>{n.source}</b>
          <span>{stamp(n.receivedAt)}</span>
        </div>
        <h4>通知原文</h4>
        <p className="original paper">{n.original}</p>
        {n.notes && (
          <>
            <h4>内部备注</h4>
            <p className="original">{n.notes}</p>
          </>
        )}
        <h4>关联任务 · {tasks.length}</h4>
        {tasks.length ? (
          tasks.map((task) => <TaskRow key={task.id} {...{ task, actions, now }} />)
        ) : (
          <p className="muted">可以从这条通知创建第一项任务。</p>
        )}
      </div>
      <footer>
        <button
          disabled={actions.busy}
          onClick={() =>
            actions.mutate(
              'notices/' + n.id,
              'PATCH',
              { processed: !n.processed },
              n.processed ? '通知已设为未处理' : '通知已标记处理',
            )
          }
        >
          <CheckCheck size={16} />
          {n.processed ? '设为未处理' : '标记已处理'}
        </button>
        <button className="primary" onClick={() => actions.open({ kind: 'taskForm', source: n.id })}>
          <Plus size={16} />
          转为任务
        </button>
      </footer>
    </Modal>
  );
}
