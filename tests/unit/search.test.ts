import { describe, expect, it } from 'vitest';
import { parseSearchText, matchesSearch, type SearchFilters } from '../../src/domain/search';
import { WorkspaceRuntime } from '../../src/services/workspace/runtime';
import { MemoryFileSystem } from '../fixtures/synthetic/memory-filesystem';
import { formatSelection } from '../../src/domain/formatting';

describe('local search and formatting rules', () => {
  it('parses combined filters, quoted projects and reports unsupported filters', () => {
    expect(parseSearchText('正文 status:待提交 model:Codex project:"合成 项目" tag:规划')).toEqual({
      query: '正文',
      filters: { status: 'ready', target: 'Codex', projectName: '合成 项目', tag: '规划' },
      unknown: [],
    });
    expect(parseSearchText('unknown:abc status:nope').unknown).toEqual([
      'unknown:abc',
      'status:nope',
    ]);
  });
  it('matches body with AND filters and excludes deleted or archived entries', async () => {
    const runtime = await WorkspaceRuntime.create(new MemoryFileSystem(), '合成搜索');
    const project = (await runtime.createProject('合成项目')).projects[0]!;
    const meta = await runtime.createPrompt(project.id);
    const document = {
      meta: { ...meta, tags: ['规划'] },
      project,
      body: '正文 专用关键词',
      unavailable: false,
    };
    const filters: SearchFilters = {
      query: '正文 专用关键词',
      projectId: project.id,
      status: 'draft',
      target: 'codex',
      tag: '规划',
      includeArchived: false,
    };
    expect(matchesSearch(document, filters)).toBe(true);
    expect(matchesSearch(document, { ...filters, status: 'completed' })).toBe(false);
    expect(
      matchesSearch(
        { ...document, meta: { ...document.meta, deletedAt: new Date().toISOString() } },
        filters,
      ),
    ).toBe(false);
    expect(
      matchesSearch({ ...document, project: { ...project, status: 'archived' } }, filters),
    ).toBe(false);
  });
  it('escapes table pipes and nests code fences without closing them prematurely', () => {
    expect(formatSelection('table', '甲\t乙\nA|B\tC')).toBe(
      '| 甲 | 乙 |\n| --- | --- |\n| A\\|B | C |',
    );
    expect(formatSelection('code', '```\nx\n```')).toBe('````\n```\nx\n```\n````');
    expect(formatSelection('numbered', '- first\n- second')).toBe('1. first\n2. second');
  });
});
