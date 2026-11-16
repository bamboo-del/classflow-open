import { useCallback, useEffect, useRef, useState } from 'react';
import { MotionConfig, motion, useReducedMotion } from 'motion/react';
import {
  Bell,
  BookOpen,
  CalendarDays,
  CheckSquare2,
  Database,
  Inbox as InboxIcon,
  Layers,
  LayoutDashboard,
  Presentation,
  Search,
} from 'lucide-react';
import { campusClock, type Task, type Workspace } from '@classflow/shared';
import { Dashboard } from './Dashboard';
import { Inbox, NoticeForm, NoticeDetail } from './Inbox';
import { Tasks, TaskForm, TaskDetail } from './Tasks';
import { Schedule } from './Schedule';
import { BackupPage } from './Backup';
import { Presentations } from './Presentations';
import { Handbook } from './Handbook';
import { api, Modal, taskFields, type Actions, type Overlay, type Page } from './ui';

const nav = [
  {
    id: 'home',
    label: '工作台',
    short: '工作台',
    icon: LayoutDashboard,
    desc: '集中查看团务记录、班务进度与近期截止事项。',
  },
  {
    id: 'handbook',
    label: '团支部手册',
    short: '手册',
    icon: BookOpen,
    desc: '对照2026版工作手册，维护基本情况与组织生活记录。',
  },
  {
    id: 'inbox',
    label: '通知收件箱',
    short: '通知',
    icon: InboxIcon,
    desc: '保存原始通知，把需要跟进的事项拆成任务。',
  },
  {
    id: 'tasks',
    label: '任务管理',
    short: '任务',
    icon: CheckSquare2,
    desc: '按状态、优先级和分类追踪每一项班务。',
  },
  {
    id: 'schedule',
    label: '日程安排',
    short: '日程',
    icon: CalendarDays,
    desc: '按北京时间查看每一天的截止事项。',
  },
  {
    id: 'presentations',
    label: '小组演示',
    short: '演示',
    icon: Presentation,
    desc: '登录即可播放你的 HTML 课件，也可下载后离线使用。',
  },
  {
    id: 'backup',
    label: '数据管理',
    short: '数据',
    icon: Database,
    desc: '导出本地数据，或从已有备份恢复工作区。',
  },
] as const;
function currentPage(): Page {
  return nav.find((n) => n.id === location.hash.slice(1))?.id ?? 'home';
}
function SearchDialog({ data, actions }: { data: Workspace; actions: Actions }) {
  const [term, setTerm] = useState('');
  const q = term.trim().toLocaleLowerCase();
  const matches = [
    ...data.tasks.map((t) => ({
      kind: 'task' as const,
      id: t.id,
      text: t.title,
      details: t.description + ' ' + t.assignee,
    })),
    ...data.notices.map((n) => ({
      kind: 'notice' as const,
      id: n.id,
      text: n.original,
      details: n.source + ' ' + n.notes,
    })),
  ].filter((x) => q && (x.text + ' ' + x.details).toLocaleLowerCase().includes(q));
  return (
    <Modal title="搜索工作区" close={actions.close}>
      <div className="form-body">
        <input
          autoFocus
          aria-label="搜索关键词"
          placeholder="搜索任务、通知或负责人…"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
        />
        {matches.length ? (
          matches.map((x) => (
            <button
              key={x.kind + x.id}
              className="result"
              onClick={() => actions.open({ kind: x.kind, id: x.id })}
            >
              <span className="tag">{x.kind === 'task' ? '任务' : '通知'}</span>
              {x.text}
            </button>
          ))
        ) : (
          <p className="muted">{q ? '没有匹配结果' : '输入关键词查看匹配的任务和通知。'}</p>
        )}
      </div>
    </Modal>
  );
}
export function App({ onLogout }: { onLogout: () => Promise<void> }) {
  const [page, setPage] = useState<Page>(currentPage),
    [overlay, setOverlay] = useState<Overlay | null>(null);
  const [data, setData] = useState<Workspace | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState(''),
    [now, setNow] = useState(() => campusClock());
  const lock = useRef(false),
    seq = useRef(0),
    reduced = useReducedMotion();
  const load = useCallback(async () => {
    const request = ++seq.current;
    try {
      const result = await api<Workspace>('workspace');
      if (request === seq.current) {
        setData(result);
        setError('');
      }
    } catch (e) {
      if (request === seq.current) setError(e instanceof Error ? e.message : '读取失败');
    }
  }, []);
  useEffect(() => {
    void load();
    const tick = () => {
      setNow(campusClock());
      if (document.visibilityState === 'visible' && !lock.current) void load();
    };
    const onFocus = () => {
      setNow(campusClock());
      void load();
    };
    const timer = setInterval(tick, 15000);
    window.addEventListener('focus', onFocus);
    const onHash = () => {
      setPage(currentPage());
      setOverlay(null);
    };
    window.addEventListener('hashchange', onHash);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('hashchange', onHash);
    };
  }, [load]);
  useEffect(() => {
    if (!alert) return;
    const key = setTimeout(() => setAlert(''), 6500);
    return () => clearTimeout(key);
  }, [alert]);
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === 'k' &&
        !document.querySelector('dialog[open]')
      ) {
        e.preventDefault();
        setOverlay({ kind: 'search' });
      }
    };
    window.addEventListener('keydown', keys);
    return () => window.removeEventListener('keydown', keys);
  }, []);
  const go = (id: Page) => {
    location.hash = id;
    setPage(id);
    setOverlay(null);
  };
  async function mutate(path: string, method: string, body: unknown, message: string) {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    try {
      await api(path, method, body);
      await load();
      setAlert(message);
      return true;
    } catch (e) {
      setAlert(e instanceof Error ? e.message : '操作失败，请重试');
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const toggle = (t: Task) => {
    void mutate(
      'tasks/' + t.id,
      'PUT',
      { ...taskFields(t), status: t.status === '已完成' ? '待办' : '已完成' },
      t.status === '已完成' ? '任务已重新打开' : '任务已完成',
    );
  };
  const actions: Actions = { open: setOverlay, go, close: () => setOverlay(null), mutate, toggle, busy };
  const screen = nav.find((n) => n.id === page)!,
    pending = data?.notices.filter((n) => !n.processed).length ?? 0;
  const navItems = nav.map((n) => (
    <a
      key={n.id}
      href={'#' + n.id}
      onClick={() => go(n.id)}
      aria-current={page === n.id ? 'page' : undefined}
    >
      <n.icon />
      <span className="long-label">{n.label}</span>
      <span className="short-label">{n.short}</span>
      {n.id === 'inbox' && pending > 0 && <small>{pending}</small>}
    </a>
  ));
  const props = data ? { data, actions, now } : null;
  const task = overlay && 'id' in overlay ? data?.tasks.find((x) => x.id === overlay.id) : undefined;
  const notice = overlay?.kind === 'notice' ? data?.notices.find((x) => x.id === overlay.id) : undefined;
  return (
    <MotionConfig reducedMotion="user">
      <div className="shell">
        <aside>
          <div className="brand">
            <span className="brand-mark">
              <Layers />
            </span>
            <span>
              ClassFlow<small>班务流 · 团支书工作台</small>
            </span>
          </div>
          <nav aria-label="主导航">{navItems}</nav>
          <div className="local">
            <i />
            个人工作区 <small>管理员</small>
          </div>
        </aside>
        <main>
          <div className="topline">
            <span className="crumb">
              个人工作区 <em>/</em> {screen.label}
            </span>
            <span className="mobile-brand">
              <Layers size={21} />
              ClassFlow <small>班务流</small>
            </span>
            <div className="top-actions">
              <button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await onLogout();
                  } catch {
                    setAlert('退出失败，请重试');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                退出
              </button>
              <button
                aria-label="搜索工作区"
                className="global-search"
                onClick={() => setOverlay({ kind: 'search' })}
              >
                <Search />
                <span>搜索任务、通知…</span>
                <kbd>Ctrl K</kbd>
              </button>
              <button className="icon" aria-label="打开通知收件箱" onClick={() => go('inbox')}>
                <Bell />
                {pending > 0 && <i />}
              </button>
            </div>
          </div>
          <header className="page-head">
            <div>
              <h1>{screen.label}</h1>
              <p>{screen.desc}</p>
            </div>
            <span className="date">
              <CalendarDays />
              {new Intl.DateTimeFormat('zh-CN', {
                timeZone: 'Asia/Shanghai',
                month: 'long',
                day: 'numeric',
                weekday: 'long',
              }).format(new Date(now.date + 'T12:00:00+08:00'))}
            </span>
          </header>
          {error && (
            <div className="warning" role="alert">
              {error} <button onClick={load}>重新读取</button>
            </div>
          )}
          {props ? (
            <motion.div
              key={page}
              initial={reduced ? false : { opacity: 0.65, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.16 }}
            >
              {page === 'home' ? (
                <Dashboard {...props} />
              ) : page === 'handbook' ? (
                <Handbook {...props} />
              ) : page === 'inbox' ? (
                <Inbox {...props} />
              ) : page === 'tasks' ? (
                <Tasks {...props} />
              ) : page === 'schedule' ? (
                <Schedule {...props} />
              ) : page === 'presentations' ? (
                <Presentations />
              ) : (
                <BackupPage {...props} />
              )}
            </motion.div>
          ) : (
            !error && <p>正在读取本地工作区…</p>
          )}
        </main>
      </div>
      {props &&
        overlay &&
        (overlay.kind === 'taskForm' ? (
          <TaskForm
            key={overlay.id ?? overlay.source ?? 'new'}
            {...props}
            task={task}
            source={overlay.source}
          />
        ) : overlay.kind === 'noticeForm' ? (
          <NoticeForm {...props} />
        ) : overlay.kind === 'task' && task ? (
          <TaskDetail key={task.id} {...props} task={task} />
        ) : overlay.kind === 'notice' && notice ? (
          <NoticeDetail {...props} notice={notice} />
        ) : overlay.kind === 'search' ? (
          <SearchDialog {...props} />
        ) : null)}
      <Feedback message={alert} />
    </MotionConfig>
  );
}
import { createPortal } from 'react-dom';
function Feedback({ message }: { message: string }) {
  const [host, setHost] = useState<Element | null>(null);
  useEffect(() => {
    const sync = () => setHost(document.querySelector('dialog[open]') ?? document.body);
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['open'],
    });
    return () => observer.disconnect();
  }, []);
  return host && message
    ? createPortal(
        <div className="toast" role="status">
          {message}
        </div>,
        host,
      )
    : null;
}
