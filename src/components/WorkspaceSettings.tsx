import { useState } from 'react';
import { Modal } from './Modal';
import { workspaceController as api, type MigrationPlan } from '../services/workspace/controller';
import type { WorkspaceView } from '../services/workspace/runtime';
import type { Result } from '../types/errors';

export function WorkspaceSettings({
  view,
  busy,
  setBusy,
  onView,
  onClose,
  onMessage,
}: {
  view: WorkspaceView;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onView: (view: WorkspaceView) => void;
  onClose: () => void;
  onMessage: (message: string) => void;
}) {
  const [name, setName] = useState(view.workspace.name);
  const [target, setTarget] = useState(view.settings.defaultTarget);
  const [autosave, setAutosave] = useState(view.settings.autosaveEnabled);
  const [delay, setDelay] = useState(view.settings.autosaveDelayMs);
  const [files, setFiles] = useState<string[][] | null>(null);
  const [selectedFile, setSelectedFile] = useState<{ path: string; text: string } | null>(null);
  const [migration, setMigration] = useState<MigrationPlan | null>(null);
  const [confirmClearCache, setConfirmClearCache] = useState(false);
  const disabled = busy || !view.writable;
  const consume = <T,>(result: Result<T>) => {
    if (!result.ok) {
      if (result.error.code !== 'CANCELLED') onMessage(result.error.message);
      return undefined;
    }
    return result.value;
  };
  async function save() {
    if (disabled) return;
    setBusy(true);
    try {
      const result = await api.run((runtime) =>
        runtime.updateSettings({
          name,
          defaultTarget: target,
          autosaveEnabled: autosave,
          autosaveDelayMs: delay,
        }),
      );
      const next = consume(result);
      if (next) {
        onView(next);
        onMessage('设置已保存到工作空间');
      } else {
        await api.run((runtime) => runtime.refreshPending());
        const current = api.view();
        if (current) onView(current);
      }
    } finally {
      setBusy(false);
    }
  }
  async function browse() {
    setBusy(true);
    try {
      const next = consume(await api.run((runtime) => runtime.files()));
      if (next) setFiles(next);
    } finally {
      setBusy(false);
    }
  }
  async function read(path: string[]) {
    setBusy(true);
    try {
      const text = consume(await api.run((runtime) => runtime.readLocalFile(path)));
      if (text !== undefined) setSelectedFile({ path: path.join('/'), text });
    } finally {
      setBusy(false);
    }
  }
  async function exportZip() {
    setBusy(true);
    try {
      const next = consume(await api.exportArchive());
      if (next)
        onMessage(`已生成 ${next.fileCount} 个文件的 ZIP 下载，请在浏览器下载列表确认完成。`);
    } finally {
      setBusy(false);
    }
  }
  function prepareMigration() {
    if (disabled) return;
    const promise = api.prepareMigration();
    setBusy(true);
    void promise
      .then((result) => {
        const next = consume(result);
        if (next) setMigration(next);
      })
      .finally(() => setBusy(false));
  }
  async function migrate() {
    setBusy(true);
    try {
      const next = consume(await api.migrate());
      if (next) {
        onView(next);
        setMigration(null);
        setFiles(null);
        setSelectedFile(null);
        onMessage('迁移已校验，已切换到新目录。原目录仍保留。');
      }
    } finally {
      setBusy(false);
    }
  }
  async function close() {
    setBusy(true);
    try {
      const result = await api.close();
      if (result.ok) onClose();
      else consume(result);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="page workspace-settings">
      <span className="eyebrow">WORKSPACE SETTINGS</span>
      <h1>工作空间设置</h1>
      <div className="settings-card">
        <h2>基本设置</h2>
        <p className="muted">
          目录：{api.directoryName()} · 浏览器只提供目录名，下面的文件路径均相对此目录。
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label>
            工作空间名称
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={200}
              disabled={disabled}
            />
          </label>
          <label>
            新 Prompt 默认目标
            <input
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              maxLength={100}
              disabled={disabled}
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={autosave}
              onChange={(event) => setAutosave(event.target.checked)}
              disabled={disabled}
            />
            自动保存草稿
          </label>
          <label>
            自动保存等待时间
            <select
              aria-label="自动保存等待时间"
              value={delay}
              onChange={(event) => setDelay(Number(event.target.value))}
              disabled={disabled}
            >
              {[500, 800, 1000, 1500, 2000].map((ms) => (
                <option key={ms} value={ms}>
                  {ms} 毫秒
                </option>
              ))}
              {![500, 800, 1000, 1500, 2000].includes(delay) && (
                <option value={delay}>{delay} 毫秒</option>
              )}
            </select>
          </label>
          <button className="primary" disabled={disabled || !name.trim() || !target.trim()}>
            保存设置
          </button>
        </form>
      </div>
      <div className="settings-card">
        <h2>本地文件与备份</h2>
        <p>
          备份包含设置、项目、Prompt、全部历史版本和临时草稿，包括已删除和已归档条目。根目录其他资料和浏览器缓存不包含在内。
        </p>
        <p className="muted">
          最多 5000 个文件、合计 32 MiB。ZIP 解压到空目录后，可用“打开已有工作空间”恢复。
        </p>
        <div className="settings-actions">
          <button
            disabled={busy}
            onClick={() =>
              void (async () => {
                setBusy(true);
                try {
                  const next = consume(await api.run((runtime) => runtime.load()));
                  if (next) {
                    onView(next);
                    setName(next.workspace.name);
                    setTarget(next.settings.defaultTarget);
                    setAutosave(next.settings.autosaveEnabled);
                    setDelay(next.settings.autosaveDelayMs);
                    onMessage('已从本地目录重新读取工作空间。');
                  }
                } finally {
                  setBusy(false);
                }
              })()
            }
          >
            重新读取工作空间
          </button>
          <button
            disabled={busy}
            onClick={() =>
              void api
                .reauthorize()
                .then((result) => onMessage(result.ok ? '目录已重新授权。' : result.error.message))
            }
          >
            重新授权目录
          </button>
          <button disabled={busy} onClick={() => void browse()}>
            查看本地应用文件
          </button>
          <button disabled={disabled} onClick={() => void exportZip()}>
            打包工作空间 ZIP
          </button>
          <button disabled={disabled} onClick={prepareMigration}>
            迁移到新目录
          </button>
        </div>
        {files && (
          <div className="workspace-files">
            <div className="file-list" aria-label="本地应用文件列表">
              {files.map((path) => (
                <button key={path.join('/')} disabled={busy} onClick={() => void read(path)}>
                  {path.join('/')}
                </button>
              ))}
            </div>
            <div className="file-preview">
              {selectedFile ? (
                <>
                  <strong>{selectedFile.path}</strong>
                  <p className="muted">只读文件预览</p>
                  <pre>{selectedFile.text.slice(0, 200_000)}</pre>
                  {selectedFile.text.length > 200_000 && (
                    <p>预览显示前 200000 字符，原文件保持完整。</p>
                  )}
                </>
              ) : (
                <p>选择文件查看内容。</p>
              )}
            </div>
          </div>
        )}
      </div>
      <div className="settings-card">
        <h2>结束当前会话</h2>
        <p>关闭工作空间保留全部本地文件，下次可重新打开。</p>
        <button disabled={busy} onClick={() => void close()}>
          关闭工作空间
        </button>
        <button disabled={busy} onClick={() => setConfirmClearCache(true)}>
          清除浏览器缓存
        </button>
      </div>
      {confirmClearCache && (
        <Modal
          title="清除本应用浏览器缓存"
          onClose={() => {
            if (!busy) setConfirmClearCache(false);
          }}
        >
          <p>
            将清除最近目录、搜索缓存和未落盘草稿恢复副本。已保存的本地文件不受影响，之后可重新选择目录打开。
          </p>
          <footer>
            <button disabled={busy} onClick={() => setConfirmClearCache(false)}>
              取消
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void (async () => {
                  setBusy(true);
                  try {
                    const result = await api.clearCache();
                    if (result.ok) {
                      setConfirmClearCache(false);
                      onMessage('浏览器缓存已清除，本地工作空间文件保留。');
                    } else consume(result);
                  } finally {
                    setBusy(false);
                  }
                })()
              }
            >
              确认清除缓存
            </button>
          </footer>
        </Modal>
      )}
      {migration && (
        <Modal
          title="确认迁移工作空间"
          onClose={() => {
            if (!busy) {
              api.cancelMigration();
              setMigration(null);
            }
          }}
        >
          <p>
            将 {migration.fileCount} 个应用文件（{(migration.totalBytes / 1024).toFixed(1)}{' '}
            KiB）复制到空目录「{migration.directoryName}」。
          </p>
          <p>
            复制并逐个校验成功后切换到新目录；原目录保留。迁移中断时，新目录可通过“打开已有工作空间”检查恢复记录；不会自动删除或覆盖原文件。
          </p>
          <footer>
            <button
              disabled={busy}
              onClick={() => {
                api.cancelMigration();
                setMigration(null);
              }}
            >
              取消
            </button>
            <button className="primary" disabled={busy} onClick={() => void migrate()}>
              {busy ? '正在复制并校验…' : '确认迁移并切换'}
            </button>
          </footer>
        </Modal>
      )}
    </section>
  );
}
