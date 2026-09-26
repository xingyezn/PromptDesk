import { create } from 'zustand';
import type { OpenPrompt } from '../services/workspace/runtime';
import type { AppFault } from '../types/errors';
export type SaveState = 'saved' | 'dirty' | 'saving' | 'failed';
interface EditorState {
  document: OpenPrompt | null;
  body: string;
  editSeq: number;
  persistedSeq: number;
  saveState: SaveState;
  error: AppFault | null;
  load: (document: OpenPrompt | null) => void;
  edit: (body: string) => void;
}
export const useEditorStore = create<EditorState>((set) => ({
  document: null,
  body: '',
  editSeq: 0,
  persistedSeq: 0,
  saveState: 'saved',
  error: null,
  load: (document) =>
    set({
      document,
      body: document?.body ?? '',
      editSeq: 0,
      persistedSeq: 0,
      saveState: 'saved',
      error: null,
    }),
  edit: (body) =>
    set((state) => ({
      body,
      editSeq: state.editSeq + 1,
      saveState: state.error ? 'failed' : 'dirty',
    })),
}));
