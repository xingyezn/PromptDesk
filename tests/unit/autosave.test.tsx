// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePromptEditor } from '../../src/hooks/usePromptEditor';
import { useEditorStore } from '../../src/stores/editor';
import {
  baseDocument,
  newId,
  promptSchema,
  workspaceSchema,
  settingsSchema,
} from '../../src/domain/schemas';
import type { OpenPrompt, WorkspaceView } from '../../src/services/workspace/runtime';
import { AppFault } from '../../src/types/errors';

const mock = vi.hoisted(() => ({ run: vi.fn(), clear: vi.fn(), put: vi.fn(), view: vi.fn() }));
vi.mock('../../src/services/workspace/controller', () => ({
  workspaceController: {
    run: mock.run,
    clearRecoveryDraft: mock.clear,
    putRecoveryDraft: mock.put,
    view: mock.view,
  },
}));
function fixture() {
  const operationId = newId('op'),
    workspaceId = newId('workspace');
  const meta = promptSchema.parse({
    ...baseDocument(operationId),
    id: 'P001',
    projectId: newId('project'),
    title: '合成自动保存',
    status: 'draft',
    target: 'Codex',
    order: 1,
    parentPromptId: null,
    tags: [],
    notes: '',
    submittedAt: null,
    completedAt: null,
    submittedVersion: null,
    currentVersion: 0,
    versions: [],
    deletedAt: null,
    statusHistory: [
      {
        id: newId('event'),
        operationId,
        from: null,
        to: 'draft',
        at: new Date().toISOString(),
        versionNumber: null,
        kind: 'created',
      },
    ],
  });
  const document: OpenPrompt = { meta, body: 'initial', baseContentHash: 'baseline' };
  const view: WorkspaceView = {
    sessionId: newId('session'),
    workspace: workspaceSchema.parse({
      ...baseDocument(operationId),
      id: workspaceId,
      name: '合成空间',
      description: '',
    }),
    settings: settingsSchema.parse({
      ...baseDocument(operationId),
      workspaceId,
      defaultTarget: 'Codex',
      autosaveEnabled: false,
      autosaveDelayMs: 800,
    }),
    projects: [],
    prompts: [meta],
    scratchpads: [],
    issues: [],
    pending: [],
    writable: true,
  };
  useEditorStore.getState().load(document);
  mock.view.mockReturnValue(view);
  return { document, view };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useEditorStore.getState().load(null);
});
describe('autosave coordinator', () => {
  it('ignores an old save completion after the workspace session changes', async () => {
    const { document, view } = fixture();
    const first = deferred<{ ok: true; value: OpenPrompt }>();
    mock.run.mockReturnValueOnce(first.promise);
    const { result } = renderHook(() => usePromptEditor(view, () => undefined));
    act(() => useEditorStore.getState().edit('old session text'));
    let saving: Promise<boolean>;
    act(() => {
      saving = result.current.flush();
    });
    act(() => {
      mock.view.mockReturnValue({ ...view, sessionId: newId('session') });
      useEditorStore.getState().load({ ...document, body: 'new session text' });
    });
    await act(async () => {
      first.resolve({ ok: true, value: { ...document, body: 'old session text' } });
      await saving!;
    });
    expect(useEditorStore.getState().body).toBe('new session text');
    expect(useEditorStore.getState().document?.body).toBe('new session text');
  });
  it('does not mark a newer edit saved when an old in-flight write completes', async () => {
    const { document, view } = fixture();
    const first = deferred<{ ok: true; value: OpenPrompt }>();
    const second = deferred<{ ok: true; value: OpenPrompt }>();
    mock.run.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => usePromptEditor(view, () => undefined));
    act(() => useEditorStore.getState().edit('first edit'));
    let saving: Promise<boolean>;
    act(() => {
      saving = result.current.flush();
    });
    act(() => useEditorStore.getState().edit('newest edit'));
    await act(async () => {
      first.resolve({ ok: true, value: { ...document, body: 'first edit' } });
      await first.promise;
    });
    expect(useEditorStore.getState().body).toBe('newest edit');
    expect(useEditorStore.getState().persistedSeq).toBe(1);
    expect(useEditorStore.getState().saveState).not.toBe('saved');
    await act(async () => {
      second.resolve({ ok: true, value: { ...document, body: 'newest edit' } });
      await saving!;
    });
    await waitFor(() => expect(useEditorStore.getState().saveState).toBe('saved'));
    expect(useEditorStore.getState().persistedSeq).toBe(2);
  });
  it('retains draft and reports failure instead of claiming it was persisted', async () => {
    const { view } = fixture();
    mock.run
      .mockResolvedValueOnce({ ok: false, error: new AppFault('PERMISSION_DENIED') })
      .mockResolvedValueOnce({ ok: true, value: view });
    const { result } = renderHook(() => usePromptEditor(view, () => undefined));
    act(() => useEditorStore.getState().edit('never discard this'));
    let outcome = false;
    await act(async () => {
      outcome = await result.current.flush();
    });
    expect(outcome).toBe(false);
    expect(useEditorStore.getState().body).toBe('never discard this');
    expect(useEditorStore.getState().persistedSeq).toBe(0);
    expect(useEditorStore.getState().saveState).toBe('failed');
  });
});
