import { test, expect } from '@playwright/test';
import { installSyntheticPicker } from './synthetic-picker';
test('Markdown preview blocks remote resources and editing shortcuts never submit', async ({
  page,
  baseURL,
}) => {
  await page.addInitScript(installSyntheticPicker);
  const external: string[] = [],
    errors: string[] = [];
  const origin = new URL(baseURL ?? 'http://127.0.0.1:5173/').origin;
  page.on('request', (request) => {
    if (!request.url().startsWith(origin + '/') && !request.url().startsWith('data:'))
      external.push(request.url());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('./');
  await page.getByRole('button', { name: '创建新工作空间', exact: true }).click();
  await page.getByRole('button', { name: '确认', exact: true }).click();
  await page.getByRole('button', { name: '创建项目', exact: true }).click();
  await page.getByLabel('名称', { exact: true }).fill('合成安全项目');
  await page.getByRole('button', { name: '确认', exact: true }).click();
  await page.getByRole('button', { name: '新建 Prompt', exact: true }).last().click();
  const body = page.getByRole('textbox', { name: 'Prompt 正文' });
  await body.fill('合成文本');
  await body.press('Control+Enter');
  await body.press('Enter');
  await expect(page.getByLabel('Prompt 状态', { exact: true })).toHaveValue('draft');
  await expect(page.getByText('V0', { exact: true })).toBeVisible();
  await body.fill(
    '![合成远程图片](https://synthetic.invalid/private.png)\n\n<script>window.syntheticExecuted = true</script>\n\n[危险链接](javascript:alert(1))\n\n| 列 1 | 列 2 |\n| --- | --- |\n| A | B |',
  );
  await page.getByRole('button', { name: '预览', exact: true }).click();
  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.locator('.markdown-preview img')).toHaveCount(0);
  await expect(page.locator('.markdown-preview script')).toHaveCount(0);
  await expect(page.locator('.markdown-preview a[href^="javascript:"]')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '返回提示词列表' }).click();
  await expect(page.getByRole('button', { name: '拖动排序 P001' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});
