import Dexie, { type Table } from 'dexie';
import { newId, quickNoteRecordSchema } from '../../domain/schemas';
import type { z } from 'zod';
import { AppFault, attempt } from '../../types/errors';
import { NativeFileSystem } from '../filesystem/native';

interface Recent {
  recentKey: string;
  workspaceId: string;
  workspaceName: string;
  directoryHandle: FileSystemDirectoryHandle;
  lastOpenedAt: string;
}
interface UIPreference {
  workspaceId: string;
  key: string;
  value: string;
}
export interface RecoveryDraft {
  workspaceId: string;
  recentKey: string;
  entityKey: string;
  body: string;
  editSeq: number;
  baseContentHash: string;
  updatedAt: string;
}
export interface SearchCacheEntry {
  workspaceId: string;
  recentKey: string;
  projectId: string;
  promptId: string;
  body: string;
  contentHash: string;
  revision: number;
}
export type QuickNoteRecord = z.infer<typeof quickNoteRecordSchema>;
class CacheDatabase extends Dexie {
  recentWorkspaces!: Table<Recent, string>;
  uiPreferences!: Table<UIPreference, [string, string]>;
  recoveryDrafts!: Table<RecoveryDraft, [string, string, string]>;
  searchIndex!: Table<SearchCacheEntry, [string, string, string]>;
  constructor() {
    super('promptdesk-cache');
    this.version(1).stores({
      recentWorkspaces: 'recentKey, workspaceId, lastOpenedAt',
      recoveryDrafts: '[workspaceId+recentKey+entityKey], workspaceId',
      uiPreferences: '[workspaceId+key]',
      metadataCache: '[workspaceId+entityKey]',
      searchIndex: '[workspaceId+projectId+promptId], workspaceId',
    });
  }
}
class QuickNoteDatabase extends Dexie {
  notes!: Table<QuickNoteRecord, string>;
  constructor() {
    super('promptdesk-mobile-notes');
    this.version(1).stores({ notes: 'id, updatedAt' });
  }
}
export class CacheService {
  private readonly db = new CacheDatabase();
  private readonly quickNoteDb = new QuickNoteDatabase();
  available = true;
  async safe<T>(action: () => Promise<T>) {
    const result = await attempt(action);
    if (!result.ok) {
      this.available = false;
      return { ok: false as const, error: new AppFault('CACHE_UNAVAILABLE') };
    }
    return result;
  }
  listRecent() {
    return this.safe(() => this.db.recentWorkspaces.orderBy('lastOpenedAt').reverse().toArray());
  }
  async remember(
    workspaceId: string,
    workspaceName: string,
    handle: FileSystemDirectoryHandle,
  ): Promise<string> {
    const recent = await this.listRecent();
    let key: string | undefined;
    if (recent.ok) {
      for (const item of recent.value) {
        try {
          if (await NativeFileSystem.sameEntry(item.directoryHandle, handle)) {
            key = item.recentKey;
            break;
          }
        } catch {
          /* An inaccessible old handle is not the newly selected directory. */
        }
      }
    }
    const recentKey = key ?? newId('recent');
    await this.safe(() =>
      this.db.recentWorkspaces.put({
        recentKey,
        workspaceId,
        workspaceName,
        directoryHandle: handle,
        lastOpenedAt: new Date().toISOString(),
      }),
    );
    return recentKey;
  }
  putDraft(draft: RecoveryDraft) {
    return this.safe(() => this.db.recoveryDrafts.put(draft));
  }
  getDraft(workspaceId: string, recentKey: string, entityKey: string) {
    return this.safe(() => this.db.recoveryDrafts.get([workspaceId, recentKey, entityKey]));
  }
  clearDraft(workspaceId: string, recentKey: string, entityKey: string, editSeq: number) {
    return this.safe(() =>
      this.db.transaction('rw', this.db.recoveryDrafts, async () => {
        const key: [string, string, string] = [workspaceId, recentKey, entityKey];
        const value = await this.db.recoveryDrafts.get(key);
        if (value && value.editSeq <= editSeq) await this.db.recoveryDrafts.delete(key);
      }),
    );
  }
  putSearch(entry: SearchCacheEntry) {
    return this.safe(() => this.db.searchIndex.put(entry));
  }
  clearSearch(workspaceId: string) {
    return this.safe(() => this.db.searchIndex.where('workspaceId').equals(workspaceId).delete());
  }
  clearAll() {
    return this.safe(() =>
      this.db.transaction('rw', this.db.tables, async () => {
        for (const table of this.db.tables) await table.clear();
      }),
    );
  }
  getPreference(workspaceId: string, key: string) {
    return this.safe(
      async () => (await this.db.uiPreferences.get([workspaceId, key]))?.value ?? null,
    );
  }
  putPreference(workspaceId: string, key: string, value: string) {
    return this.safe(() => this.db.uiPreferences.put({ workspaceId, key, value }));
  }
  listQuickNotes() {
    return attempt(async () => {
      const rows: unknown[] = await this.quickNoteDb.notes.orderBy('updatedAt').reverse().toArray();
      return rows.map((row) => quickNoteRecordSchema.parse(row));
    });
  }
  async saveQuickNote(id: string | null, body: string) {
    if (body.trim().length === 0 || body.length > 10_000)
      return { ok: false as const, error: new AppFault('INVALID_SCHEMA') };
    const now = new Date().toISOString();
    return attempt(async () => {
      const stored = id ? await this.quickNoteDb.notes.get(id) : undefined;
      const existing = stored ? quickNoteRecordSchema.parse(stored) : null;
      const note = quickNoteRecordSchema.parse({
        id: existing?.id ?? newId('note'),
        body,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
      await this.quickNoteDb.notes.put(note);
      return note;
    });
  }
  deleteQuickNote(id: string) {
    return attempt(() => this.quickNoteDb.notes.delete(id));
  }
}
