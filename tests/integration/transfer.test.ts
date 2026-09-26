import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { WorkspaceRuntime } from '../../src/services/workspace/runtime';
import {
  captureSnapshot,
  copySnapshot,
  listWorkspaceFiles,
} from '../../src/services/workspace/snapshot';
import { encodeArchive } from '../../src/services/workspace/archive';
import { promptPath } from '../../src/domain/paths';
import { MemoryFileSystem } from '../fixtures/synthetic/memory-filesystem';

async function fixture() {
  const fs = new MemoryFileSystem(),
    runtime = await WorkspaceRuntime.create(fs, '合成备份空间');
  const project = (await runtime.createProject('合成备份项目')).projects[0]!;
  const prompt = await runtime.createPrompt(project.id);
  const root = promptPath(project.slug, prompt.id);
  await runtime.openPrompt(project.id, prompt.id);
  await runtime.checkpoint(project.id, prompt.id, '合成第一版\n正文', 'ready');
  await runtime.saveDraft(project.id, prompt.id, '合成当前草稿');
  return { fs, runtime, project, prompt, root };
}

describe('settings, list states and workspace transfer', () => {
  it('stops transfer at the file-count and total-size limits', async () => {
    const oversized = new MemoryFileSystem();
    for (let n = 1; n <= 5001; n++)
      oversized.files.set(
        `projects/synthetic/prompts/P001/versions/v${String(n).padStart(3, '0')}.md`,
        '',
      );
    await expect(listWorkspaceFiles(oversized)).rejects.toThrow('5000');
    const { fs, runtime } = await fixture();
    for (let n = 0; n < 7; n++) {
      const project = (await runtime.createProject(`合成容量项目 ${n}`)).projects.at(-1)!;
      fs.files.set(`projects/${project.slug}/README.md`, 'x'.repeat(5 * 1024 * 1024));
    }
    await expect(captureSnapshot(fs)).rejects.toThrow('32 MiB');
  });
  it('leaves a failed settings transaction recoverable and does not publish new values', async () => {
    const { fs, runtime } = await fixture();
    fs.fail = (path) => path === '.promptdesk/workspace.json';
    await expect(
      runtime.updateSettings({
        name: '合成失败设置',
        defaultTarget: 'ChatGPT',
        autosaveEnabled: false,
        autosaveDelayMs: 1000,
      }),
    ).rejects.toThrow();
    expect(runtime.view().settings.defaultTarget).toBe('Codex');
    fs.fail = null;
    const reopened = await WorkspaceRuntime.open(fs),
      view = await reopened.load();
    const recovered = await reopened.recover(view.pending[0]!.operationId, 'finish');
    expect(recovered.workspace.name).toBe('合成失败设置');
    expect(recovered.settings.defaultTarget).toBe('ChatGPT');
  });
  it('blocks transfer while an unfinished save exists and rejects orphan content', async () => {
    const { fs, runtime, project, prompt, root } = await fixture();
    fs.files.set('projects/orphan/prompts/P001/current.md', '合成孤立正文');
    await expect(captureSnapshot(fs)).rejects.toThrow('数据格式');
    fs.files.delete('projects/orphan/prompts/P001/current.md');
    fs.fail = (path) => path === [...root, 'meta.json'].join('/');
    await expect(runtime.checkpoint(project.id, prompt.id, '合成中断版本')).rejects.toThrow();
    fs.fail = null;
    await expect(captureSnapshot(fs)).rejects.toThrow('未完成');
  });
  it('persists settings and uses new default target for title-free creation', async () => {
    const { fs, runtime, project } = await fixture();
    await runtime.updateSettings({
      name: '合成更新空间',
      defaultTarget: 'ChatGPT',
      autosaveEnabled: false,
      autosaveDelayMs: 1500,
    });
    const reopened = await WorkspaceRuntime.open(fs);
    const view = await reopened.load();
    expect(view.workspace.name).toBe('合成更新空间');
    expect(view.settings.autosaveEnabled).toBe(false);
    expect((await reopened.createPrompt(project.id)).target).toBe('ChatGPT');
    expect(view.settings.autosaveDelayMs).toBe(1500);
  });
  it('changes a never-opened prompt state using disk body and checkpoints', async () => {
    const { fs, project, prompt } = await fixture();
    const runtime = await WorkspaceRuntime.open(fs);
    await runtime.load();
    const ready = await runtime.transitionStoredPrompt(project.id, prompt.id, 'ready');
    expect(ready.meta.currentVersion).toBe(2);
    expect(await runtime.readVersion(project.id, prompt.id, 2)).toBe('合成当前草稿');
  });
  it('does not accept externally changed metadata for a list action', async () => {
    const { fs, runtime, project, prompt, root } = await fixture();
    const path = [...root, 'meta.json'].join('/');
    fs.files.set(path, fs.files.get(path)!.replace('未命名提示词', '合成外部标题'));
    await expect(runtime.transitionStoredPrompt(project.id, prompt.id, 'ready')).rejects.toThrow(
      '外部修改',
    );
    expect(runtime.view().prompts[0]?.status).toBe('ready');
  });
  it('packs deleted prompts, immutable versions, optional files, and settings without unrelated root data', async () => {
    const { fs, runtime, project, prompt, root } = await fixture();
    fs.files.set('private-unrelated.txt', '合成无关资料');
    fs.files.set(`projects/${project.slug}/README.md`, '合成项目说明');
    fs.files.set([...root, 'result.md'].join('/'), '合成结果');
    await runtime.setPromptDeleted(project.id, prompt.id, true);
    const snapshot = await captureSnapshot(fs);
    const extracted = unzipSync(encodeArchive(snapshot));
    expect(extracted['private-unrelated.txt']).toBeUndefined();
    expect(strFromU8(extracted[[...root, 'versions', 'v001.md'].join('/')]!)).toBe(
      '合成第一版\n正文',
    );
    expect(
      JSON.parse(strFromU8(extracted[[...root, 'meta.json'].join('/')]!)).deletedAt,
    ).not.toBeNull();
    const target = new MemoryFileSystem();
    for (const [path, bytes] of Object.entries(extracted))
      await target.write(path.split('/'), strFromU8(bytes), null);
    const reopened = await WorkspaceRuntime.open(target);
    expect((await reopened.load()).prompts[0]?.deletedAt).not.toBeNull();
    expect((await reopened.openPrompt(project.id, prompt.id)).body).toBe('合成当前草稿');
  });
  it('copies and verifies workspace while keeping original source unchanged', async () => {
    const { fs, runtime, project, prompt } = await fixture();
    const before = new Map(fs.files),
      snapshot = await captureSnapshot(fs),
      target = new MemoryFileSystem();
    const migrated = await runtime.migrate(target, snapshot);
    expect(fs.files).toEqual(before);
    expect(migrated.workspace.id).toBe(runtime.workspace.id);
    expect(migrated.sessionId).not.toBe(runtime.sessionId);
    expect((await migrated.openPrompt(project.id, prompt.id)).body).toBe('合成当前草稿');
    expect((await captureSnapshot(target)).files).toEqual(snapshot.files);
  });
  it('rejects a nonempty destination and writes nothing', async () => {
    const { fs } = await fixture(),
      target = new MemoryFileSystem();
    target.files.set('synthetic-existing.txt', 'keep');
    await expect(copySnapshot(fs, target, await captureSnapshot(fs))).rejects.toThrow('空文件夹');
    expect(target.files.size).toBe(1);
  });
  it('detects source modification after confirmation before touching target', async () => {
    const { fs, root } = await fixture(),
      target = new MemoryFileSystem();
    const snapshot = await captureSnapshot(fs);
    fs.files.set([...root, 'current.md'].join('/'), '合成外部改动');
    await expect(copySnapshot(fs, target, snapshot)).rejects.toThrow('外部修改');
    expect(target.files.size).toBe(0);
  });
  it('keeps source intact and recovers interrupted migration before root marker existed', async () => {
    const { fs, root } = await fixture(),
      target = new MemoryFileSystem();
    const before = new Map(fs.files),
      snapshot = await captureSnapshot(fs);
    target.fail = (path) => path === [...root, 'meta.json'].join('/');
    await expect(copySnapshot(fs, target, snapshot)).rejects.toThrow();
    expect(fs.files).toEqual(before);
    expect(target.files.has('.promptdesk/workspace.json')).toBe(false);
    target.fail = null;
    const reopened = await WorkspaceRuntime.open(target);
    const view = await reopened.load();
    await reopened.recover(view.pending[0]!.operationId, 'finish');
    expect((await captureSnapshot(target)).files).toEqual(snapshot.files);
  });
  it('rejects unknown app files, orphan content, missing versions and pending operations', async () => {
    const { fs, root } = await fixture();
    fs.files.set('projects/unknown.txt', '合成未知文件');
    await expect(captureSnapshot(fs)).rejects.toThrow('无法识别');
    fs.files.delete('projects/unknown.txt');
    fs.files.delete([...root, 'versions', 'v001.md'].join('/'));
    await expect(captureSnapshot(fs)).rejects.toThrow('数据格式');
  });
  it('does not accept external write baselines when checking failed-save recovery', async () => {
    const { fs, runtime, project, prompt, root } = await fixture();
    fs.files.set([...root, 'current.md'].join('/'), '合成外部正文');
    await expect(runtime.saveDraft(project.id, prompt.id, '合成本地草稿')).rejects.toThrow(
      '外部修改',
    );
    await runtime.refreshPending();
    await expect(runtime.saveDraft(project.id, prompt.id, '合成本地草稿')).rejects.toThrow(
      '外部修改',
    );
    expect(fs.files.get([...root, 'current.md'].join('/'))).toBe('合成外部正文');
  });
});
