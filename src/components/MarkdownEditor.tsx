import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';

export function MarkdownEditor({
  body,
  readonly,
  onChange,
}: {
  body: string;
  readonly: boolean;
  onChange: (body: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    view = useRef<EditorView | null>(null);
  const callback = useRef(onChange);
  const syncing = useRef(false);
  useEffect(() => {
    callback.current = onChange;
  }, [onChange]);
  useEffect(() => {
    if (!host.current) return;
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: body,
        extensions: [
          markdown(),
          lineNumbers(),
          drawSelection(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          EditorView.editable.of(!readonly),
          EditorState.readOnly.of(readonly),
          EditorView.contentAttributes.of({ 'aria-label': 'Prompt 正文' }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !syncing.current)
              callback.current(update.state.doc.toString());
          }),
          EditorView.theme({
            '&': { height: '100%', fontSize: '15px' },
            '.cm-scroller': {
              overflow: 'auto',
              fontFamily: 'ui-monospace, Consolas, monospace',
              lineHeight: '1.8',
            },
            '.cm-content': { padding: '28px 16px' },
            '.cm-gutters': { backgroundColor: '#fafbf9', border: 'none', color: '#a5aca5' },
            '&.cm-focused': { outline: 'none' },
            '.cm-line': { padding: '0 8px' },
          }),
        ],
      }),
    });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = null;
    };
    // Recreate only on read-only changes; external document text is synchronized below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readonly]);
  useEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== body) {
      syncing.current = true;
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: body } });
      syncing.current = false;
    }
  }, [body]);
  return <div className="markdown-editor" ref={host} />;
}
