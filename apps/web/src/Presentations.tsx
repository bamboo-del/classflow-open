import { useEffect, useRef, useState } from 'react';
import { Play, Upload, Download, Maximize, X, FileCode2 } from 'lucide-react';
import { presentationLimit, type Presentation } from '@classflow/shared/presentations';
import { api, Empty, Modal, stamp } from './ui';
import './presentations.css';

export function Presentations() {
  const [items, setItems] = useState<Presentation[]>([]);
  const [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(''), [error, setError] = useState('');
  const [query, setQuery] = useState(''), [playing, setPlaying] = useState<Presentation | null>(null);
  const [editing, setEditing] = useState<Presentation | 'new' | null>(null);
  const [title, setTitle] = useState(''), [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const player = useRef<HTMLDivElement>(null);
  const load = async () => {
    setItems(await api<Presentation[]>('presentations'));
    setLoaded(true);
    setError('');
  };
  useEffect(() => { void load().catch(e => setError(String(e.message))); }, []);
  const edit = (item: Presentation | 'new') => {
    setEditing(item); setTitle(item === 'new' ? '' : item.title);
    setDescription(item === 'new' ? '' : item.description); setFile(null); setError('');
  };
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!file || busy) return;
    if (file.size > presentationLimit) { setError('课件不能超过 16 MB。'); return; }
    if (editing !== 'new' && !window.confirm('确定用新文件替换这份课件？请先下载保留旧版。')) return;
    setBusy(true); setError('');
    try {
      const saved = await api<Presentation>('presentations' + (editing === 'new' ? '' : '/' + editing!.id), editing === 'new' ? 'POST' : 'PUT',
        { title, description, filename: file.name, html: await file.text() });
      setItems(current => [saved, ...current.filter(i => i.id !== saved.id)]);
      setEditing(null); setMessage('课件已保存，可立即播放。');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function remove(item: Presentation) {
    if (!window.confirm(`确定删除“${item.title}”？删除后无法撤销，请先下载备份。`)) return;
    setBusy(true); setError('');
    try {
      await api('presentations/' + item.id, 'DELETE');
      setItems(current => current.filter(i => i.id !== item.id));
      setMessage('课件已删除。');
    }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section className="presentations">
    <div className="deck-intro"><div><span className="tag">你的课堂资料库</span><h2>准备好，随时开讲。</h2><p>上传单文件 HTML 课件，在教室登录后直接播放。</p></div>
      <button className="primary" onClick={() => edit('new')}><Upload size={18}/> 上传课件</button></div>
    <p className="muted">仅本人登录后可访问。课件须内嵌脚本、样式和图片；为保护工作台，外部资源与联网请求将被阻止。班务 JSON 不包含课件，请另行下载留存。</p>
    {message && <p role="status">{message}</p>}{error && !editing && <p role="alert">{error} <button onClick={() => void load().catch(e => setError(e.message))}>重试读取</button></p>}
    <input aria-label="搜索课件" placeholder="搜索课件名称或简介…" value={query} onChange={e => setQuery(e.target.value)}/>
    <div className="deck-grid">{items.filter(i => (i.title + i.description).toLowerCase().includes(query.toLowerCase())).map(item =>
      <article className="deck-card" key={item.id}><div className="deck-cover"><FileCode2 size={40}/><span>HTML · {Math.ceil(item.bytes / 1024)} KB</span></div>
        <h3>{item.title}</h3><p>{item.description || '暂无简介'}</p><small>更新于 {stamp(item.updatedAt)}</small>
        <div className="deck-actions"><button className="primary" onClick={() => setPlaying(item)}><Play size={16}/> 播放</button>
          <a href={`/api/presentations/${item.id}/download`} download><Download size={16}/> 下载</a>
          <button disabled={busy} onClick={() => edit(item)}>替换</button><button disabled={busy} onClick={() => void remove(item)}>删除</button></div>
      </article>)}</div>
    {loaded && !items.length && <Empty title="第一份课件，从这里开始">上传制作好的 HTML 文件；建议上课前试播并下载离线副本。</Empty>}
    {!loaded && !error && <p role="status">正在读取课件…</p>}
    {loaded && !!items.length && !items.some(i => (i.title + i.description).toLowerCase().includes(query.toLowerCase())) && <Empty title="没有找到匹配的课件"/>}
    {editing && <Modal title={editing === 'new' ? '上传课件' : '替换课件'} close={() => setEditing(null)} busy={busy}>
      <form className="form-body" onSubmit={save}><label>课件名称<input required maxLength={200} value={title} onChange={e => setTitle(e.target.value)}/></label>
        <label>简介<textarea maxLength={2000} value={description} onChange={e => setDescription(e.target.value)}/></label>
        <label>HTML 文件（最大 16 MB）<input required type="file" accept=".html,.htm,text/html" onChange={e => { const f = e.target.files?.[0] ?? null; setFile(f); if (f && !title) setTitle(f.name.replace(/\.html?$/i, '')); }}/></label>
        <p className="muted">请选择 UTF-8 编码、无需外部文件的完整 HTML。替换将覆盖旧版。</p>{error && <p role="alert">{error}</p>}
        <button className="primary" disabled={busy || !file}>{busy ? '保存中…' : '保存课件'}</button></form></Modal>}
    {playing && <Modal title={playing.title} close={() => setPlaying(null)}>
      <div className="deck-player" ref={player}><div className="deck-player-bar"><strong>{playing.title}</strong>
        {document.fullscreenEnabled && <button onClick={() => { void (document.fullscreenElement ? document.exitFullscreen() : player.current!.requestFullscreen()).catch(() => setError('浏览器未允许全屏，请使用浏览器全屏功能。')); }}><Maximize size={16}/> 全屏</button>}
        <a href={`/api/presentations/${playing.id}/download`} download>下载</a><button aria-label="关闭播放" onClick={() => setPlaying(null)}><X size={18}/></button></div>
        <iframe title={playing.title} sandbox="allow-scripts" src={`/api/presentations/${playing.id}/content`}/>
      </div><p className="muted deck-player-tip">{error || '点击课件后使用其翻页键。Esc 退出全屏；下载后可断网播放。'}</p></Modal>}
  </section>;
}
