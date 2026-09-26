import { describe, expect, it } from 'vitest';
import {
  archivedChoiceKey,
  inspectLegacyMigration,
  migrateLegacyWorkspace,
  previewLegacyWorkspace,
  recoverLegacyMigration,
} from '../../src/services/workspace/schema-migration';
import { WorkspaceRuntime } from '../../src/services/workspace/runtime';
import { MemoryFileSystem } from '../fixtures/synthetic/memory-filesystem';

async function legacyFixture() {
  const fs = new MemoryFileSystem();
  const runtime = await WorkspaceRuntime.create(fs, '合成旧工作空间');
  const project = (await runtime.createProject('合成旧项目')).projects[0]!;
  const first = await runtime.createPrompt(project.id, '合成草稿');
  const second = await runtime.createPrompt(project.id, '合成旧归档');
  await runtime.saveDraft(project.id, first.id, '合成正文：草稿');
  await runtime.checkpoint(project.id, second.id, '合成正文：有版本', 'ready');
  const otherStatuses = ['ready', 'submitted', 'waiting', 'blocked', 'completed'] as const;
  const legacyPrompts = new Map<string, (typeof otherStatuses)[number]>();
  for (const status of otherStatuses) {
    const prompt = await runtime.createPrompt(project.id, `合成旧状态 ${status}`);
    legacyPrompts.set(prompt.id, status);
    await runtime.checkpoint(
      project.id,
      prompt.id,
      `合成正文 ${status}`,
      status === 'completed' ? 'completed' : 'ready',
    );
  }
  for (const [path, content] of [...fs.files.entries()]) {
    if (!path.endsWith('.json')) continue;
    const record: Record<string, unknown> = JSON.parse(content);
    record.schemaVersion = 1;
    if (path.endsWith('meta.json') && path.includes('/prompts/')) {
      const promptId = path.split('/').at(-2);
      const legacyStatus =
        promptId === second.id ? 'archived' : (legacyPrompts.get(promptId ?? '') ?? 'idea');
      delete record.priority;
      record.status = legacyStatus;
      const history = record.statusHistory as Record<string, unknown>[];
      record.statusHistory = history.map((event) => ({
        ...event,
        from: event.from === null ? null : legacyStatus,
        to: legacyStatus,
        kind: event.kind === 'created' ? 'created' : 'transition',
      }));
    }
    fs.files.set(path, JSON.stringify(record, null, 2) + '\n');
  }
  return { fs, project, first, second, legacyPrompts };
}

describe('confirmed workspace schema migration', () => {
  it('previews legacy statuses and leaves all source files untouched until confirmation', async () => {
    const { fs, second } = await legacyFixture();
    const before = new Map(fs.files);
    const preview = await previewLegacyWorkspace(fs);
    expect(preview.workspaceName).toBe('合成旧工作空间');
    expect(preview.counts.idea).toBe(1);
    expect(preview.counts.ready).toBe(1);
    expect(preview.counts.submitted).toBe(1);
    expect(preview.counts.waiting).toBe(1);
    expect(preview.counts.blocked).toBe(1);
    expect(preview.counts.completed).toBe(1);
    expect(preview.archivedPrompts.map((item) => item.promptId)).toEqual([second.id]);
    expect(fs.files).toEqual(before);
  });

  it('requires a choice for each archived prompt and preserves versions through migration', async () => {
    const { fs, project, first, second, legacyPrompts } = await legacyFixture();
    const before = new Map(fs.files);
    await expect(migrateLegacyWorkspace(fs, {})).rejects.toThrow();
    expect(fs.files).toEqual(before);
    await migrateLegacyWorkspace(fs, { [archivedChoiceKey(project.id, second.id)]: 'completed' });
    const reopened = await WorkspaceRuntime.open(fs);
    const view = await reopened.load();
    expect(view.prompts.find((item) => item.id === first.id)?.status).toBe('draft');
    const migrated = view.prompts.find((item) => item.id === second.id)!;
    expect(migrated.status).toBe('completed');
    expect(migrated.priority).toBe('normal');
    for (const [id, oldStatus] of legacyPrompts) {
      const expected = oldStatus === 'completed' ? 'completed' : 'ready';
      expect(view.prompts.find((item) => item.id === id)?.status).toBe(expected);
    }
    expect(migrated.currentVersion).toBe(1);
    expect(await reopened.readVersion(project.id, second.id, 1)).toBe('合成正文：有版本');
    expect((await reopened.openPrompt(project.id, first.id)).body).toBe('合成正文：草稿');
    expect(JSON.parse(fs.files.get('.promptdesk/workspace.json')!).schemaVersion).toBe(2);
  });

  it('stops if a file changes after the preview the user confirmed', async () => {
    const { fs, project, second } = await legacyFixture();
    const preview = await previewLegacyWorkspace(fs);
    const path = `projects/${project.slug}/project.json`;
    const changed = JSON.parse(fs.files.get(path)!);
    changed.description = '合成预览后外部修改';
    fs.files.set(path, JSON.stringify(changed));
    const before = new Map(fs.files);
    await expect(
      migrateLegacyWorkspace(
        fs,
        { [archivedChoiceKey(project.id, second.id)]: 'ready' },
        preview.sourceFingerprint,
      ),
    ).rejects.toThrow('外部修改');
    expect(fs.files).toEqual(before);
  });

  it('keeps an interrupted confirmed migration recoverable and completes it idempotently', async () => {
    const { fs, project, second } = await legacyFixture();
    const preview = await previewLegacyWorkspace(fs);
    fs.fail = (path) => path === '.promptdesk/workspace.json';
    await expect(
      migrateLegacyWorkspace(
        fs,
        { [archivedChoiceKey(project.id, second.id)]: 'completed' },
        preview.sourceFingerprint,
      ),
    ).rejects.toThrow();
    fs.fail = null;
    const state = await inspectLegacyMigration(fs);
    expect(state.kind).toBe('recovery');
    if (state.kind !== 'recovery') throw new Error('Expected synthetic migration recovery');
    await recoverLegacyMigration(
      fs,
      state.recovery.workspaceId,
      state.recovery.operationId,
      'finish',
    );
    const reopened = await WorkspaceRuntime.open(fs);
    expect((await reopened.load()).prompts.find((item) => item.id === second.id)?.status).toBe(
      'completed',
    );
  });

  it('can roll back a prepared migration to the exact legacy files for a fresh preview', async () => {
    const { fs, project, second } = await legacyFixture();
    const before = new Map(fs.files);
    fs.fail = (path) => path === '.promptdesk/workspace.json';
    await expect(
      migrateLegacyWorkspace(fs, { [archivedChoiceKey(project.id, second.id)]: 'ready' }),
    ).rejects.toThrow();
    fs.fail = null;
    const state = await inspectLegacyMigration(fs);
    if (state.kind !== 'recovery') throw new Error('Expected synthetic migration recovery');
    await recoverLegacyMigration(
      fs,
      state.recovery.workspaceId,
      state.recovery.operationId,
      'rollback',
    );
    expect(fs.files).toEqual(before);
    expect((await inspectLegacyMigration(fs)).kind).toBe('preview');
  });
});
