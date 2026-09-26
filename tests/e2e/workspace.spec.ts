import { test, expect } from '@playwright/test';
import { installSyntheticPicker } from './synthetic-picker';

test('synthetic UI workflow saves drafts, versions and restores current content', async ({
  page,
}) => {
  await page.addInitScript(installSyntheticPicker);
  await page.goto('./');
  await page.getByRole('button', { name: '创建新工作空间', exact: true }).click();
  await page.getByLabel('名称', { exact: true }).fill('合成 UI 工作空间');
  await page.getByRole('button', { name: '确认', exact: true }).click();
  await expect(page.getByText('合成 UI 工作空间', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '创建项目', exact: true }).click();
  await page.getByLabel('名称', { exact: true }).fill('合成 UI 项目');
  await page.getByRole('button', { name: '确认', exact: true }).click();
  await page.getByRole('button', { name: '新建 Prompt', exact: true }).last().click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const body = page.getByRole('textbox', { name: 'Prompt 正文' });
  await body.fill('第一版提示词\n请保留中文与换行。');
  await expect(page.getByText('已保存到工作空间', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '保存版本', exact: true }).click();
  await expect(page.getByText('V1', { exact: true })).toBeVisible();
  await page.getByLabel('Prompt 状态', { exact: true }).selectOption('ready');
  await expect(page.getByLabel('Prompt 状态', { exact: true })).toHaveValue('ready');
  await page.evaluate(() => {
    const synthetic = (
      window as Window & {
        promptdeskSyntheticFailure?: { failCleanupOnce: boolean };
      }
    ).promptdeskSyntheticFailure;
    if (synthetic) synthetic.failCleanupOnce = true;
  });
  await body.fill('已提交但日志待清理');
  await expect(page.getByText('保存已成功，待清理临时日志', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: '回退本次保存', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '完成清理', exact: true }).click();
  await expect(body).toHaveText('已提交但日志待清理');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: '复制 Prompt', exact: true }).click();
  await expect(page.getByLabel('Prompt 状态', { exact: true })).toHaveValue('ready');
  // Windows clipboard may expose native CRLF; compare the same lines without changing app input.
  expect((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n')).toBe(
    '已提交但日志待清理',
  );
  await body.fill('第二版草稿');
  await expect(page.getByText('已保存到工作空间', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '版本 1', exact: true }).click();
  await page.getByRole('button', { name: '恢复', exact: true }).click();
  await page.getByRole('button', { name: '确认', exact: true }).click();
  await expect(body.locator('.cm-line')).toHaveText(['第一版提示词', '请保留中文与换行。']);
  await expect(page.getByLabel('Prompt 状态', { exact: true })).toHaveValue('ready');
  await expect(page.getByRole('button', { name: '版本 3', exact: true })).toBeVisible();
});
