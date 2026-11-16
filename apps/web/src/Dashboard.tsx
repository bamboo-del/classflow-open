import { useEffect, useRef, useState } from 'react';
import { animate } from 'animejs';
import { useReducedMotion } from 'motion/react';
import {
  ArrowRight,
  CalendarDays,
  CheckCheck,
  CheckSquare2,
  CircleCheck,
  ClipboardList,
  Mail,
  Plus,
  TriangleAlert,
} from 'lucide-react';
import { monday, shiftDay, summarize } from '@classflow/shared';
import { Empty, TaskRow, stamp, type ScreenProps } from './ui';
import { HandbookOverview } from './Handbook';

function ProgressBar({ rate }: { rate: number }) {
  const ref = useRef<HTMLSpanElement>(null),
    reduced = useReducedMotion();
  useEffect(() => {
    const el = ref.current!;
    // 本地 motion-kit 的 rule/chartbase 展开方式。左边缘固定，缩短到工作台反馈时长。
    if (reduced) {
      el.style.transform = 'scaleX(' + rate / 100 + ')';
      return;
    }
    const animation = animate(el, { scaleX: rate / 100, duration: 240, ease: 'out(3)' });
    return () => {
      animation.cancel();
    };
  }, [rate, reduced]);
  return (
    <div
      className="bar"
      role="progressbar"
      aria-label="本周任务完成率"
      aria-valuenow={rate}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span ref={ref} />
    </div>
  );
}
export function Dashboard({ data, actions, now }: ScreenProps) {
  const [tab, setTab] = useState<'today' | 'late' | 'week'>('today');
  const stats = summarize(data, now),
    start = monday(now.date),
    end = shiftDay(start, 6);
  const week = data.tasks.filter((t) => t.dueDate >= start && t.dueDate <= end),
    done = week.filter((t) => t.status === '已完成').length;
  const weeklyRate = week.length ? Math.round((done * 100) / week.length) : 0;
  const metrics = [
    { name: '今日待办', value: stats.today.length, icon: CheckSquare2, color: 'violet' },
    { name: '已逾期', value: stats.late.length, icon: TriangleAlert, color: 'rose' },
    { name: '7天内截止', value: stats.week.length, icon: CalendarDays, color: 'blue' },
    { name: '待处理通知', value: stats.pending, icon: Mail, color: 'violet' },
    { name: '已完成', value: stats.done, icon: CircleCheck, color: 'green' },
  ];
  return (
    <>
      <HandbookOverview {...{ data, actions, now }} />
      <div className="metrics">
        {metrics.map((m) => (
          <div className={'metric ' + m.color} key={m.name}>
            <m.icon className="metric-icon" />
            <small>{m.name}</small>
            <strong>{m.value}</strong>
          </div>
        ))}
        <div className="metric rate-card">
          <small>任务完成率</small>
          <strong>{stats.rate}%</strong>
          <svg viewBox="0 0 48 48" aria-hidden="true">
            <circle cx="24" cy="24" r="19" />
            <circle cx="24" cy="24" r="19" pathLength="100" strokeDasharray={stats.rate + ' 100'} />
          </svg>
        </div>
      </div>
      <div className="dashboard-grid">
        <section className="panel">
          <div className="panel-head">
            <h2>
              <CheckSquare2 />
              截止待办
            </h2>
            <button className="tint" onClick={() => actions.open({ kind: 'taskForm' })}>
              <Plus />
              新建任务
            </button>
          </div>
          <div className="tabs compact">
            {(['today', 'late', 'week'] as const).map((key, i) => (
              <button key={key} aria-pressed={key === tab} onClick={() => setTab(key)}>
                {['今日', '已逾期', '未来七天'][i]}
              </button>
            ))}
          </div>
          {stats[tab].length ? (
            stats[tab].map((task) => <TaskRow key={task.id} {...{ task, actions, now }} />)
          ) : (
            <Empty
              title={
                tab === 'today' ? '今日暂无待办' : tab === 'late' ? '没有已逾期任务' : '未来七天暂无截止任务'
              }
            >
              有新的班务时，在这里创建任务。
            </Empty>
          )}
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>
              <Mail />
              最近通知
            </h2>
            <button className="text-link" onClick={() => actions.go('inbox')}>
              查看全部
              <ArrowRight />
            </button>
          </div>
          {data.notices.length ? (
            data.notices.slice(0, 4).map((n) => (
              <button
                className="notice-row"
                key={n.id}
                onClick={() => actions.open({ kind: 'notice', id: n.id })}
              >
                <i className={'dot' + (n.processed ? ' quiet' : '')} />
                <span>
                  <strong>{n.original}</strong>
                  <small>
                    {n.source} · {stamp(n.receivedAt)}
                  </small>
                </span>
              </button>
            ))
          ) : (
            <div className="intake">
              <span className="mail-art">
                <Mail />
              </span>
              <strong>从一条通知开始</strong>
              <p>把老师或班群的原文存进来，再逐项跟进。</p>
              <button className="tint" onClick={() => actions.open({ kind: 'noticeForm' })}>
                <Plus />
                录入通知
              </button>
            </div>
          )}
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>
              <CheckCheck />
              本周任务进度
            </h2>
            <small>按截止日期</small>
          </div>
          <div className="progress-numbers">
            <span>
              <b>{done}</b> / {week.length} 项
            </span>
            <strong>{weeklyRate}%</strong>
          </div>
          <ProgressBar rate={weeklyRate} />
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>
              <CalendarDays />
              本周日程
            </h2>
            <button className="text-link" onClick={() => actions.go('schedule')}>
              查看日程
              <ArrowRight />
            </button>
          </div>
          {week.length ? (
            week.slice(0, 3).map((t) => (
              <button className="agenda" key={t.id} onClick={() => actions.open({ kind: 'task', id: t.id })}>
                <b>{t.dueDate.slice(5)}</b>
                <span>{t.title}</span>
                <small>{t.dueTime ?? '全天'}</small>
              </button>
            ))
          ) : (
            <p className="cal-empty">
              <ClipboardList size={18} />
              本周还没有安排截止事项。
            </p>
          )}
        </section>
      </div>
    </>
  );
}
