import { useCallback, useEffect, useRef, useState } from 'react';
import type { CloudPrompt, PromptPatch } from '../domain/cloud';
import { cloudClient, cloudErrorMessage } from '../services/api/cloudClient';

export function useCloudEditor(
  onSaved: (prompt: CloudPrompt) => void,
  onUnsaved: (unsaved: boolean) => void,
) {
  const [draft, setDraft] = useState<CloudPrompt | null>(null);
  const [saveState, setSaveState] = useState('尚未选择提示词');
  const current = useRef<CloudPrompt | null>(null),
    sequence = useRef(0),
    persisted = useRef(0),
    session = useRef(0);
  const queue = useRef<Promise<boolean>>(Promise.resolve(true));
  const savedCallback = useRef(onSaved);
  const paused = useRef(false);
  useEffect(() => {
    savedCallback.current = onSaved;
  }, [onSaved]);
  useEffect(() => {
    onUnsaved(sequence.current !== persisted.current);
  }, [draft, saveState, onUnsaved]);
  const select = useCallback((prompt: CloudPrompt | null) => {
    session.current++;
    sequence.current = 0;
    persisted.current = 0;
    paused.current = false;
    current.current = prompt;
    setDraft(prompt);
    setSaveState(prompt ? '已保存到服务器' : '尚未选择提示词');
  }, []);
  const edit = useCallback((patch: { title?: string; body?: string }) => {
    if (!current.current) return;
    sequence.current++;
    current.current = { ...current.current, ...patch };
    setDraft(current.current);
    setSaveState(paused.current ? '保存失败，草稿仍在本页面，请手动重试' : '未保存');
  }, []);
  const save = useCallback((patch: Omit<PromptPatch, 'revision'> = {}) => {
    const expectedSession = session.current;
    const job = async () => {
      const value = current.current;
      if (!value) return true;
      if (session.current !== expectedSession) return false;
      if (sequence.current === persisted.current && !Object.keys(patch).length) return true;
      const snapshotSequence = sequence.current;
      setSaveState('正在保存…');
      try {
        const stored = await cloudClient.save(value.id, {
          revision: value.revision,
          title: value.title,
          body: value.body,
          ...patch,
        });
        if (session.current !== expectedSession || current.current?.id !== stored.id) return false;
        // An old save may update the revision, but never replace text entered while it was in flight.
        current.current =
          sequence.current === snapshotSequence
            ? stored
            : { ...stored, title: current.current.title, body: current.current.body };
        persisted.current = snapshotSequence;
        paused.current = false;
        setDraft(current.current);
        setSaveState(sequence.current === snapshotSequence ? '已保存到服务器' : '未保存');
        savedCallback.current(stored);
        return true;
      } catch (error) {
        if (session.current === expectedSession) {
          paused.current = true;
          setSaveState(cloudErrorMessage(error));
        }
        return false;
      }
    };
    queue.current = queue.current.then(job, job);
    return queue.current;
  }, []);
  useEffect(() => {
    if (!draft || sequence.current === persisted.current || paused.current) return;
    const timer = window.setTimeout(() => void save(), 20_000);
    return () => window.clearTimeout(timer);
  }, [draft, save]);
  useEffect(() => {
    const sessionRef = session;
    const warn = (event: BeforeUnloadEvent) => {
      if (sequence.current !== persisted.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
      sessionRef.current++;
    };
  }, []);
  const flush = useCallback(async () => {
    do {
      if (!(await save())) return false;
    } while (sequence.current !== persisted.current);
    return true;
  }, [save]);
  return { draft, edit, select, save, flush, saveState, latest: () => current.current };
}
