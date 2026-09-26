import { describe, expect, it } from 'vitest';
import { WorkspaceRuntime } from '../../src/services/workspace/runtime';
import { ordered } from '../../src/domain/policies';
import { MemoryFileSystem } from '../fixtures/synthetic/memory-filesystem';
import { captureSnapshot } from '../../src/services/workspace/snapshot';

async function fixture() {
  const fs = new MemoryFileSystem(),
    runtime = await WorkspaceRuntime.create(fs, '合成工作流空间');
  const project = (await runtime.createProject('合成工作流项目')).projects[0]!;
  const first = await runtime.createPrompt(project.id);
  return { fs, runtime, project, first };
}
describe('complete local planning workflow', () => {
  it('creates checkpoints when moving through the supported prompt statuses', async () => {
    const { runtime, project, first } = await fixture();
    await runtime.openPrompt(project.id, first.id);
    const ready = await runtime.checkpoint(project.id, first.id, '合成待提交', 'ready');
    const completed = await runtime.checkpoint(project.id, first.id, '合成已完成', 'completed');
    expect(completed.meta.status).toBe('completed');
    expect(completed.meta.statusHistory.at(-1)?.kind).toBe('transition');
    expect(completed.meta.currentVersion).toBe(2);
    expect(ready.meta.submittedVersion).toBeNull();
    expect(await runtime.readVersion(project.id, first.id, 1)).toBe('合成待提交');
  });
  it('checks external root settings before child writes and does not replace the baseline on inspection', async () => {
    const { fs, runtime, project, first } = await fixture();
    await runtime.openPrompt(project.id, first.id);
    fs.files.set(
      '.promptdesk/settings.json',
      fs.files.get('.promptdesk/settings.json')!.replace('Codex', 'ChatGPT'),
    );
    expect(await runtime.externalChanges({ projectId: project.id, id: first.id })).toEqual([
      '.promptdesk/settings.json',
    ]);
    await expect(runtime.createPrompt(project.id)).rejects.toThrow('外部修改');
    const reopened = await WorkspaceRuntime.open(fs);
    await reopened.load();
    expect((await reopened.createPrompt(project.id)).target).toBe('ChatGPT');
  });
  it('opens a workspace with missing settings read-only rather than guessing writable defaults', async () => {
    const { fs } = await fixture();
    fs.files.delete('.promptdesk/settings.json');
    const reopened = await WorkspaceRuntime.open(fs),
      view = await reopened.load();
    expect(view.writable).toBe(false);
    expect(view.issues).toContain('.promptdesk/settings.json');
  });
  it('inserts next after its parent, preserves IDs and reorders a complete list', async () => {
    const { runtime, project, first } = await fixture();
    const second = await runtime.createPrompt(project.id);
    const next = await runtime.createNext(project.id, first.id);
    expect(next.parentPromptId).toBe(first.id);
    expect(ordered(runtime.view().prompts).map((p) => p.id)).toEqual([
      first.id,
      next.id,
      second.id,
    ]);
    await expect(runtime.reorder(project.id, [first.id, second.id])).rejects.toThrow();
    await runtime.reorder(project.id, [second.id, first.id, next.id]);
    expect(ordered(runtime.view().prompts).map((p) => p.id)).toEqual([
      second.id,
      first.id,
      next.id,
    ]);
    await runtime.setPromptDeleted(project.id, first.id, true);
    expect(runtime.view().prompts.find((p) => p.id === next.id)?.parentPromptId).toBe(first.id);
    await runtime.setPromptDeleted(project.id, first.id, false);
    expect(ordered(runtime.view().prompts.filter((p) => !p.deletedAt)).map((p) => p.order)).toEqual(
      [1, 2, 3],
    );
  });
  it('splits selected text into a related prompt in one recoverable workspace transaction', async () => {
    const { fs, runtime, project, first } = await fixture();
    await runtime.openPrompt(project.id, first.id);
    await runtime.saveDraft(project.id, first.id, '保留在原项的内容');
    fs.fail = (path) => path === `projects/${project.slug}/prompts/P002/meta.json`;
    await expect(
      runtime.splitPrompt(project.id, first.id, '原项余文', '合成拆分项', '选中的新内容'),
    ).rejects.toThrow();
    fs.fail = null;
    const reopened = await WorkspaceRuntime.open(fs);
    const pending = await reopened.load();
    expect(pending.pending).toHaveLength(1);
    await reopened.recover(pending.pending[0]!.operationId, 'finish');
    const created = reopened.view().prompts.find((item) => item.id === 'P002')!;
    expect(created.title).toBe('合成拆分项');
    expect(created.parentPromptId).toBe(first.id);
    expect(created.order).toBe(first.order + 1);
    expect((await reopened.openPrompt(project.id, first.id)).body).toBe('原项余文');
    expect((await reopened.openPrompt(project.id, created.id)).body).toBe('选中的新内容');
  });
  it('persists priority separately from manual order across workspace reopen', async () => {
    const { fs, runtime, project, first } = await fixture();
    const second = await runtime.createPrompt(project.id);
    await runtime.updatePrompt(project.id, first.id, { priority: 'high' });
    await runtime.reorder(project.id, [second.id, first.id]);
    const reopened = await WorkspaceRuntime.open(fs);
    const view = await reopened.load();
    expect(view.prompts.find((item) => item.id === first.id)?.priority).toBe('high');
    expect(ordered(view.prompts).map((item) => item.id)).toEqual([second.id, first.id]);
  });
  it('recovers interrupted reorder without publishing partial order', async () => {
    const { fs, runtime, project, first } = await fixture();
    const second = await runtime.createPrompt(project.id);
    fs.fail = (path) => path === `projects/${project.slug}/prompts/${first.id}/meta.json`;
    await expect(runtime.reorder(project.id, [second.id, first.id])).rejects.toThrow();
    expect(ordered(runtime.view().prompts).map((p) => p.id)).toEqual([first.id, second.id]);
    fs.fail = null;
    const reopened = await WorkspaceRuntime.open(fs),
      view = await reopened.load();
    await reopened.recover(view.pending[0]!.operationId, 'finish');
    expect(ordered(reopened.view().prompts).map((p) => p.id)).toEqual([second.id, first.id]);
  });
  it('persists project and prompt fields and refuses editing archived content', async () => {
    const { fs, runtime, project, first } = await fixture();
    await runtime.updateProject(project.id, { description: '合成说明', tags: ['规划'] });
    await runtime.updatePrompt(project.id, first.id, {
      target: 'ChatGPT',
      tags: ['编写'],
      notes: '合成备注',
    });
    await runtime.updateProject(project.id, { status: 'archived' });
    await expect(runtime.updateProject(project.id, { name: '禁止的改名' })).rejects.toThrow();
    const reopened = await WorkspaceRuntime.open(fs),
      view = await reopened.load();
    expect(view.projects[0]?.description).toBe('合成说明');
    expect(view.prompts[0]?.notes).toBe('合成备注');
    expect(view.prompts[0]?.tags).toEqual(['编写']);
  });
  it('preserves scratchpad text across reopen, transfer, repeat transfer and backup', async () => {
    const { fs, runtime, project } = await fixture();
    const scratch = await runtime.createScratch();
    await runtime.saveScratch(scratch.meta.id, '合成临时想法', '逐字保留\n| 表 | 格 |');
    const reopened = await WorkspaceRuntime.open(fs);
    await reopened.load();
    const source = await reopened.openScratch(scratch.meta.id);
    const target = await reopened.transferScratch(source.meta.id, project.id);
    expect((await reopened.openPrompt(target.projectId, target.promptId)).body).toBe(source.body);
    expect(
      (await reopened.openPrompt(target.projectId, target.promptId)).meta.versions,
    ).toHaveLength(0);
    expect(await reopened.transferScratch(source.meta.id, project.id)).toEqual(target);
    expect(reopened.view().prompts).toHaveLength(2);
    await expect(
      reopened.saveScratch(source.meta.id, '合成新名', '禁止编辑转入源'),
    ).rejects.toThrow();
    expect((await captureSnapshot(fs)).files.some((file) => file.path[1] === scratch.meta.id)).toBe(
      true,
    );
  });
  it('recovers transfer after target files succeeded but scratch meta failed, without duplicates', async () => {
    const { fs, runtime, project } = await fixture();
    const scratch = await runtime.createScratch();
    await runtime.saveScratch(scratch.meta.id, '合成中断转入', '合成转入正文');
    fs.fail = (path) => path === `scratchpad/${scratch.meta.id}/meta.json`;
    await expect(runtime.transferScratch(scratch.meta.id, project.id)).rejects.toThrow();
    expect(runtime.view().prompts).toHaveLength(1);
    fs.fail = null;
    const reopened = await WorkspaceRuntime.open(fs),
      view = await reopened.load();
    await reopened.recover(view.pending[0]!.operationId, 'finish');
    const target = await reopened.transferScratch(scratch.meta.id, project.id);
    expect(reopened.view().prompts).toHaveLength(2);
    expect(target.promptId).toBe('P002');
  });
  it('does not recreate a missing transferred target and keeps deleted scratch files recoverable', async () => {
    const { fs, runtime, project } = await fixture();
    const scratch = await runtime.createScratch();
    await runtime.setScratchDeleted(scratch.meta.id, true);
    expect(fs.files.has(`scratchpad/${scratch.meta.id}/current.md`)).toBe(true);
    await runtime.setScratchDeleted(scratch.meta.id, false);
    const target = await runtime.transferScratch(scratch.meta.id, project.id);
    fs.files.delete(`projects/${project.slug}/prompts/${target.promptId}/meta.json`);
    await expect(runtime.transferScratch(scratch.meta.id, project.id)).rejects.toThrow();
    expect(runtime.view().prompts).toHaveLength(2);
  });
  it('isolates cyclic parent relations and refuses to package them', async () => {
    const { fs, runtime, project, first } = await fixture();
    const child = await runtime.createNext(project.id, first.id);
    const path = `projects/${project.slug}/prompts/${first.id}/meta.json`;
    const meta: unknown = JSON.parse(fs.files.get(path)!);
    if (typeof meta !== 'object' || !meta) throw new Error('Synthetic fixture');
    fs.files.set(path, JSON.stringify({ ...meta, parentPromptId: child.id }));
    const reopened = await WorkspaceRuntime.open(fs),
      view = await reopened.load();
    expect(view.issues).toHaveLength(2);
    await expect(captureSnapshot(fs)).rejects.toThrow('数据格式');
    await expect(reopened.createPrompt(project.id)).rejects.toThrow();
  });
});
