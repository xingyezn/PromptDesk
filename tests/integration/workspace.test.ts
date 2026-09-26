import { describe, expect, it } from 'vitest';
import { WorkspaceRuntime } from '../../src/services/workspace/runtime';
import { promptPath } from '../../src/domain/paths';
import { MemoryFileSystem } from '../fixtures/synthetic/memory-filesystem';

async function fixture() {
  const fs = new MemoryFileSystem(),
    runtime = await WorkspaceRuntime.create(fs, '合成测试空间');
  const view = await runtime.createProject('合成项目');
  const project = view.projects[0]!;
  const prompt = await runtime.createPrompt(project.id, '合成提示词');
  await runtime.openPrompt(project.id, prompt.id);
  const root = promptPath(project.slug, prompt.id);
  return { fs, runtime, project, prompt, root };
}
describe('local workspace integration', () => {
  it('reopens files without any browser cache and autosave does not create versions', async () => {
    const { fs, runtime, project, prompt } = await fixture();
    const saved = await runtime.saveDraft(project.id, prompt.id, '你好\nworld');
    expect(saved.meta.versions).toHaveLength(0);
    expect(saved.meta.status).toBe('draft');
    const reopened = await WorkspaceRuntime.open(fs);
    await reopened.load();
    expect((await reopened.openPrompt(project.id, prompt.id)).body).toBe('你好\nworld');
  });
  it('freezes submission and deduplicates equal latest checkpoints', async () => {
    const { runtime, project, prompt } = await fixture();
    await runtime.saveDraft(project.id, prompt.id, 'abc');
    const ready = await runtime.checkpoint(project.id, prompt.id, 'abc', 'ready');
    expect(ready.meta.currentVersion).toBe(1);
    const submitted = await runtime.checkpoint(project.id, prompt.id, 'abc', 'submitted');
    expect(submitted.meta.currentVersion).toBe(1);
    expect(submitted.meta.submittedVersion).toBe(1);
    const draft = await runtime.saveDraft(project.id, prompt.id, 'changed');
    expect(draft.meta.submittedVersion).toBe(1);
    expect(draft.meta.status).toBe('submitted');
    await runtime.checkpoint(project.id, prompt.id, 'changed', 'draft');
    expect(runtime.view().prompts[0]?.status).toBe('draft');
  });
  it('protects current draft before restoring history, without changing submitted state', async () => {
    const { runtime, project, prompt } = await fixture();
    await runtime.checkpoint(project.id, prompt.id, 'first', 'ready');
    await runtime.checkpoint(project.id, prompt.id, 'second', 'submitted');
    await runtime.saveDraft(project.id, prompt.id, 'unsaved checkpoint content');
    const restored = await runtime.restore(project.id, prompt.id, 1, 'unsaved checkpoint content');
    expect(restored.body).toBe('first');
    expect(restored.meta.status).toBe('submitted');
    expect(restored.meta.submittedVersion).toBe(2);
    expect(restored.meta.currentVersion).toBe(4);
    expect(await runtime.readVersion(project.id, prompt.id, 3)).toBe('unsaved checkpoint content');
    expect(await runtime.readVersion(project.id, prompt.id, 2)).toBe('second');
  });
  it('rejects empty submission and keeps the original state', async () => {
    const { runtime, project, prompt } = await fixture();
    await expect(runtime.checkpoint(project.id, prompt.id, '  ', 'submitted')).rejects.toThrow();
    expect(runtime.view().prompts[0]?.status).toBe('draft');
  });
  it('detects external edits and preserves disk content', async () => {
    const { fs, runtime, project, prompt, root } = await fixture();
    fs.files.set([...root, 'current.md'].join('/'), 'external');
    await expect(runtime.saveDraft(project.id, prompt.id, 'local')).rejects.toThrow('外部修改');
    expect((await fs.read([...root, 'current.md']))?.text).toBe('external');
  });
  it('recovers a partial version commit without creating duplicates', async () => {
    const { fs, runtime, project, prompt, root } = await fixture();
    fs.fail = (path) => path === [...root, 'meta.json'].join('/');
    await expect(
      runtime.checkpoint(project.id, prompt.id, 'new version', 'ready'),
    ).rejects.toThrow();
    expect(runtime.view().prompts[0]?.currentVersion).toBe(0);
    fs.fail = null;
    const reopened = await WorkspaceRuntime.open(fs),
      view = await reopened.load();
    expect(view.pending).toHaveLength(1);
    const recovered = await reopened.recover(view.pending[0]!.operationId, 'finish');
    expect(recovered.pending).toHaveLength(0);
    expect(recovered.prompts[0]?.currentVersion).toBe(1);
    const second = await WorkspaceRuntime.open(fs);
    expect((await second.load()).prompts[0]?.versions).toHaveLength(1);
  });
  it('exposes a committed operation when journal cleanup fails in the live session', async () => {
    const { fs, runtime, project, prompt } = await fixture();
    fs.failCleanupOnce = true;
    const saved = await runtime.checkpoint(project.id, prompt.id, 'recoverable', 'ready');
    expect(saved.meta.currentVersion).toBe(1);
    expect(
      (await fs.read([...promptPath(project.slug, prompt.id), 'versions', 'v001.md']))?.text,
    ).toBe('recoverable');
    expect(runtime.view().pending).toHaveLength(1);
    const operationId = runtime.view().pending[0]!.operationId;
    await expect(runtime.recover(operationId, 'rollback')).rejects.toThrow();
    const recovered = await runtime.recover(operationId, 'finish');
    expect(recovered.pending).toHaveLength(0);
    expect(recovered.prompts[0]?.currentVersion).toBe(1);
    expect(
      (await fs.read([...promptPath(project.slug, prompt.id), 'versions', 'v001.md']))?.text,
    ).toBe('recoverable');
  });
  it('rolls back only generated matching files and preserves external changes', async () => {
    const { fs, runtime, project, prompt, root } = await fixture();
    fs.fail = (path) => path === [...root, 'meta.json'].join('/');
    await expect(runtime.checkpoint(project.id, prompt.id, 'partial', 'ready')).rejects.toThrow();
    fs.fail = null;
    const reopened = await WorkspaceRuntime.open(fs),
      view = await reopened.load();
    fs.files.set([...root, 'current.md'].join('/'), 'external after crash');
    await expect(reopened.recover(view.pending[0]!.operationId, 'rollback')).rejects.toThrow(
      '外部修改',
    );
    expect((await fs.read([...root, 'current.md']))?.text).toBe('external after crash');
  });
  it('recovers initialization interrupted before the root marker', async () => {
    const fs = new MemoryFileSystem();
    fs.fail = (path) => path === '.promptdesk/workspace.json';
    await expect(WorkspaceRuntime.create(fs, '初始化测试')).rejects.toThrow();
    fs.fail = null;
    const runtime = await WorkspaceRuntime.open(fs),
      view = await runtime.load();
    expect(view.pending[0]?.kind).toBe('initialize');
    expect((await runtime.recover(view.pending[0]!.operationId, 'finish')).workspace.name).toBe(
      '初始化测试',
    );
  });
  it('logical deletion preserves version files and can be restored', async () => {
    const { fs, runtime, project, prompt, root } = await fixture();
    await runtime.checkpoint(project.id, prompt.id, 'keep', 'ready');
    await runtime.setPromptDeleted(project.id, prompt.id, true);
    expect((await fs.read([...root, 'versions', 'v001.md']))?.text).toBe('keep');
    await runtime.setPromptDeleted(project.id, prompt.id, false);
    expect(runtime.view().prompts[0]?.deletedAt).toBeNull();
  });
  it('isolates a broken prompt from the other valid entries', async () => {
    const { fs, runtime, project } = await fixture();
    const second = await runtime.createPrompt(project.id, '正常条目');
    fs.files.set(`projects/${project.slug}/prompts/P001/meta.json`, 'broken');
    const reopened = await WorkspaceRuntime.open(fs),
      view = await reopened.load();
    expect(view.issues).toHaveLength(1);
    expect(view.prompts.map((p) => p.id)).toEqual([second.id]);
  });
  it('does not initialize over reserved paths or existing workspaces', async () => {
    const { fs } = await fixture();
    await expect(WorkspaceRuntime.create(fs, 'overwrite')).rejects.toThrow();
    const foreign = new MemoryFileSystem();
    foreign.files.set('projects/private.md', 'private');
    await expect(WorkspaceRuntime.preflight(foreign)).rejects.toThrow();
    expect(foreign.files.get('projects/private.md')).toBe('private');
  });
});
