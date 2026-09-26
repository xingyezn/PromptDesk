import { attempt, AppFault } from '../../types/errors';
import { NativeFileSystem } from '../filesystem/native';
import { CacheService, type RecoveryDraft } from '../cache/cache';
import { WorkspaceRuntime, type WorkspaceView } from './runtime';
import { acquireWorkspaceLock, type WorkspaceLock } from './lock';

export interface CreationPlan {
  directoryName: string;
  nonempty: boolean;
  existing: boolean;
}
export class WorkspaceController {
  private candidate: NativeFileSystem | null = null;
  private runtime: WorkspaceRuntime | null = null;
  private lock: WorkspaceLock | null = null;
  private readonly cache = new CacheService();
  private recentKey = '';
  private recents: Awaited<ReturnType<CacheService['listRecent']>> | null = null;
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
    return runtime.execute(() => action(runtime));
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
      this.lock = null;
    });
  }
}
export const workspaceController = new WorkspaceController();
