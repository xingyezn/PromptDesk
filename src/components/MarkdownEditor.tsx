import { useEffect, useRef, useState } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownKeymap } from '@codemirror/lang-markdown';
import { formatLabels, formatSelection, type FormatKind } from '../domain/formatting';

export function MarkdownEditor({
  body,
  readonly,
  onChange,
  fontSize = 15,
  onFontSizeChange,
  onSplitSelection,
}: {
  body: string;
  readonly: boolean;
  onChange: (body: string) => void;
  fontSize?: number;
  onFontSizeChange?: (fontSize: number) => void;
  onSplitSelection?: (selected: string, from: number, to: number) => void;
}) {
  const [hasSelection, setHasSelection] = useState(false);
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
          keymap.of([...markdownKeymap, ...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          EditorView.editable.of(!readonly),
          EditorState.readOnly.of(readonly),
          EditorView.contentAttributes.of({ 'aria-label': 'Prompt 正文' }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !syncing.current)
              callback.current(update.state.doc.toString());
            if (update.selectionSet) {
              const { from, to } = update.state.selection.main;
              setHasSelection(to > from);
            }
          }),
          EditorView.theme({
            '&': { height: '100%', fontSize: 'inherit' },
            '.cm-scroller': {
              overflow: 'auto',
              fontFamily: 'ui-monospace, Consolas, monospace',
              lineHeight: '1.8',
            },
            '.cm-content': { padding: '12px 10px' },
            '.cm-gutters': { backgroundColor: '#fafbf9', border: 'none', color: '#a5aca5' },
            '&.cm-focused': { outline: 'none' },
            '.cm-line': { padding: '0 8px' },
          }),
        ],
      }),
    });
    view.current = editor;
    if (!readonly) editor.focus();
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
  const applyFormat = (kind: FormatKind) => {
    const editor = view.current;
    if (!editor || readonly) return;
    const { from, to } = editor.state.selection.main;
    const block = kind !== 'bold';
    const start = block ? editor.state.doc.lineAt(from).from : from;
    const end = block ? editor.state.doc.lineAt(to > from ? to - 1 : to).to : to;
    const insert = formatSelection(kind, editor.state.sliceDoc(start, end));
    editor.dispatch({
      changes: { from: start, to: end, insert },
      selection: { anchor: start + insert.length },
      userEvent: 'input',
    });
    editor.focus();
  };
  return (
    <div className="markdown-composer">
      <div className="format-toolbar" role="toolbar" aria-label="Markdown 格式">
        {(Object.keys(formatLabels) as FormatKind[]).map((kind) => (
          <button
            key={kind}
            type="button"
            disabled={readonly}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => applyFormat(kind)}
          >
            {formatLabels[kind]}
          </button>
        ))}
        {onSplitSelection && (
          <button
            type="button"
            disabled={readonly || !hasSelection}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              const editor = view.current;
              if (!editor) return;
              const { from, to } = editor.state.selection.main;
              if (to > from) onSplitSelection(editor.state.sliceDoc(from, to), from, to);
            }}
          >
            拆分选中内容
          </button>
        )}
        <small>选择多行可转列表；制表符分隔文本可转表格</small>
        {onFontSizeChange && (
          <div className="editor-font-size" aria-label="编辑区文字大小">
            <button
              type="button"
              aria-label="缩小编辑区文字"
              disabled={readonly || fontSize <= 12}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onFontSizeChange(Math.max(12, fontSize - 1))}
            >
              A−
            </button>
            <span aria-live="polite">{fontSize}px</span>
            <button
              type="button"
              aria-label="放大编辑区文字"
              disabled={readonly || fontSize >= 24}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onFontSizeChange(Math.min(24, fontSize + 1))}
            >
              A+
            </button>
          </div>
        )}
      </div>
      <div className="markdown-editor" ref={host} style={{ fontSize: `${fontSize}px` }} />
    </div>
  );
}
