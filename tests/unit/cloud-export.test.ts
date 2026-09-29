import { describe, expect, it } from 'vitest';
import { cloudArchiveFiles, archiveSegment } from '../../src/domain/cloudExport';
import type { CloudExport } from '../../src/domain/cloud';

const data: CloudExport = {
  projects: [
    {
      project: {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'A/B: Project?',
        description: 'Synthetic description',
        color: 'green',
        sortOrder: 0,
        revision: 1,
        archived: 0,
        deletedAt: null,
        createdAt: '2026-09-29T00:00:00.000Z',
        updatedAt: '2026-09-29T00:00:00.000Z',
      },
      prompts: [
        {
          prompt: {
            id: '22222222-2222-4222-8222-222222222222',
            projectId: '11111111-1111-4111-8111-111111111111',
            title: 'First prompt',
            body: '1. hello',
            status: 'draft',
            priority: 'normal',
            sortOrder: 0,
            revision: 1,
            nextVersion: 2,
            deletedAt: null,
            createdAt: '2026-09-29T00:00:00.000Z',
            updatedAt: '2026-09-29T00:00:00.000Z',
          },
          versions: [
            {
              id: '33333333-3333-4333-8333-333333333333',
              promptId: '22222222-2222-4222-8222-222222222222',
              number: 1,
              body: '1. old',
              createdAt: '2026-09-29T00:00:00.000Z',
            },
          ],
        },
      ],
    },
  ],
};

describe('cloudArchiveFiles', () => {
  it('sanitizes path segments', () => {
    expect(archiveSegment('A/B: Project?', 'fallback')).toBe('A B Project');
    expect(archiveSegment('   ', 'fallback')).toBe('fallback');
  });
  it('builds a manifest, numbered prompt and version snapshots', () => {
    const files = cloudArchiveFiles(data);
    const paths = files.map((file) => file.path);
    expect(paths).toEqual([
      'PromptDesk/01-A B Project/manifest.json',
      'PromptDesk/01-A B Project/01-First prompt.md',
      'PromptDesk/01-A B Project/versions/01-First prompt-v001.md',
    ]);
    expect(files.find((file) => file.path.endsWith('01-First prompt.md'))?.content).toBe(
      '1. hello',
    );
    const manifest = JSON.parse(
      files.find((file) => file.path.endsWith('manifest.json'))!.content,
    ) as { prompts: { versions: number[]; status: string }[] };
    expect(manifest.prompts[0]!.versions).toEqual([1]);
    expect(manifest.prompts[0]!.status).toBe('draft');
  });
});
