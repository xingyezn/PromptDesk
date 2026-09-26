import { isBusinessPath } from '../../domain/paths';
import {
  json,
  parseDocument,
  pendingSchema,
  newId,
  type PendingManifest,
} from '../../domain/schemas';
import { AppFault } from '../../types/errors';
import type { FileSystemPort } from '../../types/filesystem';
import { sha256 } from '../../utils/hash';

export interface Change {
  path: string[];
  before: string | null;
  after: string;
}
export class Journal {
  private tail: Promise<unknown> = Promise.resolve();
  blocked = false;
  constructor(
    private readonly fs: FileSystemPort,
    public readonly workspaceId: string,
  ) {}
  exclusive<T>(job: () => Promise<T>): Promise<T> {
    const task = this.tail.then(job);
    this.tail = task.catch(() => undefined);
    return task;
  }
  async drain(): Promise<void> {
    await this.tail;
  }
  async commit(
    changes: Change[],
    kind: PendingManifest['kind'],
    operationId = newId('op'),
  ): Promise<void> {
    if (this.blocked) throw new AppFault('RECOVERY_REQUIRED');
    if (!changes.length) return;
    const keys = changes.map((c) => c.path.join('/'));
    if (new Set(keys).size !== keys.length || changes.some((c) => !isBusinessPath(c.path)))
      throw new AppFault('PATH_INVALID');
    for (const change of changes) {
      if (
        (await this.fs.read(change.path))?.hash !==
        (change.before === null ? undefined : await sha256(change.before))
      )
        throw new AppFault('CONFLICT');
    }
    const root = ['.promptdesk', 'pending', operationId];
    const entries: PendingManifest['entries'] = [];
    try {
      for (const [index, change] of changes.entries()) {
        const name = `${String(index + 1).padStart(4, '0')}.txt`;
        const after = { snapshotPath: ['after', name], sha256: await sha256(change.after) };
        await this.fs.write([...root, ...after.snapshotPath], change.after, null);
        let before = null;
        if (change.before !== null) {
          before = { snapshotPath: ['before', name], sha256: await sha256(change.before) };
          await this.fs.write([...root, ...before.snapshotPath], change.before, null);
        }
        entries.push({ targetPath: change.path, before, after });
      }
      const marker = changes.at(-1)!;
      const manifest: PendingManifest = {
        schemaVersion: 1,
        operationId,
        workspaceId: this.workspaceId,
        kind,
        createdAt: new Date().toISOString(),
        phase: 'prepared',
        commitMarkerPath: marker.path,
        entries,
      };
      const manifestText = json(manifest);
      await this.fs.write([...root, 'manifest.json'], manifestText, null);
      for (const change of changes)
        await this.fs.write(
          change.path,
          change.after,
          change.before === null ? null : await sha256(change.before),
        );
      for (const entry of entries)
        if ((await this.fs.read(entry.targetPath))?.hash !== entry.after.sha256)
          throw new AppFault('WRITE_FAILED');
      await this.fs.write(
        [...root, 'manifest.json'],
        json({ ...manifest, phase: 'committed' }),
        await sha256(manifestText),
      );
    } catch (error) {
      this.blocked = true;
      throw error;
    }
    // Cleanup failure is not a failed save: all business targets have already been verified.
    try {
      await this.fs.cleanupPending(operationId);
    } catch {
      this.blocked = true;
    }
  }
  async inspect(): Promise<PendingManifest[]> {
    const records: PendingManifest[] = [];
    for (const entry of await this.fs.list(['.promptdesk', 'pending'])) {
      if (entry.kind !== 'directory' || !/^op_[0-9a-f-]{36}$/.test(entry.name))
        throw new AppFault('RECOVERY_REQUIRED');
      const file = await this.fs.read(['.promptdesk', 'pending', entry.name, 'manifest.json']);
      // Unprepared staging is preserved for diagnosis; never infer that business writes happened.
      if (!file) {
        this.blocked = true;
        throw new AppFault('RECOVERY_REQUIRED');
      }
      const record = parseDocument(pendingSchema, file.text);
      if (record.operationId !== entry.name || record.workspaceId !== this.workspaceId)
        throw new AppFault('INVALID_SCHEMA');
      await this.verifySnapshots(record);
      records.push(record);
    }
    this.blocked = records.length > 0;
    return records;
  }
  private async verifySnapshots(record: PendingManifest): Promise<void> {
    const root = ['.promptdesk', 'pending', record.operationId];
    for (const entry of record.entries) {
      if (!isBusinessPath(entry.targetPath)) throw new AppFault('PATH_INVALID');
      for (const [side, snapshot] of [
        ['before', entry.before],
        ['after', entry.after],
      ] as const) {
        if (!snapshot) continue;
        if (
          snapshot.snapshotPath.length !== 2 ||
          snapshot.snapshotPath[0] !== side ||
          !/^\d{4,}\.txt$/.test(snapshot.snapshotPath[1] ?? '')
        )
          throw new AppFault('PATH_INVALID');
        const file = await this.fs.read([...root, ...snapshot.snapshotPath]);
        if (!file || file.hash !== snapshot.sha256) throw new AppFault('INVALID_SCHEMA');
      }
    }
  }
  async recover(record: PendingManifest, choice: 'finish' | 'rollback'): Promise<void> {
    const manifestFile = await this.fs.read([
      '.promptdesk',
      'pending',
      record.operationId,
      'manifest.json',
    ]);
    if (!manifestFile) return; // Already recovered; idempotent.
    const currentRecord = parseDocument(pendingSchema, manifestFile.text);
    if (
      currentRecord.operationId !== record.operationId ||
      currentRecord.workspaceId !== this.workspaceId
    )
      throw new AppFault('INVALID_SCHEMA');
    await this.verifySnapshots(currentRecord);
    const root = ['.promptdesk', 'pending', record.operationId];
    for (const entry of currentRecord.entries) {
      const current = await this.fs.read(entry.targetPath);
      const currentHash = current?.hash ?? null;
      if (currentHash !== (entry.before?.sha256 ?? null) && currentHash !== entry.after.sha256)
        throw new AppFault('CONFLICT');
    }
    // Validate the entire set first; a third-party edit must not cause a partial recovery.
    const entries =
      choice === 'finish' ? currentRecord.entries : [...currentRecord.entries].reverse();
    for (const entry of entries) {
      const current = await this.fs.read(entry.targetPath);
      if (
        (current?.hash ?? null) !== (entry.before?.sha256 ?? null) &&
        current?.hash !== entry.after.sha256
      )
        throw new AppFault('CONFLICT');
      const snapshot = choice === 'finish' ? entry.after : entry.before;
      if (snapshot) {
        if (current?.hash === snapshot.sha256) continue;
        const copy = await this.fs.read([...root, ...snapshot.snapshotPath]);
        if (!copy) throw new AppFault('INVALID_SCHEMA');
        await this.fs.write(entry.targetPath, copy.text, current?.hash ?? null);
      } else if (current) await this.fs.removeGeneratedFile(entry.targetPath, entry.after.sha256);
    }
    await this.fs.cleanupPending(record.operationId);
    this.blocked = (await this.fs.list(['.promptdesk', 'pending'])).length > 0;
  }
}
