import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { workspaceController as api } from '../services/workspace/controller';
import type { OpenScratch, WorkspaceView } from '../services/workspace/runtime';
import { copyText } from '../services/clipboard/clipboard';
import { Modal } from './Modal';

const MarkdownEditor = lazy(() =>
  import('./MarkdownEditor').then((module) => ({ default: module.MarkdownEditor })),
);
const MarkdownPreview = lazy(() =>
  import('./MarkdownPreview').then((module) => ({ default: module.MarkdownPreview })),
);
interface Draft {
  document: OpenScratch;
  title: string;
  body: string;
  seq: number;
  saved: number;
  state: 'saved' | 'dirty' | 'saving' | 'failed';
}
export function ScratchpadWorkspace({
  view,
  busy,
  setBusy,
  onView,
  onMessage,
  onOpenPrompt,
  registerFlush,
}: {
  view: WorkspaceView;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onView: () => void;
  onMessage: (message: string) => void;
  onOpenPrompt: (projectId: string, id: string) => Promise<void>;
  registerFlush: (flush: (() => Promise<boolean>) | null) => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(null),
    draftRef = useRef<Draft | null>(null);
  const [showTransferred, setShowTransferred] = useState(false),
    [preview, setPreview] = useState(false);
  const [projectId, setProjectId] = useState(
    view.projects.find((p) => !p.deletedAt && p.status === 'active')?.id ?? '',
  );
  const [confirmDelete, setConfirmDelete] = useState(false),
    [recovery, setRecovery] = useState<string | null>(null);
  const pending = useRef<Promise<boolean> | null>(null),
    active = useRef(true);
  const update = useCallback((next: Draft | null) => {
    draftRef.current = next;
    if (active.current) setDraft(next);
  }, []);
  const flush = useCallback(async (): Promise<boolean> => {
    if (pending.current && !(await pending.current)) return false;
    const current = draftRef.current;
    if (!current || current.seq === current.saved) return true;
    if (current.state === 'failed') return false;
    const id = current.document.meta.id;
    update({ ...current, state: 'saving' });
    const promise = (async () => {
      const result = await api.run((runtime) =>
        runtime.saveScratch(id, current.title, current.body),
      );
      if (
        !active.current ||
        api.view()?.sessionId !== view.sessionId ||
        draftRef.current?.document.meta.id !== id
      )
        return false;
      const latest = draftRef.current;
      if (!result.ok) {
        update({ ...latest, state: 'failed' });
        onMessage(result.error.message);
        await api.run((runtime) => runtime.refreshPending());
        onView();
        return false;
      }
      update({
        ...latest,
        document: result.value,
        saved: current.seq,
        state: latest.seq === current.seq ? 'saved' : 'dirty',
      });
      await api.clearRecoveryDraft(`scratch:${id}`, current.seq);
      onView();
      return true;
    })();
    pending.current = promise;
    const ok = await promise;
    if (pending.current === promise) pending.current = null;
    if (!ok) return false;
    return draftRef.current && draftRef.current.seq !== draftRef.current.saved ? flush() : true;
  }, [onMessage, onView, update, view.sessionId]);
  useEffect(() => {
    active.current = true;
    registerFlush(flush);
    return () => {
      active.current = false;
      registerFlush(null);
    };
  }, [flush, registerFlush]);
  useEffect(() => {
    if (!draft || draft.seq === draft.saved) return;
    void api.putRecoveryDraft({
      entityKey: `scratch:${draft.document.meta.id}`,
      body: draft.body,
      editSeq: draft.seq,
      baseContentHash: draft.document.baseContentHash,
    });
    if (!view.settings.autosaveEnabled || draft.state !== 'dirty') return;
    const timer = setTimeout(() => {
      void flush();
    }, view.settings.autosaveDelayMs);
    return () => clearTimeout(timer);
  }, [draft, flush, view.settings.autosaveEnabled, view.settings.autosaveDelayMs]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      const current = draftRef.current;
      if (current && current.seq !== current.saved) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  async function open(id?: string) {
    if (busy) return;
    setBusy(true);
    try {
      if (!(await flush())) return;
      const result = await api.run((runtime) =>
        id ? runtime.openScratch(id) : runtime.createScratch(),
      );
      if (!result.ok) {
        onMessage(result.error.message);
        return;
      }
      update({
        document: result.value,
        title: result.value.meta.title,
        body: result.value.body,
        seq: 0,
        saved: 0,
        state: 'saved',
      });
      setPreview(false);
      onView();
      const cached = await api.getRecoveryDraft(`scratch:${result.value.meta.id}`);
      if (
        cached.ok &&
        cached.value &&
        cached.value.body !== result.value.body &&
        !result.value.meta.transferredTo
      )
        setRecovery(cached.value.body);
    } finally {
      setBusy(false);
    }
  }
  function edit(patch: { body?: string; title?: string }) {
    const current = draftRef.current;
    if (current && current.document.meta.id === draft?.document.meta.id)
      update({
        ...current,
        ...patch,
        seq: current.seq + 1,
        state: current.state === 'failed' ? 'failed' : 'dirty',
      });
  }
  async function transfer() {
    if (!draft || !projectId) return;
    setBusy(true);
    try {
      if (!(await flush())) return;
      const result = await api.run((runtime) =>
        runtime.transferScratch(draft.document.meta.id, projectId),
      );
      if (!result.ok) {
        onMessage(result.error.message);
        await api.run((runtime) => runtime.refreshPending());
        onView();
        return;
      }
      update(null);
      onView();
      await onOpenPrompt(result.value.projectId, result.value.promptId);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!draft || busy) return;
    setBusy(true);
    try {
      if (!(await flush())) return;
      const result = await api.run((runtime) =>
        runtime.setScratchDeleted(draft.document.meta.id, true),
      );
      if (result.ok) {
        update(null);
        setConfirmDelete(false);
        onView();
      } else {
        onMessage(result.error.message);
        await api.run((runtime) => runtime.refreshPending());
        onView();
      }
    } finally {
      setBusy(false);
    }
  }
  const readonly =
    busy ||
    !view.writable ||
    !!draft?.document.meta.deletedAt ||
    !!draft?.document.meta.transferredTo;
  const entries = view.scratchpads.filter(
    (s) => !s.deletedAt && (showTransferred ? !!s.transferredTo : !s.transferredTo),
  );
  return (
    <section className="page scratch-workspace">
      <div className="section-heading">
        <h1>临时草稿</h1>
        <button className="primary" disabled={busy || !view.writable} onClick={() => void open()}>
          新建临时草稿
        </button>
      </div>
      <p className="muted">先记下想法，之后再转入项目。已保存内容保存在本地工作空间。</p>
      <div className="view-toggle">
        <button
          className={!showTransferred ? 'active' : ''}
          onClick={() => setShowTransferred(false)}
        >
          待整理
        </button>
        <button
          className={showTransferred ? 'active' : ''}
          onClick={() => setShowTransferred(true)}
        >
          已转入
        </button>
      </div>
      <div className="scratch-layout">
        <div className="scratch-list">
          {entries.map((entry) => (
            <button key={entry.id} disabled={busy} onClick={() => void open(entry.id)}>
              {entry.title}
              <small>
                {entry.transferredTo
                  ? '已转入项目 · 只读'
                  : new Date(entry.updatedAt).toLocaleDateString()}
              </small>
            </button>
          ))}
          {!entries.length && <p className="muted">这里还没有草稿。</p>}
        </div>
        <div className="scratch-editor" key={draft?.document.meta.id ?? 'empty'}>
          {draft ? (
            <>
              <label>
                草稿名称
                <input
                  value={draft.title}
                  maxLength={200}
                  disabled={readonly}
                  onChange={(e) => edit({ title: e.target.value })}
                />
              </label>
              <div className="editor-toolbar">
                <div>
                  <button onClick={() => setPreview(false)}>编辑</button>
                  <button onClick={() => setPreview(true)}>预览</button>
                </div>
                <span aria-live="polite">
                  {draft.state === 'failed'
                    ? '保存失败 · 草稿已保留'
                    : draft.state === 'saving'
                      ? '正在保存…'
                      : draft.state === 'dirty'
                        ? '有未保存修改'
                        : '已保存到工作空间'}
                  {readonly ? ' · 只读' : ''}
                </span>
              </div>
              <Suspense fallback={<p>正在加载编辑器…</p>}>
                {preview ? (
                  <MarkdownPreview body={draft.body} />
                ) : (
                  <MarkdownEditor
                    key={draft.document.meta.id}
                    body={draft.body}
                    readonly={readonly}
                    onChange={(body) => edit({ body })}
                  />
                )}
              </Suspense>
              <div className="settings-actions">
                <button disabled={readonly} onClick={() => void flush()}>
                  保存临时草稿
                </button>
                <button
                  onClick={() =>
                    void copyText(draft.body).then((result) =>
                      onMessage(result.ok ? '临时草稿已复制' : '复制失败，请选中文本手动复制。'),
                    )
                  }
                >
                  复制临时草稿
                </button>
                {!draft.document.meta.transferredTo && (
                  <>
                    <select
                      aria-label="转入目标项目"
                      value={projectId}
                      disabled={readonly}
                      onChange={(e) => setProjectId(e.target.value)}
                    >
                      <option value="">选择项目</option>
                      {view.projects
                        .filter((p) => !p.deletedAt && p.status === 'active')
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                    </select>
                    <button disabled={readonly || !projectId} onClick={() => void transfer()}>
                      转入项目
                    </button>
                    <button disabled={readonly} onClick={() => setConfirmDelete(true)}>
                      删除临时草稿
                    </button>
                  </>
                )}
                {draft.document.meta.transferredTo && (
                  <button
                    disabled={busy}
                    onClick={() => {
                      const ref = draft.document.meta.transferredTo;
                      if (ref) void onOpenPrompt(ref.projectId, ref.promptId);
                    }}
                  >
                    查看转入的 Prompt
                  </button>
                )}
                {draft.state === 'failed' && (
                  <button
                    disabled={busy}
                    onClick={() => {
                      update({ ...draft, state: 'dirty' });
                      void flush();
                    }}
                  >
                    重试保存
                  </button>
                )}
              </div>
            </>
          ) : (
            <p className="editor-empty">选择一条临时草稿，或直接新建。</p>
          )}
        </div>
      </div>
      {confirmDelete && (
        <Modal
          title="删除临时草稿"
          onClose={() => {
            if (!busy) setConfirmDelete(false);
          }}
        >
          <p>文件会保留，可在“已删除”中恢复。</p>
          <footer>
            <button disabled={busy} onClick={() => setConfirmDelete(false)}>
              取消
            </button>
            <button disabled={busy} className="primary" onClick={() => void remove()}>
              确认删除临时草稿
            </button>
          </footer>
        </Modal>
      )}
      {recovery !== null && (
        <Modal title="恢复临时草稿副本" onClose={() => setRecovery(null)}>
          <p>副本只放回编辑器，仍需保存到工作空间。</p>
          <pre className="draft-snippet">{recovery.slice(0, 1000)}</pre>
          <footer>
            <button onClick={() => setRecovery(null)}>取消</button>
            <button
              onClick={() => {
                edit({ body: recovery });
                setRecovery(null);
              }}
            >
              恢复到草稿编辑器
            </button>
          </footer>
        </Modal>
      )}
    </section>
  );
}
