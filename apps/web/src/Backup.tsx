import { useRef, useState } from 'react';
import { Upload, Download, Database } from 'lucide-react';
import type { Backup as FileData, Preview } from '@classflow/shared';
import { api, stamp, type ScreenProps } from './ui';

export function BackupPage({ data, actions }: ScreenProps) {
  const fileInput = useRef<HTMLInputElement>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const [preview, setPreview] = useState<{ file: FileData; summary: Preview; name: string } | null>(null),
    [confirmed, setConfirmed] = useState(false);
  const disabled = busy || actions.busy;
  async function read(file: File) {
    setBusy(true);
    setPreview(null);
    setConfirmed(false);
    setMessage('');
    try {
      const contents = JSON.parse(await file.text()) as FileData;
      const summary = await api<Preview>('backup/preview', 'POST', contents);
      setPreview({ file: contents, summary, name: file.name });
    } catch (e) {
      setMessage(
        e instanceof SyntaxError ? '文件不是有效的 JSON。' : String(e instanceof Error ? e.message : e),
      );
    } finally {
      setBusy(false);
    }
  }
  async function download() {
    setBusy(true);
    try {
      const file = await api<FileData>('backup');
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = 'ClassFlow-' + file.exportedAt.replaceAll(':', '-') + '.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      setMessage('已生成备份，请查看浏览器下载记录。');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2>
            <Database />
            本地数据
          </h2>
          <small>JSON · 版本 2</small>
        </div>
        <p className="muted">
          当前共有 {data.tasks.length} 项任务、{data.notices.length} 条通知和 {data.handbook.length} 条手册记录。
        </p>
        <div className="backup-options">
          <button disabled={disabled} onClick={download}>
            <Upload />
            <strong>导出备份</strong>
            <small>下载通知、任务、手册记录及图片的 JSON 文件</small>
          </button>
          <button disabled={disabled} onClick={() => fileInput.current?.click()}>
            <Download />
            <strong>导入恢复</strong>
            <small>选择备份文件，先查看恢复摘要</small>
          </button>
        </div>
        <input
          aria-label="备份文件"
          ref={fileInput}
          hidden
          type="file"
          accept=".json,application/json"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void read(f);
          }}
        />
        {message && (
          <p role="status" className="feedback">
            {message}
          </p>
        )}
        {preview && (
          <div className="restore">
            <h3>恢复前核对</h3>
            <p>
              {preview.name} · 导出于 {stamp(preview.file.exportedAt)}
            </p>
            <table>
              <thead>
                <tr>
                  <th>数据</th>
                  <th>当前</th>
                  <th>恢复后</th>
                </tr>
              </thead>
              <tbody>
                {(['tasks', 'notices', 'handbook'] as const).map((k, i) => (
                  <tr key={k}>
                    <td>{['任务', '通知', '手册记录'][i]}</td>
                    <td>{preview.summary.current[k]}</td>
                    <td>{preview.summary.incoming[k]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {preview.file.version === 1 && <p className="feedback">这是版本1备份，仅恢复任务和通知，当前手册记录及图片会保留。</p>}
            <label className="consent">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              {preview.file.version === 1 ? '我确认覆盖当前全部任务和通知，保留手册。旧数据会自动备份。' : '我确认覆盖当前全部任务、通知和手册记录。旧数据会自动备份。'}
            </label>
            <button
              disabled={!confirmed || disabled}
              className="danger"
              onClick={async () => {
                if (
                  await actions.mutate(
                    'backup/restore',
                    'POST',
                    { backup: preview.file, confirmed: true, revision: preview.summary.revision },
                    '恢复完成，旧数据已自动备份',
                  )
                ) {
                  setPreview(null);
                  setMessage('恢复完成。旧数据已保存到 data/backups/。');
                }
              }}
            >
              确认覆盖并恢复
            </button>{' '}
            <button disabled={disabled} onClick={() => setPreview(null)}>
              取消
            </button>
          </div>
        )}
      </section>
    </>
  );
}
