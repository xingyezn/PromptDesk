import { test, expect } from '@playwright/test';
import { installSyntheticPicker } from './synthetic-picker';

test('synthetic UI workflow saves drafts, versions and restores current content', async ({
  page,
}) => {
  await page.addInitScript(installSyntheticPicker);
  await page.goto('/');
  await page.getByRole('button', { name: '创建新工作空间', exact: true }).click();
  await page.getByLabel('名称', { exact: true }).fill('合成 UI 工作空间');
  await page.getByRole('button', { name: '确认', exact: true }).click();
  await expect(page.getByText('合成 UI 工作空间', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '创建项目', exact: true }).click();
  await page.getByLabel('名称', { exact: true }).fill('合成 UI 项目');
  await page.getByRole('button', { name: '确认', exact: true }).click();
  await page.getByRole('button', { name: '新建 Prompt', exact: true }).last().click();
  await page.getByLabel('名称', { exact: true }).fill('合成 UI 提示词');
  await page.getByRole('button', { name: '确认', exact: true }).click();
  const body = page.getByRole('textbox', { name: 'Prompt 正文' });
  await body.fill('第一版提示词\n请保留中文与换行。');
  await expect(page.getByText('已保存到工作空间', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '保存版本', exact: true }).click();
  await expect(page.getByText('V1', { exact: true })).toBeVisible();
  await page.getByLabel('Prompt 状态', { exact: true }).selectOption('submitted');
  await expect(page.getByLabel('Prompt 状态', { exact: true })).toHaveValue('submitted');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: '复制 Prompt', exact: true }).click();
  await expect(page.getByLabel('Prompt 状态', { exact: true })).toHaveValue('submitted');
  // Windows clipboard may expose native CRLF; compare the same lines without changing app input.
  expect((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n')).toBe(
    '第一版提示词\n请保留中文与换行。',
  );
  await body.fill('第二版草稿');
  await expect(page.getByText('已保存到工作空间', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '版本 1', exact: true }).click();
  await page.getByRole('button', { name: '恢复', exact: true }).click();
  await page.getByRole('button', { name: '确认', exact: true }).click();
  await expect(body.locator('.cm-line')).toHaveText(['第一版提示词', '请保留中文与换行。']);
  await expect(page.getByLabel('Prompt 状态', { exact: true })).toHaveValue('submitted');
  await expect(page.getByRole('button', { name: '版本 3', exact: true })).toBeVisible();
});
