import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Menu,
  Plus,
  Copy,
  ArrowLeft,
  GripVertical,
  Settings,
  Check,
  Folder,
  Cloud,
  List,
  PenLine,
  SlidersHorizontal,
} from 'lucide-react';
import { authClient } from '../services/api/authClient';
import { isPreviewDeployment } from '../services/api/deployment';
import { cloudClient, cloudErrorMessage } from '../services/api/cloudClient';
import { copyText } from '../services/clipboard/clipboard';
import {
  cloudLabels,
  type CloudAccess,
  type CloudProject,
  type CloudPrompt,
  type CloudVersion,
} from '../domain/cloud';
import { AccountPage } from '../components/AccountPage';
import { ChangePassword, UserManagement } from '../components/CloudAccountTools';
import { MarkdownEditor } from '../components/MarkdownEditor';
import { MarkdownPreview } from '../components/MarkdownPreview';
import { useCloudEditor } from './useCloudEditor';
import './cloud.css';

export function CloudApp() {
  const { data: session, isPending } = authClient.useSession();
  const [protectedUser, setProtectedUser] = useState<{ id: string; name: string } | null>(null);
  const onUnsaved = useCallback(
    (dirty: boolean) => {
      setProtectedUser((previous) => (dirty ? (previous ?? session?.user ?? null) : null));
    },
    [session?.user],
  );
  const user = protectedUser ?? session?.user;
  if (isPending && !user)
    return (
      <main className="cloud-loading" role="status">
        正在打开个人空间…
      </main>
    );
  if (!user) return <AccountPage />;
  return <PersonalSpace key={user.id} name={user.name} onUnsaved={onUnsaved} />;
}

function PersonalSpace({ name, onUnsaved }: { name: string; onUnsaved: (dirty: boolean) => void }) {
  const [access, setAccess] = useState<CloudAccess | null>(null),
    [projects, setProjects] = useState<CloudProject[]>([]),
    [projectId, setProjectId] = useState<string | null>(null);
  const [prompts, setPrompts] = useState<CloudPrompt[]>([]),
    [versions, setVersions] = useState<CloudVersion[]>([]);
  const [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [account, setAccount] = useState(false),
    [pane, setPane] = useState<'projects' | 'list' | 'editor'>('projects');
  const [collapsed, setCollapsed] = useState(false),
    [editorToolsOpen, setEditorToolsOpen] = useState(false),
    [showCompleted, setCompleted] = useState(false),
    [showTrash, setTrash] = useState(false),
    [query, setQuery] = useState(''),
    [preview, setPreview] = useState(false),
    [fontSize, setFontSize] = useState(16);
  const [newProject, setNewProject] = useState(false),
    [newName, setNewName] = useState(''),
    [projectSettings, setProjectSettings] = useState(false);
  const [projectName, setProjectName] = useState(''),
    [description, setDescription] = useState('');
  const selectionEpoch = useRef(0),
    alive = useRef(true),
    dragged = useRef<string | null>(null);
  const editor = useCloudEditor(
    (prompt) => setPrompts((items) => items.map((item) => (item.id === prompt.id ? prompt : item))),
    onUnsaved,
  );
  const project = projects.find((p) => p.id === projectId);
  const readonly = Boolean(project?.archived || project?.deletedAt || editor.draft?.deletedAt);

  useEffect(() => {
    const epochRef = selectionEpoch;
    alive.current = true;
    void cloudClient
      .me()
      .then((value) => {
        if (alive.current) setAccess(value);
      })
      .catch((error) => {
        if (alive.current) setMessage(cloudErrorMessage(error));
      });
    return () => {
      alive.current = false;
      epochRef.current++;
    };
  }, []);
  useEffect(() => {
    if (!access || access.mustChangePassword) return;
    let active = true;
    void cloudClient
      .projects()
      .then((items) => {
        if (active) setProjects(items);
      })
      .catch((error) => {
        if (active) setMessage(cloudErrorMessage(error));
      });
    return () => {
      active = false;
    };
  }, [access]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage('');
    try {
      await action();
    } catch (error) {
      if (alive.current) setMessage(cloudErrorMessage(error));
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const refreshProjects = async () => {
    const items = await cloudClient.projects();
    if (alive.current) setProjects(items);
  };
  const refreshPrompts = async (id: string) => {
    const items = await cloudClient.prompts(id);
    if (alive.current) setPrompts(items);
    return items;
  };
  const openProject = async (id: string) => {
    if (!(await editor.flush())) return;
    const epoch = ++selectionEpoch.current;
    const items = await cloudClient.prompts(id);
    if (!alive.current || epoch !== selectionEpoch.current) return;
    editor.select(null);
    setProjectId(id);
    setPrompts(items);
    setVersions([]);
    setPane('list');
    setProjectSettings(false);
  };
  const openPrompt = async (prompt: CloudPrompt) => {
    if (!(await editor.flush())) return;
    const epoch = ++selectionEpoch.current;
    const item = await cloudClient.prompt(prompt.id);
    if (!alive.current || epoch !== selectionEpoch.current) return;
    editor.select(item);
    setVersions([]);
    setPane('editor');
  };
  const createPrompt = async () => {
    if (!projectId || !(await editor.flush())) return;
    const prompt = await cloudClient.createPrompt(projectId);
    if (!alive.current) return;
    setPrompts((items) => [...items, prompt]);
    editor.select(prompt);
    setVersions([]);
    setPane('editor');
  };
  const transition = async (prompt: CloudPrompt) => {
    if (!(await editor.flush())) return;
    const latest =
      editor.latest()?.id === prompt.id ? editor.latest() : await cloudClient.prompt(prompt.id);
    if (!latest) return;
    const status = latest.status === 'completed' ? 'draft' : 'completed';
    if (editor.latest()?.id === prompt.id) await editor.save({ status });
    else {
      const saved = await cloudClient.save(prompt.id, { revision: latest.revision, status });
      setPrompts((items) => items.map((item) => (item.id === saved.id ? saved : item)));
    }
  };
  const reorder = async (id: string, targetId: string) => {
    if (!project || readonly || id === targetId || !(await editor.flush())) return;
    const ids = [...prompts].sort((a, b) => a.sortOrder - b.sortOrder).map((p) => p.id);
    const from = ids.indexOf(id),
      to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(from, 1);
    ids.splice(to, 0, id);
    await cloudClient.order(project.id, project.revision, ids);
    await refreshProjects();
    await refreshPrompts(project.id);
  };
  const updateProject = async (patch: {
    name?: string;
    description?: string;
    archived?: boolean;
    deleted?: boolean;
  }) => {
    if (!project || !(await editor.flush())) return;
    const updated = await cloudClient.updateProject(project.id, {
      revision: project.revision,
      ...patch,
    });
    setProjects((items) => items.map((item) => (item.id === updated.id ? updated : item)));
    setProjectSettings(false);
  };
  const accountContent = (
    <div className="cloud-settings-content">
      <button onClick={() => setAccount(false)}>
        <ArrowLeft size={16} /> 返回个人空间
      </button>
      <AccountPage onBack={() => setAccount(false)} allowDelete={access?.role !== 'admin'} />
      <ChangePassword
        required={false}
        onDone={() => void run(async () => setAccess(await cloudClient.me()))}
      />
      {access?.role === 'admin' && <UserManagement />}
    </div>
  );
  if (!access)
    return (
      <main className="cloud-loading">
        <p role="status">{message || '正在检查空间权限…'}</p>
        <button onClick={() => void run(async () => setAccess(await cloudClient.me()))}>
          重试
        </button>
        <button onClick={() => void authClient.signOut()}>退出登录</button>
      </main>
    );
  if (access.mustChangePassword)
    return (
      <main className="cloud-loading">
        <ChangePassword
          required
          onDone={() => void run(async () => setAccess(await cloudClient.me()))}
        />
        <button onClick={() => void authClient.signOut()}>退出登录</button>
      </main>
    );
  if (account) return accountContent;

  const rows = [...prompts].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt),
  );
  const matches = (p: CloudPrompt) =>
    `${p.title}\n${p.body}`.toLowerCase().includes(query.toLowerCase());
  const activeRows = rows.filter((p) => !p.deletedAt && p.status !== 'completed' && matches(p)),
    completedRows = rows.filter((p) => !p.deletedAt && p.status === 'completed' && matches(p)),
    trashRows = rows.filter((p) => p.deletedAt && matches(p));
  const renderRow = (prompt: CloudPrompt) => (
    <li
      key={prompt.id}
      data-prompt-id={prompt.id}
      className={`cloud-prompt-row status-${prompt.status} ${editor.draft?.id === prompt.id ? 'selected' : ''}`}
      draggable={!busy && !readonly && !prompt.deletedAt}
      onDragStart={() => {
        dragged.current = prompt.id;
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const id = dragged.current;
        dragged.current = null;
        if (id) void run(() => reorder(id, prompt.id));
      }}
    >
      <button
        className="cloud-drag"
        aria-label={`拖动排序：${prompt.title}，方向键调整顺序`}
        disabled={busy || readonly || Boolean(prompt.deletedAt)}
        onPointerDown={(e) => {
          dragged.current = prompt.id;
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerUp={(e) => {
          const target = document
            .elementFromPoint(e.clientX, e.clientY)
            ?.closest<HTMLElement>('[data-prompt-id]')?.dataset.promptId;
          const id = dragged.current;
          dragged.current = null;
          if (id && target) void run(() => reorder(id, target));
        }}
        onPointerCancel={() => {
          dragged.current = null;
        }}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
          e.preventDefault();
          const index = rows.findIndex((p) => p.id === prompt.id),
            target = rows[index + (e.key === 'ArrowUp' ? -1 : 1)];
          if (target) void run(() => reorder(prompt.id, target.id));
        }}
      >
        <GripVertical size={14} />
      </button>
      <button
        role="checkbox"
        aria-checked={prompt.status === 'completed'}
        aria-label={`${prompt.status === 'completed' ? '取消完成' : '标记完成'}：${prompt.title}`}
        className="cloud-check"
        disabled={busy || Boolean(project?.archived || project?.deletedAt || prompt.deletedAt)}
        onClick={() => void run(() => transition(prompt))}
      >
        {prompt.status === 'completed' && <Check size={14} />}
      </button>
      <button
        className="cloud-prompt-open"
        disabled={busy}
        onClick={() => void run(() => openPrompt(prompt))}
      >
        <span>
          {prompt.title === '未命名提示词' && prompt.body
            ? prompt.body
                .split('\n')
                .find((line) => line.trim())
                ?.slice(0, 65)
            : prompt.title}
        </span>
        <small>
          {cloudLabels[prompt.status]}
          {prompt.priority === 'high'
            ? ' · 高优先级'
            : prompt.priority === 'low'
              ? ' · 低优先级'
              : ''}
        </small>
      </button>
    </li>
  );
  return (
    <div className={`cloud-app ${collapsed ? 'sidebar-collapsed' : ''} pane-${pane}`}>
      <header className="cloud-topbar">
        <button
          aria-label="收起或展开项目栏"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed(!collapsed)}
        >
          <Menu size={18} />
        </button>
        <span className="cloud-brand">PromptDesk</span>
        {isPreviewDeployment && <span className="cloud-environment">测试版</span>}
        <span className="cloud-personal">
          <Cloud size={14} /> {name} 的个人空间
        </span>
        <button
          className="cloud-account-button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              if (await editor.flush()) setAccount(true);
            })
          }
        >
          <Settings size={16} />
          <span>账户{access.role === 'admin' ? ' / 管理' : ''}</span>
        </button>
      </header>
      <nav className="cloud-mobile-nav" aria-label="个人空间导航">
        <button
          aria-current={pane === 'projects' ? 'page' : undefined}
          onClick={() =>
            void run(async () => {
              if (await editor.flush()) setPane('projects');
            })
          }
        >
          <Folder size={18} /> 项目
        </button>
        <button
          disabled={!project}
          aria-current={pane === 'list' ? 'page' : undefined}
          onClick={() =>
            void run(async () => {
              if (await editor.flush()) setPane('list');
            })
          }
        >
          <List size={18} /> 提示词
        </button>
        <button
          disabled={!editor.draft}
          aria-current={pane === 'editor' ? 'page' : undefined}
          onClick={() => setPane('editor')}
        >
          <PenLine size={18} /> 编辑
        </button>
      </nav>
      {message && (
        <div className="cloud-message" role="alert">
          {message}
          <button onClick={() => setMessage('')}>关闭提示</button>
        </div>
      )}
      <div className="cloud-layout">
        <aside className="cloud-projects" aria-label="项目导航">
          <div className="cloud-section-heading">
            <h2>我的项目</h2>
            <button
              aria-label="新建项目"
              disabled={busy}
              onClick={() => setNewProject(!newProject)}
            >
              <Plus size={18} />
            </button>
          </div>
          {newProject && (
            <form
              className="cloud-new-project"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  if (!(await editor.flush())) return;
                  const p = await cloudClient.createProject(newName);
                  setProjects((items) => [p, ...items]);
                  setNewProject(false);
                  setNewName('');
                  await openProject(p.id);
                });
              }}
            >
              <input
                aria-label="项目名称"
                placeholder="项目名称"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                required
                maxLength={120}
              />
              <button disabled={busy} className="primary-button">
                创建
              </button>
            </form>
          )}
          <ul>
            {projects
              .filter((p) => !p.deletedAt)
              .map((p) => (
                <li key={p.id}>
                  <button
                    className={p.id === projectId ? 'selected' : ''}
                    disabled={busy}
                    onClick={() => void run(() => openProject(p.id))}
                  >
                    <Folder size={15} />
                    <span>{p.name}</span>
                    {Boolean(p.archived) && <small>归档</small>}
                  </button>
                </li>
              ))}
          </ul>
          {!projects.length && <p className="cloud-empty">创建第一个项目，开始记录想法。</p>}
          <details>
            <summary>已删除项目</summary>
            <ul>
              {projects
                .filter((p) => p.deletedAt)
                .map((p) => (
                  <li key={p.id}>
                    <button disabled={busy} onClick={() => void run(() => openProject(p.id))}>
                      {p.name}
                    </button>
                  </li>
                ))}
            </ul>
          </details>
          <p className="cloud-storage-note">数据保存到服务器。换台设备登录即可继续。</p>
        </aside>
        <section className="cloud-list" aria-label="提示词列表">
          <div className="cloud-section-heading">
            <h1>{project?.name ?? '个人空间'}</h1>
            {project && (
              <button
                aria-label="修改项目信息"
                disabled={busy}
                onClick={() => {
                  setProjectName(project.name);
                  setDescription(project.description);
                  setProjectSettings(!projectSettings);
                }}
              >
                <Settings size={16} />
              </button>
            )}
          </div>
          {projectSettings && project && (
            <form
              className="cloud-project-settings"
              onSubmit={(e) => {
                e.preventDefault();
                void run(() => updateProject({ name: projectName, description }));
              }}
            >
              <label>
                项目名称
                <input
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  maxLength={120}
                  required
                />
              </label>
              <label>
                描述
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={4000}
                />
              </label>
              <button disabled={busy}>保存信息</button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(() => updateProject({ archived: !project.archived }))}
              >
                {project.archived ? '取消归档' : '归档项目'}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      project.deletedAt
                        ? '恢复项目？'
                        : '删除项目？项目及其提示词可以从已删除项目恢复。',
                    )
                  )
                    void run(() => updateProject({ deleted: !project.deletedAt }));
                }}
              >
                {project.deletedAt ? '恢复项目' : '删除项目'}
              </button>
            </form>
          )}
          {project && (
            <>
              <div className="cloud-list-tools">
                <input
                  type="search"
                  aria-label="搜索提示词"
                  placeholder="搜索提示词"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <button
                  className="primary-button"
                  disabled={busy || Boolean(project.archived || project.deletedAt)}
                  onClick={() => void run(createPrompt)}
                >
                  <Plus size={15} /> 新建
                </button>
              </div>
              <div className="cloud-list-scroll">
                <ul>{activeRows.map(renderRow)}</ul>
                {!activeRows.length && (
                  <p className="cloud-empty">
                    {project.archived
                      ? '项目已归档，可取消归档后编辑。'
                      : '这里还没有未完成提示词。'}
                  </p>
                )}
                <button
                  className="cloud-group-toggle"
                  aria-expanded={showCompleted}
                  onClick={() => setCompleted(!showCompleted)}
                >
                  已完成 · {completedRows.length} {showCompleted ? '收起' : '展开'}
                </button>
                {showCompleted && <ul>{completedRows.map(renderRow)}</ul>}
                <button
                  className="cloud-group-toggle"
                  aria-expanded={showTrash}
                  onClick={() => setTrash(!showTrash)}
                >
                  已删除 · {trashRows.length} {showTrash ? '收起' : '展开'}
                </button>
                {showTrash && <ul>{trashRows.map(renderRow)}</ul>}
              </div>
            </>
          )}
          {!project && <p className="cloud-empty">从项目栏选择项目，或创建一个新项目。</p>}
        </section>
        <main className="cloud-editor" aria-label="提示词编辑区">
          {editor.draft ? (
            <>
              <div className="cloud-editor-heading">
                <input
                  aria-label="提示词标题"
                  value={editor.draft.title}
                  disabled={readonly}
                  maxLength={160}
                  onChange={(e) => editor.edit({ title: e.target.value })}
                />
                <button
                  onClick={() =>
                    void copyText(editor.draft?.body ?? '').then((result) =>
                      setMessage(result.ok ? '已复制提示词。' : '复制失败，请手动选择正文复制。'),
                    )
                  }
                >
                  <Copy size={15} /> 复制
                </button>
                <button aria-pressed={preview} onClick={() => setPreview(!preview)}>
                  {preview ? '编辑' : '预览'}
                </button>
                <button
                  className="cloud-editor-tools-toggle"
                  aria-label="提示词操作"
                  aria-expanded={editorToolsOpen}
                  aria-controls="cloud-editor-tools"
                  onClick={() => setEditorToolsOpen(!editorToolsOpen)}
                >
                  <SlidersHorizontal size={18} />
                </button>
              </div>
              <div
                id="cloud-editor-tools"
                className={`cloud-editor-meta ${editorToolsOpen ? 'is-open' : ''}`}
              >
                <span className={`cloud-status-text status-${editor.draft.status}`}>
                  {cloudLabels[editor.draft.status]}
                </span>
                <button
                  disabled={busy || readonly}
                  onClick={() =>
                    void run(async () => {
                      await editor.save({
                        status: editor.draft?.status === 'ready' ? 'draft' : 'ready',
                      });
                    })
                  }
                >
                  {editor.draft.status === 'ready' ? '转为草稿' : '设为待提交'}
                </button>
                <label>
                  优先级
                  <select
                    aria-label="优先级"
                    value={editor.draft.priority}
                    disabled={busy || readonly}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value === 'low' || value === 'normal' || value === 'high')
                        void run(async () => {
                          await editor.save({ priority: value });
                        });
                    }}
                  >
                    <option value="low">低</option>
                    <option value="normal">普通</option>
                    <option value="high">高</option>
                  </select>
                </label>
                <button
                  disabled={busy || readonly}
                  onClick={() =>
                    void run(async () => {
                      await editor.save({ checkpoint: true });
                    })
                  }
                >
                  保存版本
                </button>
                <button
                  disabled={busy || readonly}
                  onClick={() =>
                    void run(async () => {
                      await editor.flush();
                    })
                  }
                >
                  保存草稿
                </button>
              </div>
              <div className="cloud-save-state" role="status" aria-live="polite">
                {editor.saveState}
                <button
                  disabled={busy}
                  onClick={() => {
                    if (
                      window.confirm(
                        '重新加载服务器内容？当前草稿将先复制到剪贴板，请保留这份副本。',
                      )
                    )
                      void run(async () => {
                        const current = editor.latest();
                        if (!current) return;
                        const copied = await copyText(current.body);
                        if (!copied.ok) {
                          setMessage('无法复制草稿，请手动复制保留后重试。');
                          return;
                        }
                        const fresh = await cloudClient.prompt(current.id);
                        editor.select(fresh);
                        setPrompts((items) => items.map((p) => (p.id === fresh.id ? fresh : p)));
                      });
                  }}
                >
                  重新加载
                </button>
              </div>
              <div className="cloud-composer">
                {preview ? (
                  <MarkdownPreview body={editor.draft.body} />
                ) : (
                  <MarkdownEditor
                    key={editor.draft.id}
                    body={editor.draft.body}
                    readonly={readonly}
                    onChange={(body) => editor.edit({ body })}
                    fontSize={fontSize}
                    onFontSizeChange={setFontSize}
                    onSplitSelection={(_selected, from, to) =>
                      void run(async () => {
                        if (!(await editor.flush())) return;
                        const latest = editor.latest();
                        if (!latest || !projectId) return;
                        const split = await cloudClient.split(latest.id, latest.revision, from, to);
                        const items = await refreshPrompts(projectId),
                          next = items.find((item) => item.id === split.id);
                        if (next) editor.select(next);
                      })
                    }
                  />
                )}
              </div>
              <footer className="cloud-editor-footer">
                <span>{editor.draft.body.length.toLocaleString()} 字</span>
                <details
                  onToggle={(e) => {
                    if (e.currentTarget.open && editor.draft)
                      void run(async () =>
                        setVersions(await cloudClient.versions(editor.draft!.id)),
                      );
                  }}
                >
                  <summary>历史版本</summary>
                  <div className="cloud-version-panel">
                    {versions.length ? (
                      versions.map((v) => (
                        <div key={v.id}>
                          <span>
                            v{v.number} · {new Date(v.createdAt).toLocaleString()}
                          </span>
                          <button
                            disabled={busy || readonly}
                            onClick={() => {
                              if (window.confirm('恢复这个版本？当前草稿会先保留为新版本。'))
                                void run(async () => {
                                  if (await editor.flush()) {
                                    await editor.save({ restoreVersion: v.number });
                                    const latest = editor.latest();
                                    if (latest) setVersions(await cloudClient.versions(latest.id));
                                  }
                                });
                            }}
                          >
                            恢复
                          </button>
                          <details>
                            <summary>查看正文</summary>
                            <pre>{v.body}</pre>
                          </details>
                        </div>
                      ))
                    ) : (
                      <p>暂无历史版本</p>
                    )}
                  </div>
                </details>
                <button
                  disabled={busy || Boolean(project?.archived || project?.deletedAt)}
                  onClick={() => {
                    const deleted = Boolean(editor.draft?.deletedAt);
                    if (
                      window.confirm(
                        deleted ? '恢复提示词？' : '删除提示词？可从列表的已删除分组恢复。',
                      )
                    )
                      void run(async () => {
                        await editor.save({ deleted: !deleted });
                      });
                  }}
                >
                  {editor.draft.deletedAt ? '恢复' : '删除'}
                </button>
              </footer>
            </>
          ) : (
            <div className="cloud-editor-empty">
              <Cloud size={32} />
              <h2>给想法一个空间</h2>
              <p>新建提示词后直接开始编辑。Enter 换行，复制后由你提交给模型。</p>
              {project && (
                <button
                  className="primary-button"
                  disabled={busy || Boolean(project.archived || project.deletedAt)}
                  onClick={() => void run(createPrompt)}
                >
                  新建提示词
                </button>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
