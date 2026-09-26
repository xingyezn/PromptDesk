import { describe, expect, it } from 'vitest';
import { validatePath, isBusinessPath } from '../../src/domain/paths';
import { nextPromptId, tokenEstimate } from '../../src/domain/policies';
import {
  parseDocument,
  workspaceSchema,
  baseDocument,
  newId,
  json,
} from '../../src/domain/schemas';

describe('domain safety', () => {
  it.each(['..', 'C:', 'a/b', 'a\\b', 'NUL', 'test.', ''])(
    'rejects unsafe segment %j',
    (segment) => {
      expect(() => validatePath([segment])).toThrow();
    },
  );
  it('only allows known business paths', () => {
    expect(
      isBusinessPath(['projects', 'my-project', 'prompts', 'P001', 'versions', 'v001.md']),
    ).toBe(true);
    expect(isBusinessPath(['private', 'research.md'])).toBe(false);
  });
  it('allocates after all existing numbers including deleted or corrupt entries', () => {
    expect(nextPromptId(['P001', 'P099', 'P1000', 'random'])).toBe('P1001');
  });
  it('rejects malformed JSON and future schema, preserves unknown fields', () => {
    expect(() => parseDocument(workspaceSchema, '{')).toThrow('JSON');
    expect(() => parseDocument(workspaceSchema, '{"schemaVersion":2}')).toThrow('更高版本');
    const value = {
      ...baseDocument(newId('op')),
      id: newId('workspace'),
      name: '合成空间',
      description: '',
      extra: 'preserved',
    };
    expect(parseDocument(workspaceSchema, json(value)).extra).toBe('preserved');
  });
  it('token estimate labels a deterministic rough count', () => {
    expect(tokenEstimate('')).toBe(0);
    expect(tokenEstimate('abcd')).toBe(1);
    expect(tokenEstimate('中文')).toBe(2);
  });
});
