import { useEffect, useState } from 'react';
import { ArrowLeft, Download, FilePlus2, Home, Trash2 } from 'lucide-react';
import { workspaceController as api } from '../services/workspace/controller';
import type { QuickNoteRecord } from '../services/cache/cache';
import { clearOfflineShellCache } from '../services/pwa/offline-cache';

interface BeforeInstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface QuickCapturePageProps {
  hasWorkspace: boolean;
  onHome: () => void;
}

function isBeforeInstallPrompt(event: Event): event is BeforeInstallPrompt {
  return (
    'prompt' in event && 'userChoice' in event && typeof Reflect.get(event, 'prompt') === 'function'
  );
}

function downloadNotes(notes: QuickNoteRecord[]) {
  const data = JSON.stringify(
    {
      format: 'promptdesk-local-quick-notes',
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      notes,
    },
    null,
    2,
  );
  const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `promptdesk-quick-notes-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function QuickCapturePage({ hasWorkspace, onHome }: QuickCapturePageProps) {
  const [notes, setNotes] = useState<QuickNoteRecord[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('正在读取本机记录…');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPrompt | null>(null);
  const [offlineReady, setOfflineReady] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const active = notes.find((note) => note.id === activeId);
  const dirty = body !== (active?.body ?? '');
  const canSave = body.trim().length > 0 && body.length <= 10_000 && dirty && !busy;
  const refreshNotes = async () => {
    const result = await api.listQuickNotes();
    if (result.ok) {
      setNotes(result.value);
      setMessage('保存在此浏览器的本机暂存区');
    } else {
      setMessage('本机暂存区不可用。浏览器存储可能已关闭或空间不足。');
    }
  };

  useEffect(() => {
    let current = true;
    void api.listQuickNotes().then((result) => {
      if (!current) return;
      if (result.ok) {
        setNotes(result.value);
        setMessage('保存在此浏览器的本机暂存区');
      } else {
        setMessage('本机暂存区不可用。浏览器存储可能已关闭或空间不足。');
      }
    });
    const onInstall = (event: Event) => {
      if (!isBeforeInstallPrompt(event)) return;
      event.preventDefault();
      setInstallPrompt(event);
    };
    window.addEventListener('beforeinstallprompt', onInstall);
    void navigator.serviceWorker?.ready
      .then(() => {
        if (current) setOfflineReady(true);
      })
      .catch(() => undefined);
    const onUpdate = () => setUpdateAvailable(true);
    window.addEventListener('promptdesk:pwa-update', onUpdate);
    if ('serviceWorker' in navigator)
      void navigator.serviceWorker
        .getRegistration(import.meta.env.BASE_URL)
        .then((registration) => {
          if (current && registration?.waiting) setUpdateAvailable(true);
        })
        .catch(() => undefined);
    return () => {
      current = false;
      window.removeEventListener('beforeinstallprompt', onInstall);
      window.removeEventListener('promptdesk:pwa-update', onUpdate);
    };
  }, []);

  useEffect(() => {
    const protectDraft = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', protectDraft);
    return () => window.removeEventListener('beforeunload', protectDraft);
  }, [dirty]);

  const leavePage = () => {
    if (busy) {
      setMessage('请等待本机记录保存完成，再离开此页面。');
      return;
    }
    if (dirty) setConfirmLeave(true);
    else onHome();
  };

  const startNew = () => {
    if (busy) {
      setMessage('保存结束后再切换记录。');
      return;
    }
    if (dirty) {
      setMessage('先保存当前记录，或点击“放弃修改”后再新建。');
      return;
    }
    setActiveId(null);
    setBody('');
    setMessage('新记录尚未保存');
  };

  const selectNote = (note: QuickNoteRecord) => {
    if (busy) {
      setMessage('保存结束后再切换记录。');
      return;
    }
    if (dirty) {
      setMessage('先保存当前记录，或点击“放弃修改”后再切换。');
      return;
    }
    setActiveId(note.id);
    setBody(note.body);
    setMessage(`上次保存：${new Date(note.updatedAt).toLocaleString()}`);
  };

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    try {
      const result = await api.saveQuickNote(activeId, body);
      if (!result.ok) {
        setMessage(
          result.error.code === 'INVALID_SCHEMA'
            ? '记录不能为空且最多 10,000 个字符。'
            : '保存失败。请复制内容后检查浏览器存储空间。',
        );
        return;
      }
      setActiveId(result.value.id);
      await refreshNotes();
      setMessage('已保存到此浏览器的本机暂存区');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await api.deleteQuickNote(id);
      if (!result.ok) {
        setMessage('删除失败，请稍后重试。');
        return;
      }
      if (activeId === id) {
        setActiveId(null);
        setBody('');
      }
      setDeleteId(null);
      await refreshNotes();
      setMessage('本机记录已删除');
    } finally {
      setBusy(false);
    }
  };

  const install = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    setInstallPrompt(null);
    setMessage(choice.outcome === 'accepted' ? '安装已确认' : '已取消安装');
  };

  const clearOfflineCache = async () => {
    try {
      const cleared = await clearOfflineShellCache();
      setOfflineReady(false);
      setMessage(
        cleared
          ? '离线应用资源已清除；本机速记未删除。下次离线打开前请先联网访问。'
          : '当前浏览器不支持清除离线应用资源。',
      );
    } catch {
      setMessage('清除失败；本机速记未更改。');
    }
  };

  const applyUpdate = async () => {
    if (dirty) {
      setMessage('先保存或放弃当前修改，再更新应用。');
      return;
    }
    try {
      const registration = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL);
      if (!registration?.waiting) {
        setUpdateAvailable(false);
        setMessage('当前已是最新版本。');
        return;
      }
      window.sessionStorage.setItem('promptdesk:pwa-update-reload', 'yes');
      registration.waiting.postMessage('ACTIVATE_UPDATE');
    } catch {
      setMessage('更新暂不可用，请联网后重新打开应用。');
    }
  };

  return (
    <main className="quick-capture-shell">
      <header className="quick-capture-topbar">
        <button aria-label="返回 PromptDesk" disabled={busy} onClick={leavePage}>
          <ArrowLeft size={17} /> 返回
        </button>
        <strong>PromptDesk · 手机速记</strong>
        {hasWorkspace && (
          <button aria-label="返回工作台" disabled={busy} onClick={leavePage}>
            <Home size={17} /> 工作台
          </button>
        )}
      </header>
      <section className="quick-capture-page">
        <div className="quick-capture-intro">
          <span className="eyebrow">QUICK CAPTURE · DEVICE ONLY</span>
          <h1>先记下来。</h1>
          <p>
            这些记录只保存在当前浏览器的本机暂存区，与已授权的 Workspace Scratchpad
            分开。浏览器清理数据或更换设备可能导致记录丢失，请定期导出。
          </p>
        </div>
        {confirmLeave && (
          <div className="quick-note-confirm" role="group" aria-label="确认离开手机速记">
            <p>当前修改尚未保存。离开会丢弃这些修改。</p>
            <button onClick={() => setConfirmLeave(false)}>继续编辑</button>
            <button className="danger" onClick={onHome}>
              丢弃修改并返回
            </button>
          </div>
        )}
        {updateAvailable && (
          <div className="quick-capture-update" role="status">
            <span>有新版本可用。先保存速记，再更新应用。</span>
            <button disabled={dirty || busy} onClick={() => void applyUpdate()}>
              更新应用
            </button>
          </div>
        )}
        <div className="quick-capture-layout">
          <aside className="quick-note-list" aria-label="本机速记列表">
            <div className="quick-note-list-header">
              <strong>本机记录</strong>
              <button aria-label="新建速记" disabled={busy} onClick={startNew}>
                <FilePlus2 size={16} /> 新建
              </button>
            </div>
            {notes.map((note) => (
              <div
                className={`quick-note-row ${note.id === activeId ? 'selected' : ''}`}
                key={note.id}
              >
                <button className="quick-note-select" onClick={() => selectNote(note)}>
                  <strong>{note.body.split('\n')[0]?.slice(0, 48) || '（空行）'}</strong>
                  <small>{new Date(note.updatedAt).toLocaleDateString()}</small>
                </button>
                <button
                  aria-label={`删除本机记录 ${note.body.slice(0, 20)}`}
                  disabled={busy}
                  onClick={() => setDeleteId(note.id)}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
            {notes.length === 0 && <p className="muted">还没有本机速记。</p>}
            {deleteId && (
              <div className="quick-note-confirm" role="group" aria-label="确认删除本机记录">
                <p>确定永久删除这条本机记录？若当前编辑了这条记录，未保存修改也会放弃。</p>
                <button disabled={busy} onClick={() => setDeleteId(null)}>
                  取消
                </button>
                <button className="danger" disabled={busy} onClick={() => void remove(deleteId)}>
                  确认删除
                </button>
              </div>
            )}
          </aside>
          <section className="quick-note-editor" aria-label="编辑本机速记">
            <div className="quick-note-toolbar">
              <span className="save-indicator" role="status" aria-live="polite">
                {busy ? '保存中…' : dirty ? '有未保存修改' : message}
              </span>
              <div>
                {dirty && (
                  <button
                    onClick={() => {
                      setBody(active?.body ?? '');
                      setMessage('修改已放弃');
                    }}
                  >
                    放弃修改
                  </button>
                )}
                <button className="primary" disabled={!canSave} onClick={() => void save()}>
                  保存记录
                </button>
              </div>
            </div>
            <textarea
              aria-label="本机速记内容"
              maxLength={10_000}
              placeholder="记下想法、下一步任务或待整理的 Prompt…"
              value={body}
              disabled={busy}
              onChange={(event) => setBody(event.target.value)}
            />
            <small>
              {body.length.toLocaleString()} / 10,000 字符 · 不会自动上传或写入 Workspace
            </small>
          </section>
        </div>
        <footer className="quick-capture-tools">
          <button disabled={!notes.length} onClick={() => downloadNotes(notes)}>
            <Download size={16} /> {`导出全部记录（${notes.length}）`}
          </button>
          {installPrompt ? (
            <button className="primary" onClick={() => void install()}>
              安装 PromptDesk
            </button>
          ) : (
            <span className="muted">
              {offlineReady
                ? '离线应用资源已缓存'
                : '首次访问需联网加载应用；Android 可从浏览器菜单安装，iPhone Safari 可用分享菜单添加到主屏幕'}
            </span>
          )}
          <button onClick={() => void clearOfflineCache()}>清除离线应用缓存</button>
        </footer>
        <p className="quick-capture-storage-note" role="note">
          本机暂存区使用浏览器存储，不属于 Workspace 备份或迁移内容。若要长期保存，请导出
          JSON；导出文件由你自行保管。
        </p>
      </section>
    </main>
  );
}
