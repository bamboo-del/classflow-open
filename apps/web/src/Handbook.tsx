import { useState } from 'react';
import { BookOpen, Plus, Search, ImagePlus, Trash2, ArrowRight } from 'lucide-react';
import { handbookInput, handbookSections, handbookReminders, type HandbookInput, type HandbookRecord, type HandbookSection } from '@classflow/shared/handbook';
import { Empty, Modal, stamp, type ScreenProps } from './ui';
import './handbook.css';

export function HandbookOverview({ data, actions, now }: ScreenProps) {
  return <section className="panel handbook-overview">
    <div className="panel-head"><h2><BookOpen />团务记录提醒</h2><button className="text-link" onClick={() => actions.go('handbook')}>打开团支部手册<ArrowRight /></button></div>
    <div className="handbook-reminders">{handbookReminders(data.handbook, now.date).map((r) => <div key={r.kind}>
      <small>{r.label}</small><strong>{r.count ? `已登记 ${r.count} 次` : '待登记'}</strong><span>{r.period}</span>
    </div>)}</div>
    <p className="handbook-note">依据《团支部工作手册（2026）》提示，仅统计已录入记录，不代表活动完成或考核达标；团小组会议按实际情况安排，寒暑假团日可灵活开展。</p>
  </section>;
}

export function Handbook(props: ScreenProps) {
  const { data, actions } = props;
  const [sectionId, setSectionId] = useState('branch');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<HandbookRecord | 'new' | null>(null);
  const section = handbookSections.find((s) => s.id === sectionId)!;
  const records = data.handbook.filter((r) => r.kind === sectionId);
  const matches = records.filter((r) => Object.values(r.values).some((v) => v.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));
  return <>
    <HandbookOverview {...props} />
    <div className="handbook-layout">
      <section className="panel handbook-directory" aria-label="手册目录">
        <div className="panel-head"><h2><BookOpen />手册目录</h2><small>2026 版</small></div>
        <label className="handbook-selector">选择台账<select aria-label="选择手册台账" value={sectionId} onChange={(e) => { setSectionId(e.target.value); setQuery(''); }}>{(['基本情况篇', '组织生活篇'] as const).map((group) => <optgroup key={group} label={group}>{handbookSections.filter((s) => s.group === group).map((s) => <option key={s.id} value={s.id}>{s.title}（{data.handbook.filter((r) => r.kind === s.id).length}）</option>)}</optgroup>)}</select></label>
        {(['基本情况篇', '组织生活篇'] as const).map((group) => <div className="handbook-directory-group" key={group}>
          <h3>{group}</h3>
          {handbookSections.filter((s) => s.group === group).map((s) => <button key={s.id} aria-pressed={s.id === sectionId} onClick={() => { setSectionId(s.id); setQuery(''); }}>
            <span>{s.title}</span><small>{data.handbook.filter((r) => r.kind === s.id).length}</small>
          </button>)}
        </div>)}
      </section>
      <section className="panel handbook-content">
        <div className="panel-head"><h2>{section.title}</h2><button className="tint" onClick={() => setEditing('new')}><Plus />新增记录</button></div>
        <div className="handbook-guide"><p>{section.hint}</p><small>参考：{section.source} · 内容如实填写，及时更新</small></div>
        <div className="handbook-toolbar"><label className="searchbox"><Search /><input aria-label="搜索当前台账" placeholder="搜索姓名、学号或记录内容" value={query} onChange={(e) => setQuery(e.target.value)} /></label><small>{matches.length} / {records.length} 条记录</small></div>
        {matches.length ? <div className="handbook-records">{matches.map((r) => {
          const title = r.values[section.fields[0].label];
          const details = section.fields.slice(1).filter((f) => r.values[f.label]);
          return <button className="handbook-record" key={r.id} onClick={() => setEditing(r)}>
            <div><strong>{title}</strong><span className="tag">查看 / 编辑</span></div>
            <p>{details.slice(0, 4).map((f) => `${f.label}：${r.values[f.label]}`).join(' · ') || '其余栏目待补充'}</p>
            <small>更新于 {stamp(r.updatedAt)}{r.photos.length ? ` · ${r.photos.length} 张图片` : ''}</small>
          </button>;
        })}</div> : <Empty title={query ? '没有匹配记录' : '尚未登记' }>{query ? '换个关键词试试。' : '点击「新增记录」，按手册栏目填写实际信息。模板示例不会作为真实数据导入。'}</Empty>}
        <details className="handbook-checklist"><summary>归档与评审参考</summary>
          <p>手册为大学全程档案，换届时做好线上移交，学年末按学院要求存档。组织生活记录应配图片资料。</p>
          <p>评审参考包括：班子建设、团员管理、活动开展、制度落实、品牌建设、青年发展、支部风采。另行核对年度团籍注册、每年至少一次组织生活会及相关佐证材料。</p>
          <p>参考：02 使用说明、40 五四红旗团支部评审参考指标。可在「数据管理」统一导出、恢复通知、任务和手册记录。</p>
        </details>
      </section>
    </div>
    {editing && <RecordForm key={editing === 'new' ? section.id : editing.id} section={section} record={editing === 'new' ? undefined : editing} actions={actions} close={() => setEditing(null)} />}
  </>;
}

function RecordForm({ section, record, actions, close }: { section: HandbookSection; record?: HandbookRecord; actions: ScreenProps['actions']; close: () => void }) {
  const [values, setValues] = useState<HandbookInput['values']>(() => ({ ...record?.values }));
  const [photos, setPhotos] = useState<HandbookInput['photos']>(() => record?.photos ?? []);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [reading, setReading] = useState(false);
  const busy = actions.busy || reading;
  async function addPhotos(files: File[]) {
    setError('');
    if (files.length + photos.length > 4) { setError('每条记录最多添加4张图片。'); return; }
    if (files.some((f) => !['image/png', 'image/jpeg', 'image/webp'].includes(f.type) || f.size > 500 * 1024)) {
      setError('请选择 JPG、PNG 或 WebP 图片，每张不超过500 KB。'); return;
    }
    setReading(true);
    try {
      const added = await Promise.all(files.map(async (file) => {
        const bitmap = await createImageBitmap(file);
        bitmap.close();
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error('图片读取失败'));
          reader.readAsDataURL(file);
        });
        return { name: file.name.slice(0, 200), data };
      }));
      setPhotos((current) => [...current, ...added]);
    } catch { setError('图片无法读取，请选择有效图片。'); }
    finally { setReading(false); }
  }
  return <Modal title={`${record ? '编辑' : '新增'} · ${section.title}`} close={close} busy={busy}>
    <form onSubmit={async (e) => {
      e.preventDefault();
      setError('');
      const input = handbookInput.safeParse({ kind: section.id, values, photos });
      if (!input.success) { const issue = input.error.issues[0]; setError(`${String(issue.path.at(-1))}：${issue.message}`); return; }
      if (await actions.mutate('handbook' + (record ? '/' + record.id : ''), record ? 'PUT' : 'POST', input.data, '手册记录已保存')) close();
    }}>
      <fieldset disabled={busy} className="form-body handbook-fields">
        <p className="handbook-note">{section.hint} 标有 * 的栏目必填，其余可保存后补充。</p>
        <div className="form-grid">{section.fields.map((f) => <label key={f.label} className={f.type === 'textarea' ? 'handbook-wide' : ''}>
          {f.label}{f.required ? ' *' : ''}
          {f.options ? <select aria-label={f.label} required={f.required} value={values[f.label] ?? ''} onChange={(e) => setValues({ ...values, [f.label]: e.target.value })}><option value="">请选择</option>{f.options.map((s) => <option key={s}>{s}</option>)}</select>
            : f.type === 'textarea' ? <textarea aria-label={f.label} rows={4} maxLength={f.max ?? 20000} value={values[f.label] ?? ''} onChange={(e) => setValues({ ...values, [f.label]: e.target.value })} />
            : <input aria-label={f.label} type={f.type ?? 'text'} required={f.required} min={f.type === 'number' ? 0 : undefined} step={f.label.includes('金额') ? '0.01' : f.type === 'number' ? '1' : undefined} maxLength={200} value={values[f.label] ?? ''} onChange={(e) => setValues({ ...values, [f.label]: e.target.value })} />}
          {f.max && <small>{(values[f.label] ?? '').length} / {f.max} 字</small>}
        </label>)}</div>
        {section.group === '组织生活篇' && <div className="handbook-photo-field"><label><span><ImagePlus size={16} /> 图片资料</span><input aria-label="添加图片资料" type="file" multiple accept="image/png,image/jpeg,image/webp" onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ''; void addPhotos(files); }} /></label>
          <small>最多4张，每张500 KB以内；JPG / PNG / WebP。图片随记录保存并纳入备份。</small>
          <div className="handbook-photos">{photos.map((p, i) => <figure key={i}><img src={p.data} alt={p.name} /><figcaption>{p.name}</figcaption><button type="button" aria-label={`移除图片 ${p.name}`} onClick={() => setPhotos(photos.filter((_, n) => n !== i))}><Trash2 size={14} />移除</button></figure>)}</div>
        </div>}
        {error && <p role="alert" className="warning">{error}</p>}
        {deleting && <div className="warning"><p>确定删除这条记录及其图片？</p><button type="button" className="danger" onClick={async () => { if (await actions.mutate('handbook/' + record!.id, 'DELETE', undefined, '手册记录已删除')) close(); }}>确认删除记录</button> <button type="button" onClick={() => setDeleting(false)}>取消删除</button></div>}
      </fieldset>
      <footer>{record && <button type="button" disabled={busy} onClick={() => setDeleting(true)}>删除记录</button>}<button type="button" disabled={busy} onClick={close}>取消</button><button type="submit" className="primary" disabled={busy}>{reading ? '正在读取图片…' : '保存记录'}</button></footer>
    </form>
  </Modal>;
}
