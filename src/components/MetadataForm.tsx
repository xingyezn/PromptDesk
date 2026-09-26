import { useState } from 'react';
export interface MetadataInput {
  name: string;
  tags: string[];
  description: string;
  target: string;
  notes: string;
}
export function MetadataForm({
  initial,
  kind,
  disabled,
  onSave,
}: {
  initial: MetadataInput;
  kind: 'project' | 'prompt';
  disabled: boolean;
  onSave: (input: MetadataInput) => Promise<void>;
}) {
  const [input, setInput] = useState(initial),
    [tags, setTags] = useState(initial.tags.join(', '));
  return (
    <form
      className="metadata-form"
      onSubmit={(event) => {
        event.preventDefault();
        void onSave({
          ...input,
          tags: [
            ...new Set(
              tags
                .split(/[,，]/)
                .map((tag) => tag.trim())
                .filter(Boolean),
            ),
          ],
        });
      }}
    >
      <label>
        {kind === 'project' ? '项目名称' : 'Prompt 标题'}
        <input
          value={input.name}
          maxLength={200}
          disabled={disabled}
          onChange={(event) => setInput({ ...input, name: event.target.value })}
        />
      </label>
      <label>
        标签（用逗号分隔）
        <input value={tags} disabled={disabled} onChange={(event) => setTags(event.target.value)} />
      </label>
      {kind === 'project' ? (
        <label>
          项目说明
          <textarea
            value={input.description}
            maxLength={10000}
            disabled={disabled}
            onChange={(event) => setInput({ ...input, description: event.target.value })}
          />
        </label>
      ) : (
        <>
          <label>
            目标模型
            <input
              value={input.target}
              maxLength={100}
              disabled={disabled}
              onChange={(event) => setInput({ ...input, target: event.target.value })}
            />
          </label>
          <label>
            Prompt 备注
            <textarea
              value={input.notes}
              maxLength={10000}
              disabled={disabled}
              onChange={(event) => setInput({ ...input, notes: event.target.value })}
            />
          </label>
        </>
      )}
      <footer>
        <button
          className="primary"
          disabled={disabled || !input.name.trim() || (kind === 'prompt' && !input.target.trim())}
        >
          保存资料
        </button>
      </footer>
    </form>
  );
}
