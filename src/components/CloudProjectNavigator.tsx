import { useRef, useState } from 'react';
import { Folder, GripVertical, Plus } from 'lucide-react';
import type { CloudProject } from '../domain/cloud';

export const projectColors = {
  slate: '#64748b',
  green: '#245b43',
  teal: '#0f766e',
  blue: '#2563eb',
  indigo: '#4f46e5',
  violet: '#7c3aed',
  pink: '#db2777',
  amber: '#d97706',
  red: '#dc2626',
} as const;
export type ProjectColor = keyof typeof projectColors;

type NavigatorProps = {
  projects: CloudProject[];
  selectedId: string | null;
  busy: boolean;
  onOpen: (id: string) => void;
  onCreate: (name: string) => void;
  onReorder: (id: string, targetId: string) => void;
};

function orderProjects(items: CloudProject[]) {
  return [...items].sort(
    (a, b) => a.sortOrder - b.sortOrder || b.createdAt.localeCompare(a.createdAt),
  );
}

export function CloudProjectNavigator({
  projects,
  selectedId,
  busy,
  onOpen,
  onCreate,
  onReorder,
}: NavigatorProps) {
  const [view, setView] = useState<'list' | 'folder'>('list');
  const [newProject, setNewProject] = useState(false);
  const [newName, setNewName] = useState('');
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const dragId = useRef<string | null>(null);

  const active = orderProjects(projects.filter((project) => !project.deletedAt));
  const deleted = projects.filter((project) => project.deletedAt);

  function beginDrag(id: string, event: React.PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    dragId.current = id;
    setDragging(id);
    setOver(null);
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function dragMove(event: React.PointerEvent<HTMLButtonElement>) {
    if (!dragId.current) return;
    const under = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>('[data-project-id]')?.dataset.projectId;
    setOver(under && under !== dragId.current ? under : null);
  }
  function endDrag(event: React.PointerEvent<HTMLButtonElement>) {
    const id = dragId.current;
    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>('[data-project-id]')?.dataset.projectId;
    dragId.current = null;
    setDragging(null);
    setOver(null);
    if (id && target && target !== id) onReorder(id, target);
  }
  function cancelDrag() {
    dragId.current = null;
    setDragging(null);
    setOver(null);
  }
  function keyReorder(id: string, event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'Escape') {
      cancelDrag();
      return;
    }
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown' && event.key !== 'ArrowLeft') {
      if (event.key !== 'ArrowRight') return;
    }
    event.preventDefault();
    const plain = event.key === 'ArrowUp' || event.key === 'ArrowLeft';
    const index = active.findIndex((project) => project.id === id),
      target = active[index + (plain ? -1 : 1)];
    if (target) onReorder(id, target.id);
  }

  const rowClass = (id: string) =>
    `${id === selectedId ? 'selected' : ''} ${dragging === id ? 'dragging' : ''} ${
      over === id ? 'drop-target' : ''
    }`;
  const handle = (project: CloudProject) => (
    <button
      className="cloud-drag"
      title="按住拖动排序，或用方向键调整"
      aria-label={`拖动排序项目：${project.name}，方向键调整顺序`}
      disabled={busy}
      onPointerDown={(event) => beginDrag(project.id, event)}
      onPointerMove={dragMove}
      onPointerUp={endDrag}
      onPointerCancel={cancelDrag}
      onKeyDown={(event) => keyReorder(project.id, event)}
    >
      <GripVertical size={16} />
    </button>
  );

  return (
    <>
      <div className="cloud-section-heading">
        <h2>我的项目</h2>
        <button aria-label="新建项目" disabled={busy} onClick={() => setNewProject(!newProject)}>
          <Plus size={18} />
        </button>
      </div>
      <div className="cloud-view-toggle" role="group" aria-label="项目视图">
        <button
          className={view === 'list' ? 'selected' : ''}
          aria-label="列表视图"
          aria-pressed={view === 'list'}
          onClick={() => setView('list')}
        >
          列表
        </button>
        <button
          className={view === 'folder' ? 'selected' : ''}
          aria-label="文件夹视图"
          aria-pressed={view === 'folder'}
          onClick={() => setView('folder')}
        >
          文件夹
        </button>
      </div>
      {dragging && (
        <p className="cloud-drag-hint" role="status">
          拖到目标项目上后松开；按 Esc 取消。
        </p>
      )}
      {newProject && (
        <form
          className="cloud-new-project"
          onSubmit={(event) => {
            event.preventDefault();
            onCreate(newName);
            setNewProject(false);
            setNewName('');
          }}
        >
          <input
            aria-label="项目名称"
            placeholder="项目名称"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            required
            maxLength={120}
          />
          <button disabled={busy} className="primary-button">
            创建
          </button>
        </form>
      )}
      {view === 'list' ? (
        <ul className="cloud-project-list">
          {active.map((project) => (
            <li
              key={project.id}
              data-project-id={project.id}
              className={`cloud-project-row ${rowClass(project.id)}`}
            >
              {handle(project)}
              <span
                className="cloud-color-dot"
                style={{ background: projectColors[project.color] }}
              />
              <button
                className={`cloud-project-open ${project.id === selectedId ? 'selected' : ''}`}
                disabled={busy}
                onClick={() => onOpen(project.id)}
              >
                <span>{project.name}</span>
                {Boolean(project.archived) && <small>归档</small>}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="cloud-project-grid">
          {active.map((project) => (
            <li
              key={project.id}
              data-project-id={project.id}
              className={`cloud-folder-card ${rowClass(project.id)}`}
              style={{ '--folder-color': projectColors[project.color] } as React.CSSProperties}
            >
              {handle(project)}
              <button
                className={`cloud-folder-open ${project.id === selectedId ? 'selected' : ''}`}
                disabled={busy}
                onClick={() => onOpen(project.id)}
              >
                <Folder size={24} />
                <span>{project.name}</span>
                {Boolean(project.archived) && <small>归档</small>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {!active.length && <p className="cloud-empty">创建第一个项目，开始记录想法。</p>}
      <details>
        <summary>已删除项目</summary>
        <ul>
          {deleted.map((project) => (
            <li key={project.id}>
              <button disabled={busy} onClick={() => onOpen(project.id)}>
                {project.name}
              </button>
            </li>
          ))}
        </ul>
      </details>
      <p className="cloud-storage-note">数据保存到服务器。换台设备登录即可继续。</p>
    </>
  );
}
