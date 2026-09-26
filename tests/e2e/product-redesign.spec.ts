import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { installSyntheticPicker } from './synthetic-picker';

test('split selected prompt text and edit priority without changing the selected prompt', async ({
  page,
}) => {
  await page.addInitScript(installSyntheticPicker);
  await page.goto('./');
  await page.getByRole('button', { name: '创建新工作空间', exact: true }).click();
  await page.getByLabel('名称', { exact: true }).fill('合成拆分空间');
  await page.getByRole('button', { name: '确认', exact: true }).click();
  await page.getByRole('button', { name: '创建项目', exact: true }).click();
  await page.getByLabel('名称', { exact: true }).fill('合成拆分项目');
  await page.getByRole('button', { name: '确认', exact: true }).click();
  await page.getByRole('button', { name: '新建 Prompt', exact: true }).last().click();
  const body = page.getByRole('textbox', { name: 'Prompt 正文' });
  await body.fill('原条目保留\n拆分出来的正文');
  await body.press('Home');
  await body.press('Shift+End');
  await page.getByRole('button', { name: '拆分选中内容', exact: true }).click();
  await page.getByLabel('新 Prompt 标题', { exact: true }).fill('合成拆分后的提示词');
  await page.getByRole('button', { name: '确认', exact: true }).click();
  await expect(page.getByText('P002 / PROMPT', { exact: true })).toBeVisible();
  await expect(body).toContainText('拆分出来的正文');
  await expect(page.getByLabel('P002 优先级', { exact: true })).toHaveValue('normal');
  await page.getByLabel('P002 优先级', { exact: true }).selectOption('high');
  await expect(page.getByLabel('P002 优先级', { exact: true })).toHaveValue('high');
  await expect(page.getByLabel('P002 标记已完成', { exact: true })).not.toBeChecked();
});

test('previews and confirms a v1 workspace state migration before opening it', async ({ page }) => {
  const createdAt = '2026-01-01T00:00:00.000Z';
  const operationId = 'op_11111111-1111-4111-8111-111111111111';
  const workspaceId = 'workspace_22222222-2222-4222-8222-222222222222';
  const projectId = 'project_33333333-3333-4333-8333-333333333333';
  const body = '合成旧版本正文';
  const contentHash = createHash('sha256').update(body, 'utf8').digest('hex');
  const legacyBase = {
    schemaVersion: 1,
    revision: 0,
    lastOperationId: operationId,
    createdAt,
    updatedAt: createdAt,
  };
  const files: [string, string][] = [
    [
      '.promptdesk/workspace.json',
      JSON.stringify({ ...legacyBase, id: workspaceId, name: '合成 v1 空间', description: '' }),
    ],
    [
      '.promptdesk/settings.json',
      JSON.stringify({
        ...legacyBase,
        workspaceId,
        defaultTarget: 'Codex',
        autosaveEnabled: true,
        autosaveDelayMs: 800,
      }),
    ],
    [
      'projects/legacy-project/project.json',
      JSON.stringify({
        ...legacyBase,
        id: projectId,
        name: '合成旧项目',
        slug: 'legacy-project',
        description: '',
        status: 'active',
        tags: [],
        deletedAt: null,
      }),
    ],
    [
      'projects/legacy-project/prompts/P001/meta.json',
      JSON.stringify({
        ...legacyBase,
        id: 'P001',
        projectId,
        title: '合成旧归档项',
        status: 'archived',
        target: 'Codex',
        order: 1,
        parentPromptId: null,
        tags: [],
        notes: '',
        submittedAt: null,
        completedAt: null,
        submittedVersion: null,
        currentVersion: 1,
        versions: [
          {
            number: 1,
            fileName: 'v001.md',
            createdAt,
            reason: 'manual',
            note: '',
            contentHash,
            restoredFrom: null,
            operationId,
          },
        ],
        statusHistory: [
          {
            id: 'event_44444444-4444-4444-8444-444444444444',
            operationId,
            from: null,
            to: 'archived',
            at: createdAt,
            versionNumber: null,
            kind: 'created',
          },
        ],
        deletedAt: null,
      }),
    ],
    ['projects/legacy-project/prompts/P001/current.md', body],
    ['projects/legacy-project/prompts/P001/versions/v001.md', body],
  ];
  await page.addInitScript(installSyntheticPicker, { seedFiles: files });
  await page.goto('./');
  await page.getByRole('button', { name: '打开已有工作空间', exact: true }).click();
  await expect(page.getByRole('heading', { name: '确认状态归并', exact: true })).toBeVisible();
  const confirm = page.getByRole('button', { name: '确认升级并打开', exact: true });
  await expect(confirm).toBeDisabled();
  await page.getByLabel('P001 的迁移状态', { exact: true }).selectOption('completed');
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await page.getByRole('button', { name: '合成旧项目', exact: true }).click();
  await page.getByRole('tab', { name: '已完成 1', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '打开 P001 合成旧归档项', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '打开 P001 合成旧归档项', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Prompt 正文' })).toContainText(body);
});

test('shows recovery for an interrupted migration and returns to preview after rollback', async ({
  page,
}) => {
  const createdAt = '2026-01-01T00:00:00.000Z';
  const workspaceId = 'workspace_22222222-2222-4222-8222-222222222222';
  const operationId = 'op_11111111-1111-4111-8111-111111111111';
  const legacyBase = {
    schemaVersion: 1,
    revision: 0,
    lastOperationId: operationId,
    createdAt,
    updatedAt: createdAt,
  };
  const workspaceBefore = JSON.stringify({
    ...legacyBase,
    id: workspaceId,
    name: '合成中断升级空间',
    description: '',
  });
  const workspaceAfter = JSON.stringify({
    ...legacyBase,
    schemaVersion: 2,
    revision: 1,
    lastOperationId: operationId,
    id: workspaceId,
    name: '合成中断升级空间',
    description: '',
  });
  const hash = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
  const manifest = {
    schemaVersion: 1,
    operationId,
    workspaceId,
    kind: 'migration',
    createdAt,
    phase: 'prepared',
    commitMarkerPath: ['.promptdesk', 'workspace.json'],
    entries: [
      {
        targetPath: ['.promptdesk', 'workspace.json'],
        before: { snapshotPath: ['before', '0001.txt'], sha256: hash(workspaceBefore) },
        after: { snapshotPath: ['after', '0001.txt'], sha256: hash(workspaceAfter) },
      },
    ],
  };
  const seedFiles: [string, string][] = [
    ['.promptdesk/workspace.json', workspaceBefore],
    [
      '.promptdesk/settings.json',
      JSON.stringify({
        ...legacyBase,
        workspaceId,
        defaultTarget: 'Codex',
        autosaveEnabled: true,
        autosaveDelayMs: 800,
      }),
    ],
    ['.promptdesk/pending/' + operationId + '/before/0001.txt', workspaceBefore],
    ['.promptdesk/pending/' + operationId + '/after/0001.txt', workspaceAfter],
    ['.promptdesk/pending/' + operationId + '/manifest.json', JSON.stringify(manifest)],
  ];
  await page.addInitScript(installSyntheticPicker, {
    seedFiles,
  });
  await page.goto('./');
  await page.getByRole('button', { name: '打开已有工作空间', exact: true }).click();
  await expect(page.getByRole('heading', { name: '升级过程曾中断', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '回退并重新预览', exact: true }).click();
  await expect(page.getByRole('heading', { name: '确认状态归并', exact: true })).toBeVisible();
});
