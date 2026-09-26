import { useEffect, useRef, useState } from 'react';
import {
  matchesSearch,
  parseSearchText,
  type SearchDocument,
  type SearchFilters,
} from '../domain/search';
import { statusLabels, statusSchema, type PromptStatus } from '../domain/schemas';
import type { WorkspaceView } from '../services/workspace/runtime';
import { workspaceController as api } from '../services/workspace/controller';

export function PromptQueue({
  view,
  busy,
  onOpen,
  onStatus,
  onMessage,
  onView,
}: {
  view: WorkspaceView;
  busy: boolean;
  onOpen: (projectId: string, id: string) => Promise<void>;
  onStatus: (projectId: string, id: string, status: PromptStatus) => Promise<void>;
  onMessage: (message: string) => void;
  onView: () => void;
}) {
  const [filters, setFilters] = useState<SearchFilters>({
    query: '',
    projectId: '',
    status: '',
    target: '',
    tag: '',
    includeArchived: false,
  });
  const [documents, setDocuments] = useState<SearchDocument[] | null>(null);
  const [progress, setProgress] = useState<{
    completed: number;
    total: number;
    running: boolean;
  } | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  function rebuild() {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setDocuments(null);
    setProgress({ completed: 0, total: view.prompts.length, running: true });
    void api
      .buildSearchIndex(controller.signal, (docs, completed, total) => {
        if (!controller.signal.aborted) {
          setDocuments(docs);
          setProgress({ completed, total, running: true });
        }
      })
      .then((result) => {
        if (abort.current !== controller || controller.signal.aborted) return;
        if (result.ok) {
          setDocuments(result.value);
          setProgress({
            completed: result.value.length,
            total: result.value.length,
            running: false,
          });
          onView();
        } else {
          setProgress((p) => (p ? { ...p, running: false } : null));
          if (result.error.code !== 'CANCELLED') onMessage(result.error.message);
        }
      });
  }
  const baseline: SearchDocument[] = view.prompts.flatMap((meta) => {
    const project = view.projects.find((p) => p.id === meta.projectId);
    return project ? [{ meta, project, body: '', unavailable: false }] : [];
  });
  const indexByKey = new Map(
    documents?.map((doc) => [`${doc.meta.projectId}:${doc.meta.id}`, doc]) ?? [],
  );
  const merged = documents
    ? baseline.map((entry) => {
        const indexed = indexByKey.get(`${entry.meta.projectId}:${entry.meta.id}`);
        return indexed ? { ...indexed, meta: entry.meta, project: entry.project } : entry;
      })
    : baseline;
  const parsed = parseSearchText(filters.query);
  const project = parsed.filters.projectName
    ? view.projects.find(
        (p) =>
          p.name.toLowerCase() === parsed.filters.projectName?.toLowerCase() ||
          p.id === parsed.filters.projectName,
      )
    : undefined;
  const effective = {
    ...filters,
    ...parsed.filters,
    query: parsed.query,
    projectId: project?.id ?? filters.projectId,
  };
  const matches =
    parsed.unknown.length || (parsed.filters.projectName && !project)
      ? []
      : merged
          .filter((doc) => matchesSearch(doc, effective))
          .sort(
            (a, b) => a.project.name.localeCompare(b.project.name) || a.meta.order - b.meta.order,
          );
  return (
    <section className="queue-section">
      <div className="section-heading">
        <h2>Prompt 队列与搜索</h2>
        <button disabled={busy || !!progress?.running} onClick={rebuild}>
          {documents ? '刷新全文索引' : '建立全文索引'}
        </button>
      </div>
      <div className="queue-filters">
        <input
          id="global-search"
          aria-label="全局搜索"
          placeholder="关键词，或 status:ready model:Codex tag:标签"
          value={filters.query}
          onChange={(e) => setFilters({ ...filters, query: e.target.value })}
        />
        <select
          aria-label="队列项目"
          value={filters.projectId}
          onChange={(e) => setFilters({ ...filters, projectId: e.target.value })}
        >
          <option value="">全部项目</option>
          {view.projects
            .filter((p) => !p.deletedAt)
            .map((p) => (
              <option value={p.id} key={p.id}>
                {p.name}
              </option>
            ))}
        </select>
        <select
          aria-label="队列状态"
          value={filters.status}
          onChange={(e) =>
            setFilters({
              ...filters,
              status: e.target.value ? statusSchema.parse(e.target.value) : '',
            })
          }
        >
          <option value="">全部状态</option>
          {statusSchema.options.map((s) => (
            <option value={s} key={s}>
              {statusLabels[s]}
            </option>
          ))}
        </select>
        <input
          aria-label="队列模型"
          placeholder="目标模型"
          value={filters.target}
          onChange={(e) => setFilters({ ...filters, target: e.target.value })}
        />
        <input
          aria-label="队列标签"
          placeholder="标签"
          value={filters.tag}
          onChange={(e) => setFilters({ ...filters, tag: e.target.value })}
        />
        <label>
          <input
            type="checkbox"
            checked={filters.includeArchived}
            onChange={(e) => setFilters({ ...filters, includeArchived: e.target.checked })}
          />
          包含归档
        </label>
      </div>
      {parsed.unknown.length > 0 && <p role="alert">无法识别筛选：{parsed.unknown.join('、')}</p>}
      {parsed.filters.projectName && !project && <p role="alert">未找到筛选中的项目。</p>}
      <p className="muted" aria-live="polite">
        {!progress
          ? '当前搜索标题、项目、标签；建立索引后可搜索正文。'
          : `全文索引 ${progress.completed}/${progress.total}${progress.running ? ' · 建立中，结果逐步更新' : progress.completed === progress.total ? ' · 已完成' : ' · 已停止，当前结果不完整'}`}
      </p>
      {progress?.running && (
        <button
          onClick={() => {
            abort.current?.abort();
            setProgress({ ...progress, running: false });
          }}
        >
          取消索引
        </button>
      )}
      {merged.some((doc) => doc.unavailable) && (
        <p className="notice">部分正文无法读取，这些条目仅参与标题搜索，原文件未改动。</p>
      )}
      <div className="queue-results">
        {matches.map(({ meta, project, body }) => (
          <div className="queue-row" key={`${meta.projectId}:${meta.id}`}>
            <button
              disabled={busy || !!progress?.running}
              onClick={() => void onOpen(meta.projectId, meta.id)}
            >
              <small>
                {project.name} / {meta.id} · {meta.target}
              </small>
              <strong>{meta.title}</strong>
              {filters.query && body && <span>{body.slice(0, 100)}</span>}
            </button>
            <label className="todo-toggle queue-todo">
              <input
                type="checkbox"
                aria-label={`${meta.id} 标记已完成`}
                checked={meta.status === 'completed'}
                disabled={
                  busy || !!progress?.running || !view.writable || project.status === 'archived'
                }
                onChange={(event) => {
                  const previous = meta.statusHistory.at(-1)?.from;
                  const next = event.target.checked
                    ? 'completed'
                    : previous && previous !== 'completed'
                      ? previous
                      : 'draft';
                  void onStatus(meta.projectId, meta.id, statusSchema.parse(next));
                }}
              />
              <span className={`status-label ${meta.status}`}>{statusLabels[meta.status]}</span>
            </label>
          </div>
        ))}
        {!matches.length && <p className="muted">没有匹配的 Prompt。</p>}
      </div>
    </section>
  );
}
