import type { z } from 'zod';
import { promptPath, settingsPath, versionFile, workspacePath } from '../../domain/paths';
import {
  baseDocument,
  json,
  newId,
  parseDocument,
  pendingSchema,
  projectSchema,
  promptSchema,
  scratchpadSchema,
  settingsSchema,
  statusSchema,
  workspaceSchema,
  type PendingManifest,
  type Project,
  type PromptMeta,
  type PromptStatus,
  type VersionMeta,
  type Workspace,
  type WorkspaceSettings,
} from '../../domain/schemas';
import {
  checkpointRequired,
  nextPromptId,
  ordered,
  validateTransition,
} from '../../domain/policies';
import { AppFault, attempt } from '../../types/errors';
import type { FileSystemPort } from '../../types/filesystem';
import { sha256 } from '../../utils/hash';
import { Journal, type Change } from '../transactions/journal';
import {
  captureSnapshot,
  copySnapshot,
  listWorkspaceFiles,
  type WorkspaceSnapshot,
} from './snapshot';
import { isBusinessPath } from '../../domain/paths';
import { initialPrompt } from '../../domain/prompt-factory';
import { invalidPromptRelations } from '../../domain/relations';

export interface WorkspaceView {
  sessionId: string;
  workspace: Workspace;
  settings: WorkspaceSettings;
  projects: Project[];
  prompts: PromptMeta[];
  scratchpads: ScratchMeta[];
  issues: string[];
  pending: PendingManifest[];
  writable: boolean;
}
export interface OpenPrompt {
  meta: PromptMeta;
  body: string;
  baseContentHash: string;
}
export type ScratchMeta = z.infer<typeof scratchpadSchema>;
export interface OpenScratch {
  meta: ScratchMeta;
  body: string;
  baseContentHash: string;
}

export class WorkspaceRuntime {
  readonly sessionId = newId('session');
  private readonly journal: Journal;
  private readonly originals = new Map<string, string>();
  private projects: Project[] = [];
  private prompts: PromptMeta[] = [];
  private scratchpads: ScratchMeta[] = [];
  private issues: string[] = [];
  private pending: PendingManifest[] = [];
  private closed = false;
  workspace: Workspace;
  private settings: WorkspaceSettings;
  writable = true;

  constructor(
    private readonly fs: FileSystemPort,
    workspace: Workspace,
  ) {
    this.workspace = workspace;
    this.journal = new Journal(fs, workspace.id);
    this.settings = settingsSchema.parse({
      ...baseDocument(newId('op')),
      workspaceId: workspace.id,
      defaultTarget: 'Codex',
      autosaveEnabled: true,
      autosaveDelayMs: 800,
    });
  }
  static async preflight(fs: FileSystemPort): Promise<{ nonempty: boolean; existing: boolean }> {
    if (await fs.read(workspacePath)) return { nonempty: true, existing: true };
    const entries = await fs.list([]);
    for (const entry of entries.filter((e) =>
      ['.promptdesk', 'projects', 'scratchpad'].includes(e.name),
    )) {
      if (entry.kind !== 'directory') throw new AppFault('CONFLICT');
      const children = await fs.list([entry.name]);
      if (
        entry.name === '.promptdesk' &&
        children.length === 1 &&
        children[0]?.name === 'pending' &&
        children[0].kind === 'directory' &&
        (await fs.list(['.promptdesk', 'pending'])).length === 0
      )
        continue;
      if (children.length) throw new AppFault('CONFLICT');
    }
    return { nonempty: entries.length > 0, existing: false };
  }
  static async create(fs: FileSystemPort, name: string): Promise<WorkspaceRuntime> {
    const plan = await this.preflight(fs);
    if (plan.existing) throw new AppFault('CONFLICT');
    const operationId = newId('op');
    const workspace = workspaceSchema.parse({
      ...baseDocument(operationId),
      id: newId('workspace'),
      name,
      description: '',
    });
    const runtime = new WorkspaceRuntime(fs, workspace);
    runtime.settings = settingsSchema.parse({
      ...baseDocument(operationId),
      workspaceId: workspace.id,
      defaultTarget: 'Codex',
      autosaveEnabled: true,
      autosaveDelayMs: 800,
    });
    await runtime.journal.commit(
      [
        { path: settingsPath, before: null, after: json(runtime.settings) },
        { path: workspacePath, before: null, after: json(workspace) },
      ],
      'initialize',
      operationId,
    );
    await fs.ensureDirectory(['projects']);
    await fs.ensureDirectory(['scratchpad']);
    await runtime.load();
    return runtime;
  }
  static async open(fs: FileSystemPort): Promise<WorkspaceRuntime> {
    const file = await fs.read(workspacePath);
    let workspace: Workspace;
    if (file) workspace = parseDocument(workspaceSchema, file.text);
    else {
      // A valid initialization journal is the only permitted way to open an incomplete root.
      const entries = await fs.list(['.promptdesk', 'pending']);
      if (entries.length !== 1) throw new AppFault('NOT_FOUND');
      const entry = entries[0]!;
      const manifest = await fs.read(['.promptdesk', 'pending', entry.name, 'manifest.json']);
      if (!manifest) throw new AppFault('RECOVERY_REQUIRED');
      const record = parseDocument(pendingSchema, manifest.text);
      const rootEntry = record.entries.find(
        (e) => e.targetPath.join('/') === workspacePath.join('/'),
      );
      if (record.kind !== 'initialize' || !rootEntry) throw new AppFault('INVALID_SCHEMA');
      const planned = await fs.read([
        '.promptdesk',
        'pending',
        entry.name,
        ...rootEntry.after.snapshotPath,
      ]);
      if (!planned || planned.hash !== rootEntry.after.sha256) throw new AppFault('INVALID_SCHEMA');
      workspace = parseDocument(workspaceSchema, planned.text);
      if (workspace.id !== record.workspaceId) throw new AppFault('INVALID_SCHEMA');
    }
    return new WorkspaceRuntime(fs, workspace);
  }
  view(): WorkspaceView {
    return {
      sessionId: this.sessionId,
      workspace: this.workspace,
      settings: this.settings,
      projects: [...this.projects],
      prompts: [...this.prompts],
      scratchpads: [...this.scratchpads],
      issues: [...this.issues],
      pending: [...this.pending],
      writable: this.writable,
    };
  }
  execute<T>(action: () => Promise<T>) {
    return attempt(() =>
      this.journal.exclusive(async () => {
        if (this.closed) throw new AppFault('BUSY');
        return action();
      }),
    );
  }
  private assertWritable(): void {
    if (!this.writable) throw new AppFault('BUSY');
    if (this.journal.blocked || this.pending.length) throw new AppFault('RECOVERY_REQUIRED');
  }
  private async tracked<T>(schema: z.ZodType<T>, path: string[]): Promise<T> {
    const file = await this.fs.read(path);
    if (!file) throw new AppFault('NOT_FOUND');
    const data = parseDocument(schema, file.text);
    this.originals.set(path.join('/'), file.text);
    return data;
  }
  private change(path: string[], after: string): Change {
    return { path, before: this.originals.get(path.join('/')) ?? null, after };
  }
  private async commit(
    changes: Change[],
    kind: PendingManifest['kind'],
    operationId: string,
  ): Promise<void> {
    for (const path of [workspacePath, settingsPath]) {
      const expected = this.originals.get(path.join('/'));
      if (!expected || (await this.fs.read(path))?.hash !== (await sha256(expected)))
        throw new AppFault('CONFLICT');
    }
    const parentPaths = new Set(
      changes
        .filter((change) => change.path[0] === 'projects' && change.path[2] === 'prompts')
        .map((change) => `projects/${change.path[1]}/project.json`),
    );
    for (const key of parentPaths) {
      const expected = this.originals.get(key);
      if (!expected || (await this.fs.read(key.split('/')))?.hash !== (await sha256(expected)))
        throw new AppFault('CONFLICT');
    }
    await this.journal.commit(changes, kind, operationId);
    // A verified commit can still leave its journal behind if cleanup fails.
    // Surface that record in the live session so recovery is available without reopening.
    this.pending = await this.journal.inspect();
    for (const change of changes) this.originals.set(change.path.join('/'), change.after);
  }
  async load(): Promise<WorkspaceView> {
    this.pending = await this.journal.inspect();
    if (this.pending.length) return this.view();
    this.originals.clear();
    this.projects = [];
    this.prompts = [];
    this.scratchpads = [];
    this.issues = [];
    const workspace = await this.tracked(workspaceSchema, workspacePath);
    if (workspace.id !== this.workspace.id) throw new AppFault('CONFLICT');
    this.workspace = workspace;
    const settings = await this.fs.read(settingsPath);
    if (settings) {
      try {
        this.settings = await this.tracked(settingsSchema, settingsPath);
        if (this.settings.workspaceId !== this.workspace.id) throw new AppFault('INVALID_SCHEMA');
      } catch {
        this.issues.push('.promptdesk/settings.json');
        this.writable = false;
      }
    } else {
      this.issues.push('.promptdesk/settings.json');
      this.writable = false;
    }
    for (const dir of await this.fs.list(['projects'])) {
      if (dir.kind !== 'directory') continue;
      const projectFile = ['projects', dir.name, 'project.json'];
      try {
        const project = await this.tracked(projectSchema, projectFile);
        if (project.slug !== dir.name || this.projects.some((p) => p.id === project.id))
          throw new AppFault('INVALID_SCHEMA');
        this.projects.push(project);
        for (const promptDir of await this.fs.list(['projects', dir.name, 'prompts'])) {
          if (promptDir.kind !== 'directory') continue;
          const metaFile = [...promptPath(dir.name, promptDir.name), 'meta.json'];
          try {
            const meta = await this.tracked(promptSchema, metaFile);
            if (meta.id !== promptDir.name || meta.projectId !== project.id)
              throw new AppFault('INVALID_SCHEMA');
            this.prompts.push(meta);
          } catch {
            this.issues.push(metaFile.join('/'));
          }
        }
      } catch {
        this.issues.push(projectFile.join('/'));
      }
    }
    const incomplete = new Set(
      this.projects
        .filter((project) =>
          this.issues.some((issue) => issue.startsWith(`projects/${project.slug}/`)),
        )
        .map((project) => project.id),
    );
    const invalid = invalidPromptRelations(this.prompts, incomplete);
    for (const prompt of this.prompts)
      if (invalid.has(`${prompt.projectId}:${prompt.id}`))
        this.issues.push(
          [...promptPath(this.project(prompt.projectId).slug, prompt.id), 'meta.json'].join('/'),
        );
    for (const dir of await this.fs.list(['scratchpad'])) {
      if (dir.kind !== 'directory') continue;
      const path = ['scratchpad', dir.name, 'meta.json'];
      try {
        const meta = await this.tracked(scratchpadSchema, path);
        if (meta.id !== dir.name) throw new AppFault('INVALID_SCHEMA');
        this.scratchpads.push(meta);
      } catch {
        this.issues.push(path.join('/'));
      }
    }
    return this.view();
  }
  async refreshPending(): Promise<WorkspaceView> {
    // Inspect recovery records without accepting external changes as new write baselines.
    this.pending = await this.journal.inspect();
    return this.view();
  }
  async externalChanges(ref?: { projectId: string; id: string }): Promise<string[]> {
    if (this.journal.blocked || this.pending.length) return [];
    const changed: string[] = [];
    const paths = [workspacePath, settingsPath];
    if (ref) {
      const project = this.project(ref.projectId);
      paths.push(
        ['projects', project.slug, 'project.json'],
        [...promptPath(project.slug, ref.id), 'meta.json'],
        [...promptPath(project.slug, ref.id), 'current.md'],
      );
    }
    for (const path of paths) {
      const key = path.join('/'),
        text = this.originals.get(key);
      if (text !== undefined && (await this.fs.read(path))?.hash !== (await sha256(text)))
        changed.push(key);
    }
    return changed;
  }
  async recover(operationId: string, choice: 'finish' | 'rollback'): Promise<WorkspaceView> {
    if (!this.writable) throw new AppFault('BUSY');
    const record = this.pending.find((p) => p.operationId === operationId);
    if (!record) throw new AppFault('NOT_FOUND');
    await this.journal.recover(record, choice);
    if (!(await this.fs.read(workspacePath))) {
      this.closed = true;
      throw new AppFault('NOT_FOUND');
    }
    return this.load();
  }
  private project(id: string): Project {
    const project = this.projects.find((p) => p.id === id);
    if (!project) throw new AppFault('NOT_FOUND');
    return project;
  }
  private meta(projectId: string, promptId: string): PromptMeta {
    const meta = this.prompts.find((p) => p.projectId === projectId && p.id === promptId);
    if (!meta) throw new AppFault('NOT_FOUND');
    return meta;
  }
  private editable(projectId: string, promptId?: string): void {
    this.assertWritable();
    const project = this.project(projectId);
    if (this.issues.some((issue) => issue.startsWith(`projects/${project.slug}/`)))
      throw new AppFault('INVALID_SCHEMA');
    if (project.deletedAt || project.status === 'archived') throw new AppFault('BUSY');
    if (promptId) {
      const meta = this.meta(projectId, promptId);
      if (meta.deletedAt || meta.status === 'archived') throw new AppFault('BUSY');
    }
  }
  async createProject(name: string): Promise<WorkspaceView> {
    this.assertWritable();
    const operationId = newId('op');
    const slug = `project-${crypto.randomUUID().slice(0, 8)}`;
    const project = projectSchema.parse({
      ...baseDocument(operationId),
      id: newId('project'),
      name,
      slug,
      description: '',
      status: 'active',
      tags: [],
      deletedAt: null,
    });
    await this.commit(
      [this.change(['projects', slug, 'project.json'], json(project))],
      'project',
      operationId,
    );
    this.projects.push(project);
    return this.view();
  }
  async updateProject(
    id: string,
    patch: {
      name?: string;
      description?: string;
      tags?: string[];
      status?: 'active' | 'archived';
      deletedAt?: string | null;
    },
  ): Promise<WorkspaceView> {
    this.assertWritable();
    const current = this.project(id),
      operationId = newId('op');
    const allowed = {
      ...(patch.name === undefined ? {} : { name: patch.name }),
      ...(patch.description === undefined ? {} : { description: patch.description }),
      ...(patch.tags === undefined ? {} : { tags: patch.tags }),
      ...(patch.status === undefined ? {} : { status: patch.status }),
      ...(patch.deletedAt === undefined ? {} : { deletedAt: patch.deletedAt }),
    };
    if (
      (current.status === 'archived' || current.deletedAt) &&
      (patch.name !== undefined || patch.description !== undefined || patch.tags !== undefined)
    )
      throw new AppFault('BUSY');
    const next = projectSchema.parse({
      ...current,
      ...allowed,
      revision: current.revision + 1,
      lastOperationId: operationId,
      updatedAt: new Date().toISOString(),
    });
    await this.commit(
      [this.change(['projects', current.slug, 'project.json'], json(next))],
      'project',
      operationId,
    );
    this.projects = this.projects.map((p) => (p.id === id ? next : p));
    return this.view();
  }
  async createPrompt(projectId: string, title = '未命名提示词'): Promise<PromptMeta> {
    return this.newPrompt(projectId, title);
  }
  async createNext(projectId: string, parentPromptId: string): Promise<PromptMeta> {
    this.editable(projectId, parentPromptId);
    return this.newPrompt(projectId, '未命名提示词', parentPromptId);
  }
  private async newPrompt(
    projectId: string,
    title: string,
    parentPromptId?: string,
  ): Promise<PromptMeta> {
    this.editable(projectId);
    const project = this.project(projectId),
      operationId = newId('op');
    const id = nextPromptId(
      (await this.fs.list(['projects', project.slug, 'prompts'])).map((e) => e.name),
    );
    const active = ordered(this.prompts.filter((p) => p.projectId === projectId && !p.deletedAt));
    const order = parentPromptId
      ? this.meta(projectId, parentPromptId).order + 1
      : active.length + 1;
    const adjusted = parentPromptId
      ? active
          .filter((p) => p.order >= order)
          .map((p) =>
            promptSchema.parse({
              ...p,
              order: p.order + 1,
              revision: p.revision + 1,
              lastOperationId: operationId,
              updatedAt: new Date().toISOString(),
            }),
          )
      : [];
    const meta = initialPrompt({
      operationId,
      eventId: newId('event'),
      at: new Date().toISOString(),
      id,
      projectId,
      title,
      target: this.settings.defaultTarget,
      order,
      parentPromptId: parentPromptId ?? null,
    });
    const root = promptPath(project.slug, id);
    await this.commit(
      [
        ...adjusted.map((p) =>
          this.change([...promptPath(project.slug, p.id), 'meta.json'], json(p)),
        ),
        this.change([...root, 'current.md'], ''),
        this.change([...root, 'meta.json'], json(meta)),
      ],
      'prompt',
      operationId,
    );
    this.prompts.push(meta);
    for (const item of adjusted) this.replaceMeta(item);
    return meta;
  }
  async reorder(projectId: string, ids: string[]): Promise<WorkspaceView> {
    this.editable(projectId);
    const active = this.prompts.filter((p) => p.projectId === projectId && !p.deletedAt);
    if (
      new Set(ids).size !== active.length ||
      ids.length !== active.length ||
      active.some((p) => !ids.includes(p.id))
    )
      throw new AppFault('INVALID_SCHEMA');
    const operationId = newId('op'),
      at = new Date().toISOString();
    const adjusted = ids.map((id, i) =>
      promptSchema.parse({
        ...this.meta(projectId, id),
        order: i + 1,
        revision: this.meta(projectId, id).revision + 1,
        lastOperationId: operationId,
        updatedAt: at,
      }),
    );
    await this.commit(
      adjusted.map((meta) =>
        this.change(
          [...promptPath(this.project(projectId).slug, meta.id), 'meta.json'],
          json(meta),
        ),
      ),
      'reorder',
      operationId,
    );
    for (const item of adjusted) this.replaceMeta(item);
    return this.view();
  }
  async openPrompt(projectId: string, promptId: string): Promise<OpenPrompt> {
    if (this.pending.length || this.journal.blocked) throw new AppFault('RECOVERY_REQUIRED');
    const project = this.project(projectId),
      root = promptPath(project.slug, promptId);
    const meta = await this.tracked(promptSchema, [...root, 'meta.json']);
    if (meta.projectId !== projectId || meta.id !== promptId) throw new AppFault('INVALID_SCHEMA');
    const current = await this.fs.read([...root, 'current.md']);
    if (!current) throw new AppFault('NOT_FOUND');
    this.originals.set([...root, 'current.md'].join('/'), current.text);
    this.prompts = this.prompts.map((p) =>
      p.id === promptId && p.projectId === projectId ? meta : p,
    );
    return { meta, body: current.text, baseContentHash: current.hash };
  }
  async saveDraft(projectId: string, promptId: string, body: string): Promise<OpenPrompt> {
    this.editable(projectId, promptId);
    const current = this.meta(projectId, promptId),
      project = this.project(projectId),
      operationId = newId('op');
    const root = promptPath(project.slug, promptId);
    if (!this.originals.has([...root, 'current.md'].join('/'))) throw new AppFault('CONFLICT');
    const next = promptSchema.parse({
      ...current,
      revision: current.revision + 1,
      lastOperationId: operationId,
      updatedAt: new Date().toISOString(),
    });
    await this.commit(
      [this.change([...root, 'current.md'], body), this.change([...root, 'meta.json'], json(next))],
      'draft',
      operationId,
    );
    this.replaceMeta(next);
    return { meta: next, body, baseContentHash: await sha256(body) };
  }
  async transitionStoredPrompt(projectId: string, promptId: string, status: PromptStatus) {
    this.assertWritable();
    const meta = this.meta(projectId, promptId);
    if (meta.deletedAt) throw new AppFault('BUSY');
    const path = [...promptPath(this.project(projectId).slug, promptId), 'meta.json'];
    // A list action must not silently accept metadata changed since the list was loaded.
    const expected = this.originals.get(path.join('/'));
    if (!expected || (await this.fs.read(path))?.hash !== (await sha256(expected)))
      throw new AppFault('CONFLICT');
    const document = await this.openPrompt(projectId, promptId);
    return this.checkpoint(projectId, promptId, document.body, status);
  }
  async updateSettings(input: {
    name: string;
    defaultTarget: string;
    autosaveEnabled: boolean;
    autosaveDelayMs: number;
  }): Promise<WorkspaceView> {
    this.assertWritable();
    const operationId = newId('op'),
      updatedAt = new Date().toISOString();
    const workspace = workspaceSchema.parse({
      ...this.workspace,
      name: input.name,
      revision: this.workspace.revision + 1,
      lastOperationId: operationId,
      updatedAt,
    });
    const settings = settingsSchema.parse({
      ...this.settings,
      defaultTarget: input.defaultTarget,
      autosaveEnabled: input.autosaveEnabled,
      autosaveDelayMs: input.autosaveDelayMs,
      revision: this.settings.revision + 1,
      lastOperationId: operationId,
      updatedAt,
    });
    await this.commit(
      [this.change(settingsPath, json(settings)), this.change(workspacePath, json(workspace))],
      'settings',
      operationId,
    );
    this.workspace = workspace;
    this.settings = settings;
    return this.view();
  }
  private replaceMeta(meta: PromptMeta) {
    this.prompts = this.prompts.map((p) =>
      p.id === meta.id && p.projectId === meta.projectId ? meta : p,
    );
  }
  private async verifyVersions(meta: PromptMeta, root: string[]): Promise<void> {
    const entries = await this.fs.list([...root, 'versions']);
    if (entries.some((e) => e.kind !== 'file' || !meta.versions.some((v) => v.fileName === e.name)))
      throw new AppFault('RECOVERY_REQUIRED');
    for (const version of meta.versions) {
      if (
        (await this.fs.read([...root, 'versions', version.fileName]))?.hash !== version.contentHash
      )
        throw new AppFault('INVALID_SCHEMA');
    }
  }
  async checkpoint(
    projectId: string,
    promptId: string,
    body: string,
    nextStatus?: PromptStatus,
    resubmit = false,
  ): Promise<OpenPrompt> {
    const current = this.meta(projectId, promptId);
    if (current.status === 'archived' && nextStatus && nextStatus !== 'archived')
      this.editable(projectId);
    else this.editable(projectId, promptId);
    if (nextStatus) {
      statusSchema.parse(nextStatus);
      validateTransition(current, nextStatus, body);
    }
    if (nextStatus === current.status && !resubmit)
      return { meta: current, body, baseContentHash: await sha256(body) };
    const project = this.project(projectId),
      root = promptPath(project.slug, promptId),
      operationId = newId('op');
    await this.verifyVersions(current, root);
    const versions = [...current.versions],
      changes: Change[] = [],
      at = new Date().toISOString();
    let number = versions.at(-1)?.number ?? 0;
    if (!nextStatus || checkpointRequired(nextStatus)) {
      const contentHash = await sha256(body);
      if (versions.at(-1)?.contentHash !== contentHash) {
        number++;
        const version: VersionMeta = {
          number,
          fileName: versionFile(number),
          createdAt: at,
          reason:
            nextStatus === 'submitted' ? 'submitted' : nextStatus === 'ready' ? 'ready' : 'manual',
          note: '',
          contentHash,
          restoredFrom: null,
          operationId,
        };
        versions.push(version);
        changes.push({ path: [...root, 'versions', version.fileName], before: null, after: body });
      }
    }
    const statusHistory = [...current.statusHistory];
    if (nextStatus)
      statusHistory.push({
        id: newId('event'),
        operationId,
        from: current.status,
        to: nextStatus,
        at,
        versionNumber: checkpointRequired(nextStatus) ? number : null,
        kind: resubmit ? 'resubmit' : 'transition',
      });
    const next = promptSchema.parse({
      ...current,
      status: nextStatus ?? current.status,
      versions,
      currentVersion: number,
      statusHistory,
      submittedAt: nextStatus === 'submitted' ? (current.submittedAt ?? at) : current.submittedAt,
      completedAt: nextStatus === 'completed' ? at : current.completedAt,
      submittedVersion: nextStatus === 'submitted' ? number : current.submittedVersion,
      revision: current.revision + 1,
      lastOperationId: operationId,
      updatedAt: at,
    });
    await this.commit(
      [
        this.change([...root, 'current.md'], body),
        ...changes,
        this.change([...root, 'meta.json'], json(next)),
      ],
      nextStatus ? 'status' : 'checkpoint',
      operationId,
    );
    this.replaceMeta(next);
    return { meta: next, body, baseContentHash: await sha256(body) };
  }
  async readVersion(projectId: string, promptId: string, number: number): Promise<string> {
    const meta = this.meta(projectId, promptId),
      project = this.project(projectId);
    const version = meta.versions.find((v) => v.number === number);
    if (!version) throw new AppFault('NOT_FOUND');
    const file = await this.fs.read([
      ...promptPath(project.slug, promptId),
      'versions',
      version.fileName,
    ]);
    if (!file || file.hash !== version.contentHash) throw new AppFault('INVALID_SCHEMA');
    return file.text;
  }
  async restore(
    projectId: string,
    promptId: string,
    number: number,
    body: string,
  ): Promise<OpenPrompt> {
    this.editable(projectId, promptId);
    const current = this.meta(projectId, promptId),
      root = promptPath(this.project(projectId).slug, promptId);
    await this.verifyVersions(current, root);
    const restored = await this.readVersion(projectId, promptId, number),
      operationId = newId('op'),
      at = new Date().toISOString();
    const versions = [...current.versions],
      changes: Change[] = [];
    const append = async (
      content: string,
      reason: VersionMeta['reason'],
      restoredFrom: number | null,
    ) => {
      const n = (versions.at(-1)?.number ?? 0) + 1;
      const version: VersionMeta = {
        number: n,
        fileName: versionFile(n),
        createdAt: at,
        reason,
        note: '',
        contentHash: await sha256(content),
        restoredFrom,
        operationId,
      };
      versions.push(version);
      changes.push({ path: [...root, 'versions', version.fileName], before: null, after: content });
    };
    if (versions.at(-1)?.contentHash !== (await sha256(body)))
      await append(body, 'before_restore', null);
    await append(restored, 'restore', number);
    const next = promptSchema.parse({
      ...current,
      versions,
      currentVersion: versions.at(-1)!.number,
      revision: current.revision + 1,
      lastOperationId: operationId,
      updatedAt: at,
    });
    await this.commit(
      [
        ...changes,
        this.change([...root, 'current.md'], restored),
        this.change([...root, 'meta.json'], json(next)),
      ],
      'restore',
      operationId,
    );
    this.replaceMeta(next);
    return { meta: next, body: restored, baseContentHash: await sha256(restored) };
  }
  async updatePrompt(
    projectId: string,
    promptId: string,
    patch: { title?: string; target?: string; tags?: string[]; notes?: string },
  ): Promise<PromptMeta> {
    this.editable(projectId, promptId);
    const current = this.meta(projectId, promptId),
      operationId = newId('op');
    const allowed = {
      ...(patch.title === undefined ? {} : { title: patch.title }),
      ...(patch.target === undefined ? {} : { target: patch.target }),
      ...(patch.tags === undefined ? {} : { tags: patch.tags }),
      ...(patch.notes === undefined ? {} : { notes: patch.notes }),
    };
    const next = promptSchema.parse({
      ...current,
      ...allowed,
      revision: current.revision + 1,
      lastOperationId: operationId,
      updatedAt: new Date().toISOString(),
    });
    await this.commit(
      [
        this.change(
          [...promptPath(this.project(projectId).slug, promptId), 'meta.json'],
          json(next),
        ),
      ],
      'prompt',
      operationId,
    );
    this.replaceMeta(next);
    return next;
  }
  async setPromptDeleted(
    projectId: string,
    promptId: string,
    deleted: boolean,
  ): Promise<WorkspaceView> {
    this.editable(projectId);
    const current = this.meta(projectId, promptId),
      operationId = newId('op'),
      at = new Date().toISOString();
    const active = ordered(
      this.prompts.filter((p) => p.projectId === projectId && !p.deletedAt && p.id !== promptId),
    );
    const next = promptSchema.parse({
      ...current,
      deletedAt: deleted ? at : null,
      order: deleted ? current.order : active.length + 1,
      revision: current.revision + 1,
      lastOperationId: operationId,
      updatedAt: at,
    });
    const adjusted = active.map((p, i) =>
      promptSchema.parse({
        ...p,
        order: i + 1,
        revision: p.revision + 1,
        lastOperationId: operationId,
        updatedAt: at,
      }),
    );
    const root = ['projects', this.project(projectId).slug, 'prompts'];
    await this.commit(
      [
        ...adjusted.map((p) => this.change([...root, p.id, 'meta.json'], json(p))),
        this.change([...root, promptId, 'meta.json'], json(next)),
      ],
      'delete',
      operationId,
    );
    for (const p of [...adjusted, next]) this.replaceMeta(p);
    return this.view();
  }
  async close(): Promise<void> {
    await this.journal.drain();
    this.closed = true;
  }
  private scratch(id: string) {
    const meta = this.scratchpads.find((s) => s.id === id);
    if (!meta) throw new AppFault('NOT_FOUND');
    return meta;
  }
  private replaceScratch(meta: ScratchMeta) {
    this.scratchpads = this.scratchpads.map((s) => (s.id === meta.id ? meta : s));
  }
  async createScratch(): Promise<OpenScratch> {
    this.assertWritable();
    const operationId = newId('op');
    const meta = scratchpadSchema.parse({
      ...baseDocument(operationId),
      id: newId('scratch'),
      title: '临时草稿',
      deletedAt: null,
      transferredTo: null,
      transferredAt: null,
    });
    await this.commit(
      [
        this.change(['scratchpad', meta.id, 'current.md'], ''),
        this.change(['scratchpad', meta.id, 'meta.json'], json(meta)),
      ],
      'scratchpad',
      operationId,
    );
    this.scratchpads.push(meta);
    return { meta, body: '', baseContentHash: await sha256('') };
  }
  async openScratch(id: string): Promise<OpenScratch> {
    if (this.journal.blocked || this.pending.length) throw new AppFault('RECOVERY_REQUIRED');
    this.scratch(id);
    const meta = await this.tracked(scratchpadSchema, ['scratchpad', id, 'meta.json']);
    if (meta.id !== id) throw new AppFault('INVALID_SCHEMA');
    const file = await this.fs.read(['scratchpad', id, 'current.md']);
    if (!file) throw new AppFault('NOT_FOUND');
    this.originals.set(`scratchpad/${id}/current.md`, file.text);
    this.replaceScratch(meta);
    return { meta, body: file.text, baseContentHash: file.hash };
  }
  async saveScratch(id: string, title: string, body: string): Promise<OpenScratch> {
    this.assertWritable();
    const current = this.scratch(id),
      operationId = newId('op');
    if (current.deletedAt || current.transferredTo) throw new AppFault('BUSY');
    if (!this.originals.has(`scratchpad/${id}/current.md`)) throw new AppFault('CONFLICT');
    const meta = scratchpadSchema.parse({
      ...current,
      title,
      revision: current.revision + 1,
      updatedAt: new Date().toISOString(),
      lastOperationId: operationId,
    });
    await this.commit(
      [
        this.change(['scratchpad', id, 'current.md'], body),
        this.change(['scratchpad', id, 'meta.json'], json(meta)),
      ],
      'scratchpad',
      operationId,
    );
    this.replaceScratch(meta);
    return { meta, body, baseContentHash: await sha256(body) };
  }
  async setScratchDeleted(id: string, deleted: boolean) {
    this.assertWritable();
    const current = this.scratch(id),
      operationId = newId('op'),
      at = new Date().toISOString();
    const meta = scratchpadSchema.parse({
      ...current,
      deletedAt: deleted ? at : null,
      revision: current.revision + 1,
      updatedAt: at,
      lastOperationId: operationId,
    });
    await this.commit(
      [this.change(['scratchpad', id, 'meta.json'], json(meta))],
      'delete',
      operationId,
    );
    this.replaceScratch(meta);
    return this.view();
  }
  async transferScratch(
    id: string,
    projectId: string,
  ): Promise<{ projectId: string; promptId: string }> {
    this.assertWritable();
    const source = this.scratch(id);
    if (source.transferredTo) {
      const target = await this.openPrompt(
        source.transferredTo.projectId,
        source.transferredTo.promptId,
      );
      if (target.meta.projectId !== source.transferredTo.projectId)
        throw new AppFault('INVALID_SCHEMA');
      return source.transferredTo;
    }
    if (source.deletedAt) throw new AppFault('BUSY');
    this.editable(projectId);
    const body = await this.fs.read(['scratchpad', id, 'current.md']);
    if (
      !body ||
      body.hash !== (await sha256(this.originals.get(`scratchpad/${id}/current.md`) ?? ''))
    )
      throw new AppFault('CONFLICT');
    const project = this.project(projectId),
      operationId = newId('op'),
      at = new Date().toISOString();
    const promptId = nextPromptId(
      (await this.fs.list(['projects', project.slug, 'prompts'])).map((e) => e.name),
    );
    const meta = initialPrompt({
      operationId,
      eventId: newId('event'),
      at,
      projectId,
      id: promptId,
      title: source.title,
      target: this.settings.defaultTarget,
      order: this.prompts.filter((p) => p.projectId === projectId && !p.deletedAt).length + 1,
      parentPromptId: null,
    });
    const transferredTo = { projectId, promptId };
    const scratch = scratchpadSchema.parse({
      ...source,
      transferredTo,
      transferredAt: at,
      revision: source.revision + 1,
      updatedAt: at,
      lastOperationId: operationId,
    });
    await this.commit(
      [
        this.change(['scratchpad', id, 'current.md'], body.text),
        this.change([...promptPath(project.slug, promptId), 'current.md'], body.text),
        this.change([...promptPath(project.slug, promptId), 'meta.json'], json(meta)),
        this.change(['scratchpad', id, 'meta.json'], json(scratch)),
      ],
      'scratchpad',
      operationId,
    );
    this.prompts.push(meta);
    this.replaceScratch(scratch);
    return transferredTo;
  }
  async readSearchBody(projectId: string, promptId: string) {
    const file = await this.fs.read([
      ...promptPath(this.project(projectId).slug, promptId),
      'current.md',
    ]);
    if (!file) throw new AppFault('NOT_FOUND');
    return { body: file.text, hash: file.hash };
  }
  directoryName() {
    return this.fs.name;
  }
  async files() {
    return listWorkspaceFiles(this.fs);
  }
  async readLocalFile(path: string[]) {
    if (!isBusinessPath(path)) throw new AppFault('PATH_INVALID');
    const file = await this.fs.read(path);
    if (!file) throw new AppFault('NOT_FOUND');
    return file.text;
  }
  async snapshot(): Promise<WorkspaceSnapshot> {
    this.assertWritable();
    return captureSnapshot(this.fs);
  }
  async migrate(target: FileSystemPort, snapshot: WorkspaceSnapshot) {
    this.assertWritable();
    if (snapshot.workspaceId !== this.workspace.id) throw new AppFault('CONFLICT');
    await copySnapshot(this.fs, target, snapshot);
    const runtime = await WorkspaceRuntime.open(target);
    const view = await runtime.load();
    if (view.pending.length || view.issues.length) throw new AppFault('RECOVERY_REQUIRED');
    return runtime;
  }
}
