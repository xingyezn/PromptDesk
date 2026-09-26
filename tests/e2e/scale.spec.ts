import { test, expect } from '@playwright/test';
import { installSyntheticPicker } from './synthetic-picker';
import { MemoryFileSystem } from '../fixtures/synthetic/memory-filesystem';
import { WorkspaceRuntime } from '../../src/services/workspace/runtime';

test('1000 synthetic prompts allow navigation, progressive search and cancellation', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const fs = new MemoryFileSystem(),
    runtime = await WorkspaceRuntime.create(fs, '合成规模工作空间');
  for (let projectIndex = 0; projectIndex < 10; projectIndex++) {
    const project = (await runtime.createProject(`合成规模项目 ${projectIndex}`)).projects.at(-1)!;
    for (let i = 0; i < 100; i++) {
      const prompt = await runtime.createPrompt(project.id, `合成规模提示词 ${i}`);
      await runtime.openPrompt(project.id, prompt.id);
      await runtime.saveDraft(project.id, prompt.id, `合成规模正文 标识-${projectIndex}-${i}`);
    }
  }
  await page.addInitScript(installSyntheticPicker, { migration: false, seedFiles: [...fs.files] });
  await page.goto('./');
  await page.getByRole('button', { name: '打开已有工作空间', exact: true }).click();
  await expect(page.locator('.queue-row')).toHaveCount(1000);
  await page.getByRole('button', { name: '建立全文索引', exact: true }).click();
  await expect(page.getByText(/全文索引 .*建立中/)).toBeVisible();
  await page.getByLabel('全局搜索', { exact: true }).fill('标识-5-99');
  await page.getByRole('button', { name: '取消索引', exact: true }).click();
  await expect(page.getByText(/已停止，当前结果不完整/)).toBeVisible();
  await page.getByRole('button', { name: '临时草稿', exact: true }).click();
  await expect(page.getByRole('heading', { name: '临时草稿', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '工作台', exact: true }).click();
  await page.getByRole('button', { name: '建立全文索引', exact: true }).click();
  await expect(page.getByText('全文索引 1000/1000 · 已完成', { exact: true })).toBeVisible({
    timeout: 45_000,
  });
  await page.getByLabel('全局搜索', { exact: true }).fill('标识-5-99');
  await expect(page.locator('.queue-row')).toHaveCount(1);
  await expect(page.locator('.queue-row')).toContainText('合成规模项目 5');
});
