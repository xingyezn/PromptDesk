import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { CacheService } from '../../src/services/cache/cache';

describe('mobile quick notes', () => {
  it('keeps device notes outside Workspace cache clearing and rejects empty notes', async () => {
    const cache = new CacheService();
    const saved = await cache.saveQuickNote(null, '合成速记：下一步检查导出');
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    const empty = await cache.saveQuickNote(null, '  ');
    expect(empty.ok).toBe(false);

    const cleared = await cache.clearAll();
    expect(cleared.ok).toBe(true);
    const listed = await cache.listQuickNotes();
    expect(listed.ok && listed.value).toEqual([saved.value]);

    const deleted = await cache.deleteQuickNote(saved.value.id);
    expect(deleted.ok).toBe(true);
  });
});
