import { useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { monday, shiftDay } from '@classflow/shared';
import { Empty, TaskRow, type ScreenProps } from './ui';

export function Schedule({ data, actions, now }: ScreenProps) {
  const [date, setDate] = useState(now.date),
    [weekly, setWeekly] = useState(true);
  const start = weekly ? monday(date) : date,
    end = weekly ? shiftDay(start, 6) : start;
  const days = Array.from({ length: weekly ? 7 : 1 }, (_, i) => shiftDay(start, i));
  const rows = data.tasks.filter((t) => t.dueDate >= start && t.dueDate <= end);
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>
          <CalendarDays />
          截止日程
        </h2>
        <div className="tabs compact">
          {['按天', '按周'].map((x, i) => (
            <button key={x} aria-pressed={weekly === Boolean(i)} onClick={() => setWeekly(Boolean(i))}>
              {x}
            </button>
          ))}
        </div>
      </div>
      <div className="filters">
        <button
          className="icon"
          aria-label="上一时段"
          onClick={() => setDate(shiftDay(date, weekly ? -7 : -1))}
        >
          <ChevronLeft />
        </button>
        <input
          aria-label="日程日期"
          type="date"
          value={date}
          onChange={(e) => {
            if (e.target.value) setDate(e.target.value);
          }}
        />
        <button
          className="icon"
          aria-label="下一时段"
          onClick={() => setDate(shiftDay(date, weekly ? 7 : 1))}
        >
          <ChevronRight />
        </button>
        <button onClick={() => setDate(now.date)}>回到今天</button>
      </div>
      <p className="range">
        {start}
        {weekly ? ' 至 ' + end : ''} · 共 {rows.length} 项
      </p>
      {rows.length ? (
        days.map((day) => {
          const due = rows.filter((t) => t.dueDate === day);
          return (
            due.length > 0 && (
              <section key={day} className="day-group">
                <h4>
                  {day}
                  {day === now.date ? ' · 今天' : ''}
                </h4>
                {due.map((task) => (
                  <TaskRow key={task.id} {...{ task, actions, now }} />
                ))}
              </section>
            )
          );
        })
      ) : (
        <Empty title="所选时段暂无截止事项">为任务设置截止日期后，会自动出现在对应日程。</Empty>
      )}
    </section>
  );
}
