import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowUpRight,
  Check,
  Copy,
  FileText,
  FolderOpen,
  History,
  LayoutDashboard,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { Modal } from '../components/Modal';
import { WorkspaceSettings } from '../components/WorkspaceSettings';
import { MetadataForm, type MetadataInput } from '../components/MetadataForm';
import { PromptQueue } from '../components/PromptQueue';
import { ScratchpadWorkspace } from '../components/ScratchpadWorkspace';
import {
  statusLabels,
  statusSchema,
  versionReasonLabels,
  type PromptStatus,
} from '../domain/schemas';
import { ordered, tokenEstimate } from '../domain/policies';
import { workspaceController as api, type CreationPlan } from '../services/workspace/controller';
import { copyText } from '../services/clipboard/clipboard';
import type { OpenPrompt, WorkspaceView } from '../services/workspace/runtime';
import type { Result } from '../types/errors';
import { AppFault } from '../types/errors';
import { useEditorStore } from '../stores/editor';
import { usePromptEditor } from '../hooks/usePromptEditor';

type Dialog =
  | { kind: 'workspace'; name: string; plan: CreationPlan }
  | { kind: 'project'; name: string; id: string | null }
  | { kind: 'rename-prompt'; name: string; projectId: string; id: string }
  | { kind: 'delete-project'; id: string }
  | { kind: 'delete-prompt'; projectId: string; id: string }
  | { kind: 'restore'; number: number }
  | { kind: 'reload-disk'; document: OpenPrompt; body: string }
  | { kind: 'recovery-draft'; document: OpenPrompt; body: string };
const savedLabels = {
  saved: '已保存到工作空间',
  dirty: '有未保存修改',
  saving: '正在保存…',
  failed: '保存失败 · 内容已保留',
};
const MarkdownEditor = lazy(() =>
  import('../components/MarkdownEditor').then((module) => ({ default: module.MarkdownEditor })),
);
const MarkdownPreview = lazy(() =>
  import('../components/MarkdownPreview').then((module) => ({ default: module.MarkdownPreview })),
);

export function App() {
  const [view, setView] = useState<WorkspaceView | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [recents, setRecents] = useState<{ key: string; name: string; date: string }[]>([]);
  const [preview, setPreview] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [historyBody, setHistoryBody] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [listView, setListView] = useState(false);
  const [details, setDetails] = useState<'project' | 'prompt' | null>(null);
  const [protectedDraft, setProtectedDraft] = useState<{ sessionId: string; body: string } | null>(
    null,
  );
  const navigate = useNavigate(),
    location = useLocation();
  const updateView = useCallback(() => setView(api.view()), []);
  const { editor, flush: flushPrompt } = usePromptEditor(view, updateView);
  const scratchFlush = useRef<(() => Promise<boolean>) | null>(null);
  const registerScratchFlush = useCallback((callback: (() => Promise<boolean>) | null) => {
    scratchFlush.current = callback;
  }, []);
  const flush = useCallback(
    async () =>
      (await flushPrompt()) && (scratchFlush.current ? await scratchFlush.current() : true),
    [flushPrompt],
  );
  const consume = <T,>(result: Result<T>): T | undefined => {
    if (!result.ok) {
      if (result.error.code !== 'CANCELLED') setMessage(result.error.message);
      const sessionId = api.view()?.sessionId;
      if (sessionId)
        void api
          .run((runtime) => runtime.refreshPending())
          .then((next) => {
            if (next.ok && next.value.sessionId === api.view()?.sessionId) setView(next.value);
          });
      return undefined;
    }
    setMessage('');
    return result.value;
  };
  useEffect(() => {
    void api.recent().then((result) => {
      if (result.ok) setRecents(result.value);
    });
  }, []);
  const activeSessionId = view?.sessionId;
  useEffect(() => {
    if (!activeSessionId) return;
    let disposed = false;
    const sessionId = activeSessionId;
    const inspect = () => {
      const meta = useEditorStore.getState().document?.meta;
      void api
        .run((runtime) =>
          runtime.externalChanges(meta ? { projectId: meta.projectId, id: meta.id } : undefined),
        )
        .then((result) => {
          if (disposed || api.view()?.sessionId !== sessionId || !result.ok || !result.value.length)
            return;
          setMessage('本地文件已在其他程序中改变，请保留草稿后重新加载。');
          const current = useEditorStore.getState();
          if (current.document)
            useEditorStore.setState({ error: new AppFault('CONFLICT'), saveState: 'failed' });
        });
    };
    window.addEventListener('focus', inspect);
    return () => {
      disposed = true;
      window.removeEventListener('focus', inspect);
    };
  }, [activeSessionId]);
  const openDoc = async (projectId: string, id: string) => {
    setBusy(true);
    try {
      if (!(await flush())) return;
      const result = await api.run((runtime) => runtime.openPrompt(projectId, id));
      const doc = consume(result);
      if (!doc) return;
      useEditorStore.getState().load(doc);
      updateView();
      setShowVersions(false);
      setPreview(false);
      setHistoryBody(null);
      navigate(`/project/${projectId}/prompt/${id}`);
      const draft = await api.getRecoveryDraft(`prompt:${projectId}:${id}`);
      if (draft.ok && draft.value && draft.value.body !== doc.body)
        setDialog({ kind: 'recovery-draft', document: doc, body: draft.value.body });
    } finally {
      setBusy(false);
    }
  };
  async function createPrompt(projectId: string, parentPromptId?: string) {
    if (busy) return;
    setBusy(true);
    try {
      if (!(await flush())) return;
      const meta = consume(
        await api.run((runtime) =>
          parentPromptId
            ? runtime.createNext(projectId, parentPromptId)
            : runtime.createPrompt(projectId),
        ),
      );
      if (meta) await openDoc(meta.projectId, meta.id);
    } finally {
      setBusy(false);
    }
  }
  async function changeListedStatus(projectId: string, id: string, status: PromptStatus) {
    if (busy) return;
    setBusy(true);
    try {
      if (!(await flush())) return;
      const current = useEditorStore.getState().document;
      const selected = current?.meta.projectId === projectId && current.meta.id === id;
      const result = await api.run((runtime) =>
        selected
          ? runtime.checkpoint(projectId, id, useEditorStore.getState().body, status)
          : runtime.transitionStoredPrompt(projectId, id, status),
      );
      const updated = consume(result);
      if (updated && selected) useEditorStore.getState().load(updated);
      if (!result.ok) await api.run((runtime) => runtime.refreshPending());
      updateView();
      if (updated) setMessage('状态已更新');
    } finally {
      setBusy(false);
    }
  }
  const projectId = location.pathname.split('/')[2];
  const project = view?.projects.find((p) => p.id === projectId);
  const doc = editor.document;
  const currentProject = view?.projects.find((p) => p.id === doc?.meta.projectId);
  const readonly =
    busy ||
    !view?.writable ||
    !!view.pending.length ||
    currentProject?.status === 'archived' ||
    !!(
      currentProject &&
      view?.issues.some((issue) => issue.startsWith(`projects/${currentProject.slug}/`))
    ) ||
    !!currentProject?.deletedAt ||
    doc?.meta.status === 'archived' ||
    !!doc?.meta.deletedAt;
  const activeProjects = view?.projects.filter((p) => !p.deletedAt) ?? [];
  const visiblePrompts = ordered(
    (view?.prompts ?? []).filter(
      (p) =>
        p.projectId === project?.id &&
        !p.deletedAt &&
        (!query ||
          `${p.title} ${p.target} ${p.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase())),
    ),
  );
  async function saveDetails(input: MetadataInput) {
    setBusy(true);
    try {
      if (!(await flush())) return;
      if (details === 'project' && project) {
        const next = consume(
          await api.run((runtime) =>
            runtime.updateProject(project.id, {
              name: input.name,
              tags: input.tags,
              description: input.description,
            }),
          ),
        );
        if (next) {
          setView(next);
          setDetails(null);
        }
      } else if (doc) {
        const next = consume(
          await api.run((runtime) =>
            runtime.updatePrompt(doc.meta.projectId, doc.meta.id, {
              title: input.name,
              tags: input.tags,
              target: input.target,
              notes: input.notes,
            }),
          ),
        );
        if (next) {
          useEditorStore.setState((state) =>
            state.document ? { document: { ...state.document, meta: next } } : {},
          );
          updateView();
          setDetails(null);
        }
      }
    } finally {
      setBusy(false);
    }
  }
  async function movePrompt(id: string, direction: -1 | 1) {
    if (!project || busy) return;
    setBusy(true);
    try {
      if (!(await flush())) return;
      const ids = ordered(
        view?.prompts.filter((p) => p.projectId === project.id && !p.deletedAt) ?? [],
      ).map((p) => p.id);
      const from = ids.indexOf(id),
        to = from + direction;
      if (from < 0 || to < 0 || to >= ids.length) return;
      [ids[from], ids[to]] = [ids[to]!, ids[from]!];
      const next = consume(await api.run((runtime) => runtime.reorder(project.id, ids)));
      if (next) {
        setView(next);
        useEditorStore.setState((state) => {
          const meta = next.prompts.find(
            (p) =>
              p.id === state.document?.meta.id && p.projectId === state.document.meta.projectId,
          );
          return meta && state.document ? { document: { ...state.document, meta } } : {};
        });
      }
    } finally {
      setBusy(false);
    }
  }
  const counts = Object.fromEntries(
    statusSchema.options.map((status) => [
      status,
      view?.prompts.filter(
        (p) =>
          p.status === status &&
          !p.deletedAt &&
          view.projects.some(
            (project) =>
              project.id === p.projectId && !project.deletedAt && project.status === 'active',
          ),
      ).length ?? 0,
    ]),
  );

  const checkpoint = useCallback(
    async (next?: PromptStatus) => {
      if (!(await flush())) return;
      const state = useEditorStore.getState();
      if (!state.document) return;
      const sessionId = api.view()?.sessionId;
      const meta = state.document.meta;
      const seq = state.editSeq;
      const result = await api.run((runtime) =>
        runtime.checkpoint(meta.projectId, meta.id, state.body, next),
      );
      if (api.view()?.sessionId !== sessionId) return;
      if (!result.ok) {
        setMessage(result.error.message);
        await api.run((runtime) => runtime.refreshPending());
        updateView();
        return;
      }
      useEditorStore.setState((current) => {
        if (
          current.document?.meta.id !== meta.id ||
          current.document.meta.projectId !== meta.projectId
        )
          return current;
        return {
          document: result.value,
          persistedSeq: seq,
          saveState: current.editSeq === seq ? 'saved' : 'dirty',
          error: null,
        };
      });
      updateView();
      setMessage(next ? '状态已更新' : '版本已保存');
    },
    [flush, updateView],
  );
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing || !(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (!readonly) void checkpoint();
      }
      if (event.key.toLowerCase() === 'k') {
        event.preventDefault();
        (
          document.getElementById('prompt-search') ?? document.getElementById('global-search')
        )?.focus();
      }
      if (event.shiftKey && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        void copyText(useEditorStore.getState().body).then((result) =>
          setMessage(result.ok ? '已复制，状态未改变' : '复制失败，请选中文本手动复制。'),
        );
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [checkpoint, readonly]);

  async function submitDialog() {
    if (!dialog) return;
    setBusy(true);
    try {
      if (dialog.kind === 'workspace') {
        const next = consume(await api.create(dialog.name));
        if (next) {
          setView(next);
          navigate('/');
          setDialog(null);
        }
      } else if (dialog.kind === 'project') {
        const next = consume(
          await api.run((runtime) =>
            dialog.id
              ? runtime.updateProject(dialog.id, { name: dialog.name })
              : runtime.createProject(dialog.name),
          ),
        );
        if (next) {
          setView(next);
          setDialog(null);
          const p = dialog.id ?? next.projects.at(-1)?.id;
          if (p) navigate(`/project/${p}`);
        }
      } else if (dialog.kind === 'rename-prompt') {
        if (!(await flush())) return;
        const meta = consume(
          await api.run((runtime) =>
            runtime.updatePrompt(dialog.projectId, dialog.id, { title: dialog.name }),
          ),
        );
        if (meta) {
          updateView();
          setDialog(null);
          await openDoc(meta.projectId, meta.id);
        }
      } else if (dialog.kind === 'delete-project') {
        if (!(await flush())) return;
        const next = consume(
          await api.run((runtime) =>
            runtime.updateProject(dialog.id, { deletedAt: new Date().toISOString() }),
          ),
        );
        if (next) {
          setView(next);
          useEditorStore.getState().load(null);
          navigate('/');
          setDialog(null);
        }
      } else if (dialog.kind === 'delete-prompt') {
        if (!(await flush())) return;
        const next = consume(
          await api.run((runtime) => runtime.setPromptDeleted(dialog.projectId, dialog.id, true)),
        );
        if (next) {
          setView(next);
          useEditorStore.getState().load(null);
          setDialog(null);
        }
      } else if (dialog.kind === 'restore') {
        const state = useEditorStore.getState();
        if (!state.document || !(await flush())) return;
        const meta = state.document.meta;
        const restored = consume(
          await api.run((runtime) =>
            runtime.restore(meta.projectId, meta.id, dialog.number, state.body),
          ),
        );
        if (restored) {
          useEditorStore.getState().load(restored);
          updateView();
          setHistoryBody(null);
          setDialog(null);
        }
      } else if (dialog.kind === 'reload-disk') {
        const meta = dialog.document.meta;
        const sessionId = view?.sessionId;
        const next = consume(
          await api.run((runtime) => runtime.openPrompt(meta.projectId, meta.id)),
        );
        if (next && sessionId) {
          setProtectedDraft({ sessionId, body: dialog.body });
          useEditorStore.getState().load(next);
          updateView();
          setDialog(null);
        }
      } else {
        useEditorStore.getState().edit(dialog.body);
        setDialog(null);
      }
    } finally {
      setBusy(false);
    }
  }

  async function startCreation() {
    setBusy(true);
    const plan = consume(await api.prepareCreation());
    if (plan) {
      if (plan.existing) setMessage('此目录已经是工作空间，请使用“打开已有工作空间”。');
      else setDialog({ kind: 'workspace', plan, name: plan.directoryName });
    }
    setBusy(false);
  }
  async function launch(recentKey?: string) {
    setBusy(true);
    const next = consume(await (recentKey ? api.openRecent(recentKey) : api.open()));
    if (next) {
      setView(next);
      useEditorStore.getState().load(null);
      navigate('/');
    }
    setBusy(false);
  }
  async function go(path: string) {
    if (busy) return;
    setBusy(true);
    try {
      if (!(await flush())) return;
      useEditorStore.getState().load(null);
      navigate(path);
      setQuery('');
    } finally {
      setBusy(false);
    }
  }
  async function recoverPending(operationId: string, choice: 'finish' | 'rollback') {
    const old = useEditorStore.getState();
    const result = await api.run(async (runtime) => {
      const recoveredView = await runtime.recover(operationId, choice);
      const document = old.document
        ? await runtime.openPrompt(old.document.meta.projectId, old.document.meta.id)
        : null;
      return { view: recoveredView, document };
    });
    const next = consume(result);
    if (!next) return;
    setView(next.view);
    useEditorStore.getState().load(next.document);
    if (next.document && old.editSeq !== old.persistedSeq && old.body !== next.document.body)
      setDialog({ kind: 'recovery-draft', document: next.document, body: old.body });
  }

  const modal = dialog && (
    <Modal
      title={
        dialog.kind === 'workspace'
          ? '创建本地工作空间'
          : dialog.kind === 'project'
            ? '项目名称'
            : dialog.kind === 'rename-prompt'
              ? '修改 Prompt 标题'
              : dialog.kind === 'restore'
                ? '恢复历史版本'
                : dialog.kind === 'reload-disk'
                  ? '保留草稿并重新加载磁盘'
                  : dialog.kind === 'recovery-draft'
                    ? '发现未保存的恢复副本'
                    : '确认删除'
      }
      onClose={() => {
        if (!busy) setDialog(null);
      }}
    >
      {'name' in dialog ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submitDialog();
          }}
        >
          {dialog.kind === 'workspace' && (
            <p>
              将在「{dialog.plan.directoryName}」中创建 .promptdesk/、projects/ 和 scratchpad/。
              {dialog.plan.nonempty ? '此目录非空，已有资料将保留。' : '提示词只保存在这个目录中。'}
            </p>
          )}
          <label>
            名称
            <input
              autoFocus
              value={dialog.name}
              maxLength={200}
              onChange={(event) => setDialog({ ...dialog, name: event.target.value })}
            />
          </label>
          <footer>
            <button type="button" onClick={() => setDialog(null)}>
              取消
            </button>
            <button className="primary" disabled={busy || !dialog.name.trim()}>
              {busy ? '处理中…' : '确认'}
            </button>
          </footer>
        </form>
      ) : (
        <>
          <p>
            {dialog.kind === 'restore'
              ? `恢复 V${dialog.number} 将先保留当前草稿，再创建一个新的恢复版本。状态不会自动改变。`
              : dialog.kind === 'recovery-draft'
                ? '发现浏览器中保留的未保存文本。磁盘内容已读取；选择恢复只会将副本放回编辑器，不会直接覆盖文件。'
                : dialog.kind === 'reload-disk'
                  ? '当前草稿将保留在本次会话中，供继续查看和复制；编辑器会重新读取磁盘文件。'
                  : '删除后会从默认列表隐藏，目录和历史版本仍然保留，可以在“已删除”中恢复。'}
          </p>
          {(dialog.kind === 'recovery-draft' || dialog.kind === 'reload-disk') && (
            <pre className="draft-snippet">{dialog.body.slice(0, 1000)}</pre>
          )}
          <footer>
            {(dialog.kind === 'recovery-draft' || dialog.kind === 'reload-disk') && (
              <button
                onClick={() =>
                  void copyText(dialog.body).then((result) =>
                    setMessage(result.ok ? '保留草稿已复制' : '复制失败，请手动复制。'),
                  )
                }
              >
                复制保留草稿
              </button>
            )}
            <button onClick={() => setDialog(null)}>取消</button>
            <button className="primary" disabled={busy} onClick={() => void submitDialog()}>
              {dialog.kind === 'recovery-draft' ? '恢复到编辑器' : '确认'}
            </button>
          </footer>
        </>
      )}
    </Modal>
  );

  if (!view)
    return (
      <div className="launcher">
        <nav className="launcher-nav">
          <a className="brand" href="#/">
            <span className="logo">
              <FileText size={19} />
            </span>
            PromptDesk
          </a>
          <span className="beta">开发预览 · V0.1</span>
        </nav>
        <main className="launcher-main">
          <span className="eyebrow">
            <span className="dot" />
            YOUR LOCAL PROMPT WORKSPACE
          </span>
          <h1>
            先写好，
            <br />
            再出发<span className="accent">。</span>
          </h1>
          <p className="lead">
            给思考一个安全的地方。
            <br />
            整理项目、准备下一步，让每一条提示词都有迹可循。
          </p>
          <div className="launch-actions">
            <button
              className="primary large"
              disabled={busy || !api.supported()}
              onClick={() => void launch()}
            >
              <FolderOpen size={19} />
              打开已有工作空间
              <ArrowUpRight size={17} />
            </button>
            <button
              className="large"
              disabled={busy || !api.supported()}
              onClick={() => void startCreation()}
            >
              <Plus size={19} />
              创建新工作空间
            </button>
          </div>
          {!api.supported() && (
            <p className="notice">
              请使用桌面 Chrome 或 Edge，通过 HTTPS 或 localhost 打开以访问本地目录。
            </p>
          )}
          {message && (
            <p className="notice" role="alert">
              {message}
            </p>
          )}
          {!api.cacheAvailable && (
            <p className="notice">浏览器缓存不可用，可通过选择目录继续使用。</p>
          )}
          {recents.length > 0 && (
            <section className="recent">
              <h2>最近使用</h2>
              {recents.map((r) => (
                <button key={r.key} disabled={busy} onClick={() => void launch(r.key)}>
                  <FolderOpen size={18} />
                  <span>
                    {r.name}
                    <small>点击打开或重新授权</small>
                  </span>
                  <ArrowUpRight size={16} />
                </button>
              ))}
            </section>
          )}
          <div className="privacy-note">
            <ShieldCheck size={18} />
            <span>数据留在你的文件夹里 · 无需账号 · 不上传提示词</span>
          </div>
        </main>
        <aside className="launcher-art" aria-hidden="true">
          <div className="art-label">A LITTLE SPACE FOR BIG IDEAS</div>
          <div className="paper back" />
          <div className="paper front">
            <span className="paper-number">PROMPT / 001</span>
            <h2>
              下一步，
              <br />
              已经准备好。
            </h2>
            <div className="paper-line" />
            <div className="paper-line short" />
            <div className="paper-line" />
            <div className="paper-tag">
              <Check size={14} /> 待提交
            </div>
            <span className="paper-bottom">YOUR IDEAS. YOUR FILES.</span>
          </div>
          <div className="art-caption">从灵感，到清晰的下一步。</div>
        </aside>
        {modal}
      </div>
    );

  return (
    <div className="workspace-app">
      <aside className="sidebar">
        <a
          className="brand"
          href="#/"
          onClick={(event) => {
            event.preventDefault();
            void go('/');
          }}
        >
          <span className="logo">
            <FileText size={19} />
          </span>
          PromptDesk
        </a>
        <div className="workspace-name">
          <FolderOpen size={16} />
          <span>{view.workspace.name}</span>
          <span className="dot" />
        </div>
        <button
          className={`nav-item ${location.pathname === '/' ? 'selected' : ''}`}
          onClick={() => void go('/')}
        >
          <LayoutDashboard size={18} />
          工作台
        </button>
        <div className="section-label">
          项目
          <button
            aria-label="新建项目"
            disabled={!view.writable}
            onClick={() => setDialog({ kind: 'project', name: '', id: null })}
          >
            <Plus size={16} />
          </button>
        </div>
        <div className="project-nav">
          {activeProjects.map((p) => (
            <button
              key={p.id}
              className={`nav-item ${project?.id === p.id ? 'selected' : ''}`}
              onClick={() => void go(`/project/${p.id}`)}
            >
              <span className="project-dot" />
              <span>{p.name}</span>
              {p.status === 'archived' && <small>归档</small>}
            </button>
          ))}
          {!activeProjects.length && (
            <p className="muted sidebar-empty">创建第一个项目，开始整理你的提示词。</p>
          )}
        </div>
        <div className="sidebar-bottom">
          <button className="nav-item" onClick={() => void go('/scratchpad')}>
            <FileText size={18} />
            临时草稿
          </button>
          <button className="nav-item" onClick={() => void go('/deleted')}>
            <Trash2 size={17} />
            已删除
          </button>
          <button className="nav-item" onClick={() => void go('/settings')}>
            <Settings size={17} />
            设置
          </button>
          <div className="local-badge">
            <ShieldCheck size={14} />
            仅存于本地文件夹
          </div>
        </div>
      </aside>
      <div className="workspace-content">
        <header className="topbar">
          <span>
            {project?.name ??
              (location.pathname === '/settings'
                ? '设置'
                : location.pathname === '/scratchpad'
                  ? '临时草稿'
                  : location.pathname === '/deleted'
                    ? '已删除'
                    : '我的工作台')}
          </span>
          <span className="beta">开发预览</span>
        </header>
        {protectedDraft?.sessionId === view.sessionId && (
          <div className="notice">
            冲突前的草稿仍保留在本次会话中。
            <button
              onClick={() =>
                void copyText(protectedDraft.body).then((result) =>
                  setMessage(result.ok ? '保留草稿已复制' : '复制失败，请查看后手动复制。'),
                )
              }
            >
              复制保留草稿
            </button>
            <details>
              <summary>查看保留草稿</summary>
              <pre className="draft-snippet">{protectedDraft.body}</pre>
            </details>
          </div>
        )}
        {(message || editor.error || !api.cacheAvailable || !view.writable) && (
          <div className="notice global-notice" role="status">
            {editor.error?.message ||
              message ||
              (!view.writable
                ? '当前工作空间为只读。'
                : '浏览器缓存不可用，最近目录与草稿恢复可能无法使用。')}
            {editor.error && (
              <>
                <button
                  onClick={() => {
                    useEditorStore.setState({ error: null, saveState: 'dirty' });
                    void flush();
                  }}
                >
                  重试保存
                </button>
                <button onClick={() => void copyText(editor.body)}>复制未保存内容</button>
                <button
                  onClick={() => {
                    if (doc) setDialog({ kind: 'reload-disk', document: doc, body: editor.body });
                  }}
                >
                  重新加载磁盘
                </button>
                <button
                  onClick={() =>
                    void api
                      .reauthorize()
                      .then((result) =>
                        setMessage(
                          result.ok ? '目录已重新授权，请重试保存。' : result.error.message,
                        ),
                      )
                  }
                >
                  重新授权目录
                </button>
              </>
            )}
          </div>
        )}
        {view.issues.length > 0 && (
          <div className="notice">部分条目无法读取，原文件已保留：{view.issues.join('、')}</div>
        )}
        {view.pending.length > 0 ? (
          <section className="page">
            <h1>{view.writable ? '需要恢复一次未完成的保存' : '另一个窗口正在保存'}</h1>
            <p>普通编辑已暂停。恢复会先校验磁盘与备份，遇到外部改动不会覆盖。</p>
            {view.pending.map((p) => (
              <div className="recovery-card" key={p.operationId}>
                <p>
                  {p.entries.length} 个文件 · {p.kind}
                  {p.phase === 'committed' ? ' · 保存已成功，待清理临时日志' : ''}
                </p>
                <button
                  disabled={!view.writable}
                  onClick={() => void recoverPending(p.operationId, 'finish')}
                >
                  {p.phase === 'committed' ? '完成清理' : '完成保存'}
                </button>
                <button
                  disabled={!view.writable || p.phase === 'committed'}
                  onClick={() => void recoverPending(p.operationId, 'rollback')}
                >
                  回退本次保存
                </button>
              </div>
            ))}
          </section>
        ) : location.pathname === '/scratchpad' ? (
          <ScratchpadWorkspace
            key={view.sessionId}
            view={view}
            busy={busy}
            setBusy={setBusy}
            onView={updateView}
            onMessage={setMessage}
            onOpenPrompt={openDoc}
            registerFlush={registerScratchFlush}
          />
        ) : location.pathname === '/settings' ? (
          <WorkspaceSettings
            key={view.sessionId}
            view={view}
            busy={busy}
            setBusy={setBusy}
            onView={setView}
            onMessage={setMessage}
            onClose={() => {
              setView(null);
              useEditorStore.getState().load(null);
              navigate('/');
            }}
          />
        ) : location.pathname === '/deleted' ? (
          <section className="page">
            <h1>已删除</h1>
            <p className="muted">文件仍保留在工作空间中，可随时恢复。</p>
            {view.projects
              .filter((p) => p.deletedAt)
              .map((p) => (
                <div className="deleted-row" key={p.id}>
                  <FolderOpen size={18} />
                  {p.name}
                  <button
                    onClick={() =>
                      void api
                        .run((runtime) => runtime.updateProject(p.id, { deletedAt: null }))
                        .then((result) => {
                          const next = consume(result);
                          if (next) setView(next);
                        })
                    }
                  >
                    恢复项目
                  </button>
                </div>
              ))}
            {view.prompts
              .filter((p) => p.deletedAt)
              .map((p) => (
                <div className="deleted-row" key={`${p.projectId}:${p.id}`}>
                  <FileText size={18} />
                  {p.title}
                  <button
                    onClick={() =>
                      void api
                        .run((runtime) => runtime.setPromptDeleted(p.projectId, p.id, false))
                        .then((result) => {
                          const next = consume(result);
                          if (next) setView(next);
                        })
                    }
                  >
                    恢复 Prompt
                  </button>
                </div>
              ))}
            {view.scratchpads
              .filter((scratch) => scratch.deletedAt)
              .map((scratch) => (
                <div className="deleted-row" key={scratch.id}>
                  <FileText size={18} />
                  {scratch.title}
                  <button
                    disabled={busy || !view.writable}
                    onClick={() =>
                      void api
                        .run((runtime) => runtime.setScratchDeleted(scratch.id, false))
                        .then((result) => {
                          const next = consume(result);
                          if (next) setView(next);
                        })
                    }
                  >
                    恢复临时草稿
                  </button>
                </div>
              ))}
          </section>
        ) : !project ? (
          <section className="page dashboard">
            <span className="eyebrow">A CLEARER NEXT STEP</span>
            <h1>让下一步，清晰可见。</h1>
            <p className="muted">在这里准备、组织和追踪你的提示词。</p>
            <div className="stat-grid">
              {(['ready', 'submitted', 'waiting', 'draft'] as const).map((s) => (
                <div key={s}>
                  <span className={`status-dot ${s}`} />
                  <span>{statusLabels[s]}</span>
                  <strong>{counts[s]}</strong>
                </div>
              ))}
            </div>
            <div className="section-heading">
              <h2>我的项目</h2>
              <button
                disabled={!view.writable}
                onClick={() => setDialog({ kind: 'project', name: '', id: null })}
              >
                <Plus size={16} />
                新建项目
              </button>
            </div>
            <div className="project-grid">
              {activeProjects.map((p) => (
                <button
                  className="project-card"
                  key={p.id}
                  onClick={() => void go(`/project/${p.id}`)}
                >
                  <FolderOpen size={23} />
                  <h3>{p.name}</h3>
                  <p>
                    {
                      view.prompts.filter(
                        (prompt) => prompt.projectId === p.id && !prompt.deletedAt,
                      ).length
                    }{' '}
                    条 Prompt
                  </p>
                  <ArrowUpRight size={18} />
                </button>
              ))}
              {!activeProjects.length && (
                <div className="empty-card">
                  <FileText size={32} />
                  <h3>从第一个项目开始</h3>
                  <p>把一个目标，拆成几条准备好的提示词。</p>
                  <button
                    className="primary"
                    disabled={!view.writable}
                    onClick={() => setDialog({ kind: 'project', name: '', id: null })}
                  >
                    创建项目
                  </button>
                </div>
              )}
            </div>
            <PromptQueue
              key={view.sessionId}
              view={view}
              busy={busy}
              onOpen={openDoc}
              onStatus={changeListedStatus}
              onMessage={setMessage}
              onView={updateView}
            />
          </section>
        ) : (
          <div className="project-workspace">
            <section className="prompt-list">
              <div className="list-title">
                <h2>
                  Prompts <span>{visiblePrompts.length}</span>
                </h2>
                <button
                  aria-label="新建 Prompt"
                  disabled={busy || !view.writable || project.status === 'archived'}
                  onClick={() => void createPrompt(project.id)}
                >
                  <Plus size={18} />
                </button>
              </div>
              <div className="search-field">
                <Search size={15} />
                <input
                  id="prompt-search"
                  aria-label="搜索当前项目"
                  placeholder="搜索标题、模型、标签"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <div className="view-toggle">
                <button className={!listView ? 'active' : ''} onClick={() => setListView(false)}>
                  工作流
                </button>
                <button className={listView ? 'active' : ''} onClick={() => setListView(true)}>
                  列表
                </button>
              </div>
              <div className={listView ? 'prompt-items' : 'prompt-items flow'}>
                {visiblePrompts.map((p) => (
                  <div
                    className={`prompt-card ${doc?.meta.id === p.id && doc.meta.projectId === p.projectId ? 'active' : ''}`}
                    key={p.id}
                  >
                    <span className={`status-dot ${p.status}`} />
                    <div>
                      <button
                        className="prompt-open"
                        disabled={busy}
                        onClick={() => void openDoc(project.id, p.id)}
                        aria-label={`打开 ${p.id} ${p.title}`}
                      >
                        <small>
                          {p.id} · {p.target}
                        </small>
                        <h3>{p.title}</h3>
                      </button>
                      <select
                        className={`status-label ${p.status}`}
                        aria-label={`${p.id} 列表状态`}
                        value={p.status}
                        disabled={busy || !view.writable || project.status === 'archived'}
                        onChange={(event) =>
                          void changeListedStatus(
                            p.projectId,
                            p.id,
                            statusSchema.parse(event.target.value),
                          )
                        }
                      >
                        {statusSchema.options.map((s) => (
                          <option key={s} value={s}>
                            {statusLabels[s]}
                          </option>
                        ))}
                      </select>
                      {p.parentPromptId && (
                        <small className="parent-label">
                          前置 {p.parentPromptId}
                          {view.prompts.find(
                            (parent) =>
                              parent.projectId === p.projectId && parent.id === p.parentPromptId,
                          )?.deletedAt
                            ? '（已删除）'
                            : ''}
                        </small>
                      )}
                      <div className="order-controls">
                        <button
                          aria-label={`上移 ${p.id}`}
                          disabled={
                            busy ||
                            !view.writable ||
                            project.status === 'archived' ||
                            p.status === 'archived' ||
                            !!query ||
                            p.order === 1
                          }
                          onClick={() => void movePrompt(p.id, -1)}
                        >
                          ↑
                        </button>
                        <button
                          aria-label={`下移 ${p.id}`}
                          disabled={
                            busy ||
                            !view.writable ||
                            project.status === 'archived' ||
                            p.status === 'archived' ||
                            !!query ||
                            p.order ===
                              view.prompts.filter(
                                (item) => item.projectId === project.id && !item.deletedAt,
                              ).length
                          }
                          onClick={() => void movePrompt(p.id, 1)}
                        >
                          ↓
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                {!visiblePrompts.length && (
                  <div className="list-empty">
                    <FileText size={26} />
                    <p>{query ? '没有匹配的 Prompt' : '先准备一条提示词吧。'}</p>
                  </div>
                )}
              </div>
              <div className="project-controls">
                <button
                  disabled={busy || !view.writable || project.status === 'archived'}
                  onClick={() => setDetails('project')}
                >
                  项目资料
                </button>
                <button
                  disabled={busy || !view.writable || project.status === 'archived'}
                  onClick={() => setDialog({ kind: 'project', name: project.name, id: project.id })}
                >
                  重命名
                </button>
                <button
                  disabled={!view.writable}
                  onClick={() =>
                    void (async () => {
                      if (!(await flush())) return;
                      const next = consume(
                        await api.run((runtime) =>
                          runtime.updateProject(project.id, {
                            status: project.status === 'active' ? 'archived' : 'active',
                          }),
                        ),
                      );
                      if (next) setView(next);
                    })()
                  }
                >
                  {project.status === 'active' ? '归档项目' : '取消归档'}
                </button>
                <button
                  disabled={!view.writable}
                  aria-label="删除项目"
                  onClick={() => setDialog({ kind: 'delete-project', id: project.id })}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </section>
            <section className="editor-pane">
              {doc && doc.meta.projectId === project.id ? (
                <>
                  <div className="editor-heading">
                    <span className="eyebrow">{doc.meta.id} / PROMPT</span>
                    <h1>{doc.meta.title}</h1>
                    <div className="prompt-meta">
                      <select
                        aria-label="Prompt 状态"
                        value={doc.meta.status}
                        disabled={busy || !view.writable || project.status === 'archived'}
                        onChange={(event) =>
                          void checkpoint(statusSchema.parse(event.target.value))
                        }
                      >
                        {statusSchema.options.map((s) => (
                          <option key={s} value={s}>
                            {statusLabels[s]}
                          </option>
                        ))}
                      </select>
                      <span>{doc.meta.target}</span>
                      <span>V{doc.meta.currentVersion}</span>
                      {doc.meta.submittedVersion && (
                        <span>已提交 V{doc.meta.submittedVersion}</span>
                      )}
                      {doc.meta.versions.length > 0 &&
                        (editor.editSeq !== editor.persistedSeq ||
                          doc.baseContentHash !== doc.meta.versions.at(-1)?.contentHash) && (
                          <span>当前草稿与最新版本不同</span>
                        )}
                      <button disabled={readonly} onClick={() => setDetails('prompt')}>
                        资料与标签
                      </button>
                      <button
                        disabled={readonly}
                        onClick={() =>
                          setDialog({
                            kind: 'rename-prompt',
                            projectId: project.id,
                            id: doc.meta.id,
                            name: doc.meta.title,
                          })
                        }
                      >
                        修改标题
                      </button>
                      <button
                        aria-label="删除 Prompt"
                        disabled={readonly}
                        onClick={() =>
                          setDialog({
                            kind: 'delete-prompt',
                            projectId: project.id,
                            id: doc.meta.id,
                          })
                        }
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                  <div className="editor-toolbar">
                    <div>
                      <button
                        className={!preview ? 'active' : ''}
                        onClick={() => setPreview(false)}
                      >
                        编辑
                      </button>
                      <button className={preview ? 'active' : ''} onClick={() => setPreview(true)}>
                        预览
                      </button>
                    </div>
                    <span className={`save-label ${editor.saveState}`} aria-live="polite">
                      {readonly ? '只读' : savedLabels[editor.saveState]}
                    </span>
                  </div>
                  <Suspense fallback={<div className="editor-empty">正在加载编辑器…</div>}>
                    {preview ? (
                      <MarkdownPreview body={editor.body} />
                    ) : (
                      <MarkdownEditor
                        key={`${doc.meta.projectId}:${doc.meta.id}`}
                        body={editor.body}
                        readonly={readonly}
                        onChange={useEditorStore.getState().edit}
                      />
                    )}
                  </Suspense>
                  <div className="editor-footer">
                    <span>
                      {[...editor.body].length} 字符 <span className="separator">·</span> 约{' '}
                      {tokenEstimate(editor.body)} Tokens（粗估）
                    </span>
                    <div>
                      <button
                        onClick={() => {
                          setShowVersions(!showVersions);
                          setHistoryBody(null);
                        }}
                      >
                        <History size={16} />
                        版本 {doc.meta.versions.length}
                      </button>
                      <button disabled={readonly} onClick={() => void checkpoint()}>
                        <Plus size={16} />
                        保存版本
                      </button>
                      <button disabled={readonly} onClick={() => void flush()}>
                        保存草稿
                      </button>
                      <button
                        disabled={readonly}
                        onClick={() => void createPrompt(project.id, doc.meta.id)}
                      >
                        下一条
                      </button>
                      {doc.meta.status === 'submitted' && (
                        <button
                          disabled={readonly}
                          onClick={() =>
                            void (async () => {
                              setBusy(true);
                              try {
                                if (!(await flush())) return;
                                const state = useEditorStore.getState();
                                const next = consume(
                                  await api.run((runtime) =>
                                    runtime.checkpoint(
                                      project.id,
                                      doc.meta.id,
                                      state.body,
                                      'submitted',
                                      true,
                                    ),
                                  ),
                                );
                                if (next) {
                                  useEditorStore.getState().load(next);
                                  updateView();
                                  setMessage('已记录再次提交');
                                }
                              } finally {
                                setBusy(false);
                              }
                            })()
                          }
                        >
                          再次标记提交
                        </button>
                      )}
                      <button
                        className="primary"
                        onClick={() =>
                          void copyText(editor.body).then((result) =>
                            setMessage(
                              result.ok ? '已复制，状态未改变。' : '复制失败，请选中文本手动复制。',
                            ),
                          )
                        }
                      >
                        <Copy size={16} />
                        复制 Prompt
                      </button>
                    </div>
                  </div>
                  {showVersions && (
                    <div className="versions-panel">
                      <header>
                        <h2>版本历史</h2>
                        <button onClick={() => setShowVersions(false)}>关闭</button>
                      </header>
                      {[...doc.meta.versions].reverse().map((v) => (
                        <div className="version-row" key={v.number}>
                          <span>
                            <strong>V{v.number}</strong> · {versionReasonLabels[v.reason]}
                            <small>{new Date(v.createdAt).toLocaleString()}</small>
                          </span>
                          <button
                            onClick={() =>
                              void api
                                .run((runtime) =>
                                  runtime.readVersion(project.id, doc.meta.id, v.number),
                                )
                                .then((result) => {
                                  const body = consume(result);
                                  if (body !== undefined) setHistoryBody(body);
                                })
                            }
                          >
                            查看
                          </button>
                          <button
                            disabled={readonly}
                            onClick={() => setDialog({ kind: 'restore', number: v.number })}
                          >
                            恢复
                          </button>
                        </div>
                      ))}
                      {!doc.meta.versions.length && (
                        <p className="muted">
                          自动保存不生成版本。点击“保存版本”创建第一个检查点。
                        </p>
                      )}
                      {historyBody !== null && <pre className="history-body">{historyBody}</pre>}
                      <details>
                        <summary>状态记录（{doc.meta.statusHistory.length}）</summary>
                        <ol>
                          {doc.meta.statusHistory.map((event) => (
                            <li key={event.id}>
                              {event.from ? statusLabels[event.from] : '创建'} →{' '}
                              {statusLabels[event.to]} · {new Date(event.at).toLocaleString()}
                              {event.kind === 'resubmit' ? ' · 再次提交' : ''}
                              {event.versionNumber ? ` · V${event.versionNumber}` : ''}
                            </li>
                          ))}
                        </ol>
                      </details>
                    </div>
                  )}
                </>
              ) : (
                <div className="editor-empty">
                  <FileText size={40} />
                  <h2>给下一步，留一张白纸。</h2>
                  <p>选择一条 Prompt 开始编辑，或新建一条。</p>
                  <button
                    className="primary"
                    disabled={busy || !view.writable || project.status === 'archived'}
                    onClick={() => void createPrompt(project.id)}
                  >
                    <Plus size={16} />
                    新建 Prompt
                  </button>
                </div>
              )}
            </section>
          </div>
        )}
      </div>
      {modal}
      {details && project && (
        <Modal
          title={details === 'project' ? '项目资料' : 'Prompt 资料'}
          onClose={() => {
            if (!busy) setDetails(null);
          }}
        >
          <MetadataForm
            key={`${details}:${project.id}:${doc?.meta.id ?? ''}`}
            kind={details}
            disabled={busy}
            onSave={saveDetails}
            initial={
              details === 'project'
                ? {
                    name: project.name,
                    tags: project.tags,
                    description: project.description,
                    target: '',
                    notes: '',
                  }
                : {
                    name: doc?.meta.title ?? '',
                    tags: doc?.meta.tags ?? [],
                    description: '',
                    target: doc?.meta.target ?? 'Codex',
                    notes: doc?.meta.notes ?? '',
                  }
            }
          />
        </Modal>
      )}
    </div>
  );
}
