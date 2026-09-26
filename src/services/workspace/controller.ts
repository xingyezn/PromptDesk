import { attempt, AppFault } from '../../types/errors';
import { NativeFileSystem } from '../filesystem/native';
import { CacheService, type RecoveryDraft } from '../cache/cache';
import { WorkspaceRuntime, type WorkspaceView } from './runtime';
import { acquireWorkspaceLock, type WorkspaceLock } from './lock';
import type { WorkspaceSnapshot } from './snapshot';
import { downloadArchive } from './archive';
import type { SearchDocument } from '../../domain/search';

export interface CreationPlan {
  directoryName: string;
  nonempty: boolean;
  existing: boolean;
}
export interface MigrationPlan {
  directoryName: string;
  fileCount: number;
  totalBytes: number;
  sessionId: string;
}
export class WorkspaceController {
  private candidate: NativeFileSystem | null = null;
  private runtime: WorkspaceRuntime | null = null;
  private filesystem: NativeFileSystem | null = null;
  private lock: WorkspaceLock | null = null;
  private readonly cache = new CacheService();
  private recentKey = '';
  private recents: Awaited<ReturnType<CacheService['listRecent']>> | null = null;
  private migration: {
    fs: NativeFileSystem;
    snapshot: WorkspaceSnapshot;
    sessionId: string;
  } | null = null;
  directoryName() {
    return this.runtime?.directoryName() ?? '';
  }
  exportArchive() {
    return this.run(async (runtime) => {
      const snapshot = await runtime.snapshot();
      downloadArchive(snapshot);
      return { fileCount: snapshot.files.length, totalBytes: snapshot.totalBytes };
    });
  }
  prepareMigration() {
    // The picker starts synchronously from the user's click, before any queued IO.
    const picked = NativeFileSystem.pick();
    const runtime = this.runtime;
    this.migration = null;
    return attempt(async (): Promise<MigrationPlan> => {
      const fs = await picked;
      if (!runtime || !runtime.writable) throw new AppFault('BUSY');
      if ((await fs.list([])).length) throw new AppFault('DESTINATION_NOT_EMPTY');
      const result = await runtime.execute(() => runtime.snapshot());
      if (!result.ok) throw result.error;
      if (this.runtime !== runtime) throw new AppFault('CONFLICT');
      this.migration = { fs, snapshot: result.value, sessionId: runtime.sessionId };
      return {
        directoryName: fs.name,
        fileCount: result.value.files.length,
        totalBytes: result.value.totalBytes,
        sessionId: runtime.sessionId,
      };
    });
  }
  cancelMigration() {
    this.migration = null;
  }
  clearCache() {
    this.recents = null;
    return this.cache.clearAll();
  }
  reauthorize() {
    const permission = this.filesystem?.authorize();
    return attempt(async () => {
      if (!permission) throw new AppFault('NOT_FOUND');
      await permission;
    });
  }
  buildSearchIndex(
    signal: AbortSignal,
    onProgress: (documents: SearchDocument[], completed: number, total: number) => void,
  ) {
    const runtime = this.runtime;
    return attempt(async () => {
      if (!runtime) throw new AppFault('NOT_FOUND');
      const loaded = await runtime.execute(() => runtime.load());
      if (!loaded.ok) throw loaded.error;
      if (loaded.value.pending.length) throw new AppFault('RECOVERY_REQUIRED');
      await this.cache.clearSearch(runtime.workspace.id);
      const projects = new Map(
        loaded.value.projects.filter((p) => !p.deletedAt).map((p) => [p.id, p]),
      );
      const prompts = loaded.value.prompts.filter((p) => !p.deletedAt && projects.has(p.projectId));
      const documents: SearchDocument[] = [];
      onProgress([], 0, prompts.length);
      for (const meta of prompts) {
        if (signal.aborted || this.runtime !== runtime) throw new AppFault('CANCELLED');
        const file = await runtime.execute(() => runtime.readSearchBody(meta.projectId, meta.id));
        if (signal.aborted || this.runtime !== runtime) throw new AppFault('CANCELLED');
        documents.push({
          meta,
          project: projects.get(meta.projectId)!,
          body: file.ok ? file.value.body : '',
          unavailable: !file.ok,
        });
        if (file.ok)
          await this.cache.putSearch({
            workspaceId: runtime.workspace.id,
            recentKey: this.recentKey,
            projectId: meta.projectId,
            promptId: meta.id,
            body: file.value.body,
            contentHash: file.value.hash,
            revision: meta.revision,
          });
        if (documents.length % 10 === 0 || documents.length === prompts.length) {
          onProgress([...documents], documents.length, prompts.length);
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
      }
      return documents;
    });
  }
  migrate() {
    return attempt(async () => {
      const plan = this.migration,
        previous = this.runtime;
      if (!plan || !previous || plan.sessionId !== previous.sessionId)
        throw new AppFault('CONFLICT');
      const result = await previous.execute(() => previous.migrate(plan.fs, plan.snapshot));
      if (!result.ok) throw result.error;
      await previous.close();
      // The replica keeps workspaceId. Retain the same origin lock across the switch.
      this.runtime = result.value;
      this.filesystem = plan.fs;
      this.recentKey = await this.cache.remember(
        result.value.workspace.id,
        result.value.workspace.name,
        plan.fs.getHandle(),
      );
      this.migration = null;
      return result.value.view();
    });
  }
  get cacheAvailable() {
    return this.cache.available;
  }
  supported() {
    return NativeFileSystem.supported();
  }
  recent() {
    return attempt(async () => {
      this.recents = await this.cache.listRecent();
      return this.recents.ok
        ? this.recents.value.map((r) => ({
            key: r.recentKey,
            name: r.workspaceName,
            date: r.lastOpenedAt,
          }))
        : [];
    });
  }
  prepareCreation() {
    return attempt(async () => {
      this.candidate = await NativeFileSystem.pick();
      const plan = await WorkspaceRuntime.preflight(this.candidate);
      return { ...plan, directoryName: this.candidate.name };
    });
  }
  create(name: string) {
    return attempt(async () => {
      if (!this.candidate) throw new AppFault('NOT_FOUND');
      const runtime = await WorkspaceRuntime.create(this.candidate, name);
      return this.attach(runtime, this.candidate);
    });
  }
  open() {
    return attempt(async () => {
      const fs = await NativeFileSystem.pick();
      return this.attach(await WorkspaceRuntime.open(fs), fs);
    });
  }
  openRecent(key: string) {
    const record = this.recents?.ok
      ? this.recents.value.find((r) => r.recentKey === key)
      : undefined;
    if (!record)
      return attempt<WorkspaceView>(async () => {
        throw new AppFault('NOT_FOUND');
      });
    const fs = new NativeFileSystem(record.directoryHandle);
    // Start the activation-sensitive permission request directly in the click call stack.
    const permission = fs.authorize();
    return attempt(async () => {
      await permission;
      return this.attach(await WorkspaceRuntime.open(fs), fs);
    });
  }
  private async attach(runtime: WorkspaceRuntime, fs: NativeFileSystem): Promise<WorkspaceView> {
    const lock = await acquireWorkspaceLock(runtime.workspace.id);
    runtime.writable = lock.writable;
    try {
      const view = await runtime.load();
      this.runtime = runtime;
      this.filesystem = fs;
      this.lock = lock;
      this.recentKey = await this.cache.remember(
        runtime.workspace.id,
        runtime.workspace.name,
        fs.getHandle(),
      );
      return view;
    } catch (error) {
      lock.release();
      throw error;
    }
  }
  run<T>(action: (runtime: WorkspaceRuntime) => Promise<T>) {
    const runtime = this.runtime;
    if (!runtime)
      return attempt<T>(async () => {
        throw new AppFault('NOT_FOUND');
      });
    const signature = (view: WorkspaceView) =>
      [
        view.workspace.revision,
        ...view.projects.map((p) => `${p.id}:${p.revision}`),
        ...view.prompts.map((p) => `${p.projectId}:${p.id}:${p.revision}`),
      ].join('|');
    const before = signature(runtime.view());
    return runtime
      .execute(() => action(runtime))
      .then(async (result) => {
        if (result.ok && before !== signature(runtime.view()))
          await this.cache.clearSearch(runtime.workspace.id);
        return result;
      });
  }
  view(): WorkspaceView | null {
    return this.runtime?.view() ?? null;
  }
  putRecoveryDraft(input: Omit<RecoveryDraft, 'workspaceId' | 'recentKey' | 'updatedAt'>) {
    if (!this.runtime) return;
    return this.cache.putDraft({
      ...input,
      workspaceId: this.runtime.workspace.id,
      recentKey: this.recentKey,
      updatedAt: new Date().toISOString(),
    });
  }
  getRecoveryDraft(entityKey: string) {
    return this.cache.getDraft(this.runtime?.workspace.id ?? '', this.recentKey, entityKey);
  }
  clearRecoveryDraft(entityKey: string, editSeq: number) {
    return this.cache.clearDraft(
      this.runtime?.workspace.id ?? '',
      this.recentKey,
      entityKey,
      editSeq,
    );
  }
  close() {
    return attempt(async () => {
      await this.runtime?.close();
      this.lock?.release();
      this.runtime = null;
      this.filesystem = null;
      this.migration = null;
      this.lock = null;
    });
  }
}
export const workspaceController = new WorkspaceController();
