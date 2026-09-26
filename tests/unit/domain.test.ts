import { describe, expect, it } from 'vitest';
import { validatePath, isBusinessPath } from '../../src/domain/paths';
import {
  checkpointRequired,
  nextPromptId,
  ordered,
  tokenEstimate,
  validateTransition,
} from '../../src/domain/policies';
import { invalidPromptRelations } from '../../src/domain/relations';
import {
  parseDocument,
  promptIdSchema,
  promptSchema,
  slugSchema,
  workspaceSchema,
  baseDocument,
  newId,
  json,
} from '../../src/domain/schemas';
import { sha256 } from '../../src/utils/hash';

const at = '2026-01-01T00:00:00.000Z';
const projectId = 'project_33333333-3333-4333-8333-333333333333';
function prompt(id: string, order: number, parentPromptId: string | null = null) {
  const operationId = 'op_11111111-1111-4111-8111-111111111111';
  return promptSchema.parse({
    ...baseDocument(operationId),
    id,
    projectId,
    title: id,
    status: 'draft',
    priority: 'normal',
    target: 'Codex',
    order,
    parentPromptId,
    tags: [],
    notes: '',
    submittedAt: null,
    completedAt: null,
    submittedVersion: null,
    currentVersion: 0,
    versions: [],
    statusHistory: [
      {
        id: 'event_44444444-4444-4444-8444-444444444444',
        operationId,
        from: null,
        to: 'draft',
        at,
        versionNumber: null,
        kind: 'created',
      },
    ],
    deletedAt: null,
  });
}

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
  it.each([
    { path: ['projects', 'valid-project', 'prompts', 'P01', 'current.md'] },
    { path: ['projects', 'valid-project', 'prompts', 'P001', 'versions', 'v001.md', 'extra'] },
    {
      path: ['.promptdesk', 'pending', 'op_11111111-1111-4111-8111-111111111111', 'manifest.json'],
    },
  ])('rejects paths outside the exact application allowlist: $path', ({ path }) => {
    expect(isBusinessPath(path)).toBe(false);
  });
  it('validates Prompt IDs and slugs before they can form paths', () => {
    expect(promptIdSchema.safeParse('P001').success).toBe(true);
    expect(promptIdSchema.safeParse('P000').success).toBe(false);
    expect(promptIdSchema.safeParse('P9007199254740992').success).toBe(false);
    expect(slugSchema.safeParse('a-valid-project').success).toBe(true);
    expect(slugSchema.safeParse('CON').success).toBe(false);
    expect(slugSchema.safeParse('a--project').success).toBe(false);
  });
  it('detects missing parents, cycles and broken active ordering without conflating projects', () => {
    const missingParent = prompt('P001', 1, 'P002');
    const firstCycleMember = prompt('P003', 1, 'P004');
    const secondCycleMember = prompt('P004', 2, 'P003');
    const unrelated = {
      ...prompt('P001', 1),
      projectId: 'project_55555555-5555-4555-8555-555555555555',
    };
    const invalid = invalidPromptRelations([
      missingParent,
      firstCycleMember,
      secondCycleMember,
      unrelated,
    ]);
    expect(invalid).toEqual(
      new Set([
        'project_33333333-3333-4333-8333-333333333333:P001',
        'project_33333333-3333-4333-8333-333333333333:P003',
        'project_33333333-3333-4333-8333-333333333333:P004',
      ]),
    );
    expect(
      invalidPromptRelations([prompt('P001', 1), prompt('P002', 3)], new Set([projectId])),
    ).toEqual(new Set());
  });
  it('uses explicit order and checkpoint policy for the three current statuses', () => {
    expect(ordered([prompt('P002', 2), prompt('P001', 1)]).map((item) => item.id)).toEqual([
      'P001',
      'P002',
    ]);
    expect(checkpointRequired('draft')).toBe(false);
    expect(checkpointRequired('ready')).toBe(true);
    expect(checkpointRequired('completed')).toBe(true);
    const item = prompt('P001', 1);
    expect(() => validateTransition(item, 'ready', '  ')).toThrow();
    expect(() => validateTransition(item, 'completed', '\n')).toThrow();
    expect(() => validateTransition(item, 'draft', '')).not.toThrow();
    expect(() => validateTransition(item, 'ready', '正文')).not.toThrow();
    expect(() => validateTransition({ ...item, deletedAt: at }, 'draft', '正文')).toThrow();
  });
  it('hashes UTF-8 bytes deterministically', async () => {
    await expect(sha256('合成正文\nabc')).resolves.toBe(
      'bcf6305bb3c8ef59874aee21586a6eaf2ea5c14340d8639ca94889e81a14d306',
    );
  });
  it('allocates after all existing numbers including deleted or corrupt entries', () => {
    expect(nextPromptId(['P001', 'P099', 'P1000', 'random'])).toBe('P1001');
  });
  it('rejects malformed JSON and future schema, preserves unknown fields', () => {
    expect(() => parseDocument(workspaceSchema, '{')).toThrow('JSON');
    expect(() => parseDocument(workspaceSchema, '{"schemaVersion":3}')).toThrow('更高版本');
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
