import { useCallback, useEffect, useRef } from 'react';
import { useEditorStore } from '../stores/editor';
import { workspaceController as api } from '../services/workspace/controller';
import type { WorkspaceView } from '../services/workspace/runtime';

export function usePromptEditor(view: WorkspaceView | null, updateView: () => void) {
  const editor = useEditorStore();
  const activeSave = useRef<Promise<boolean> | null>(null);
  const flush = useCallback(async (): Promise<boolean> => {
    if (activeSave.current) {
      if (!(await activeSave.current)) return false;
    }
    const current = useEditorStore.getState();
    if (!current.document || current.editSeq === current.persistedSeq) return true;
    if (current.error) return false;
    const { meta } = current.document;
    const seq = current.editSeq,
      body = current.body;
    useEditorStore.setState({ saveState: 'saving' });
    const promise = (async () => {
      const result = await api.run((runtime) => runtime.saveDraft(meta.projectId, meta.id, body));
      if (!result.ok) {
        useEditorStore.setState({ saveState: 'failed', error: result.error });
        const pending = await api.run((runtime) => runtime.load());
        if (pending.ok) updateView();
        return false;
      }
      useEditorStore.setState((state) => ({
        document: result.value,
        persistedSeq: seq,
        saveState: state.editSeq === seq ? 'saved' : 'dirty',
        error: null,
      }));
      await api.clearRecoveryDraft(`prompt:${meta.projectId}:${meta.id}`, seq);
      updateView();
      return true;
    })();
    activeSave.current = promise;
    const ok = await promise;
    if (activeSave.current === promise) activeSave.current = null;
    if (!ok) return false;
    // Flush latest edits too when a navigation waits on a previously active save.
    const latest = useEditorStore.getState();
    if (latest.editSeq !== latest.persistedSeq) return flush();
    return true;
  }, [updateView]);
  useEffect(() => {
    if (!editor.document || editor.editSeq === editor.persistedSeq) return;
    const meta = editor.document.meta;
    void api.putRecoveryDraft({
      entityKey: `prompt:${meta.projectId}:${meta.id}`,
      body: editor.body,
      editSeq: editor.editSeq,
      baseContentHash: editor.document.baseContentHash,
    });
  }, [editor.body, editor.document, editor.editSeq, editor.persistedSeq]);
  useEffect(() => {
    if (!view?.settings.autosaveEnabled || editor.saveState !== 'dirty') return;
    const timer = setTimeout(() => {
      void flush();
    }, view.settings.autosaveDelayMs);
    return () => clearTimeout(timer);
  }, [
    editor.editSeq,
    editor.saveState,
    flush,
    view?.settings.autosaveEnabled,
    view?.settings.autosaveDelayMs,
  ]);
  useEffect(() => {
    const onUnload = (event: BeforeUnloadEvent) => {
      const state = useEditorStore.getState();
      if (state.editSeq !== state.persistedSeq) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);
  return { editor, flush };
}
