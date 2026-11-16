import { useCallback, useEffect, useRef, useState } from 'react';
import { Layers, LockKeyhole } from 'lucide-react';
import { App } from './App';
import { api } from './ui';

export function LoginGate() {
  const [state, setState] = useState<'checking' | 'login' | 'ready'>('checking');
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const epoch = useRef(0);
  const check = useCallback(async () => {
    const key = ++epoch.current;
    try {
      const reply = await api<{ authenticated: boolean }>('auth/session');
      if (key === epoch.current) {
        setState(reply.authenticated ? 'ready' : 'login');
        setError('');
      }
    } catch {
      if (key === epoch.current) {
        setState('login');
        setError('无法连接服务，请稍后重试。');
      }
    }
  }, []);
  useEffect(() => {
    const expire = () => {
      epoch.current++;
      setState('login');
      setError('会话已失效，请重新登录。');
    };
    void check();
    window.addEventListener('classflow-expired', expire);
    window.addEventListener('focus', check);
    window.addEventListener('pageshow', check);
    const timer = setInterval(check, 60000);
    return () => {
      clearInterval(timer);
      window.removeEventListener('classflow-expired', expire);
      window.removeEventListener('focus', check);
      window.removeEventListener('pageshow', check);
    };
  }, [check]);
  if (state === 'ready')
    return (
      <App
        onLogout={async () => {
          await api('auth/logout', 'POST');
          epoch.current++;
          setError('');
          setState('login');
        }}
      />
    );
  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="login-brand">
          <Layers size={28} /> ClassFlow
        </div>
        <h1>班务流工作台</h1>
        <p>登录后查看你的通知、任务和日程。</p>
        {state === 'checking' ? (
          <p role="status">正在检查会话…</p>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy) return;
              const f = new FormData(e.currentTarget);
              setBusy(true);
              setError('');
              try {
                await api('auth/login', 'POST', { username: f.get('username'), password: f.get('password') });
                epoch.current++;
                setState('ready');
              } catch (e) {
                setError(e instanceof Error ? e.message : '暂时无法登录');
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              管理员账号
              <input name="username" autoComplete="username" required maxLength={80} />
            </label>
            <label>
              密码
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
                maxLength={256}
              />
            </label>
            {error && (
              <p role="alert" className="login-error">
                {error}
              </p>
            )}
            <button className="primary" disabled={busy}>
              <LockKeyhole size={16} />
              {busy ? '登录中…' : '登录'}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
