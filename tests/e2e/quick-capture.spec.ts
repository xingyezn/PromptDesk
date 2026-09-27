import { test, expect } from '@playwright/test';

test('mobile quick capture saves locally, reloads, exports, and requires delete confirmation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./#/capture');
  await expect(page.getByRole('heading', { name: '先记下来。' })).toBeVisible();
  await expect(page.getByText(/与已授权的 Workspace Scratchpad 分开/)).toBeVisible();
  await page
    .getByRole('textbox', { name: '本机速记内容' })
    .fill('合成手机想法\n需要整理成下一条 Prompt');
  await page.getByRole('button', { name: '保存记录' }).click();
  await expect(page.getByRole('status')).toContainText('已保存到此浏览器的本机暂存区');
  await expect(page.locator('html')).toHaveJSProperty('scrollWidth', 390);
  await page.getByRole('textbox', { name: '本机速记内容' }).fill('这段修改还没有保存');
  await page.getByRole('button', { name: '返回 PromptDesk' }).click();
  await expect(page.getByRole('group', { name: '确认离开手机速记' })).toBeVisible();
  await page.getByRole('button', { name: '继续编辑' }).click();
  await expect(page.getByRole('textbox', { name: '本机速记内容' })).toHaveValue(
    '这段修改还没有保存',
  );
  await page.getByRole('button', { name: '返回 PromptDesk' }).click();
  await page.getByRole('button', { name: '丢弃修改并返回' }).click();

  await page.goto('./#/capture');
  await page.reload();
  await page.locator('.quick-note-select').click();
  await expect(page.getByRole('textbox', { name: '本机速记内容' })).toHaveValue(
    '合成手机想法\n需要整理成下一条 Prompt',
  );
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '导出全部记录（1）' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^promptdesk-quick-notes-.*\.json$/);

  await page.getByRole('button', { name: /删除本机记录/ }).click();
  await expect(page.getByRole('group', { name: '确认删除本机记录' })).toBeVisible();
  await page.getByRole('button', { name: '确认删除' }).click();
  await expect(page.getByText('还没有本机速记。')).toBeVisible();
});

test('production manifest and service worker stay within the Pages subpath', async ({
  page,
  baseURL,
}) => {
  test.skip(process.env.PROMPTDESK_PRODUCTION !== '1', 'Validates production Pages assets only');
  const basePath = new URL(baseURL ?? 'http://127.0.0.1:4174/PromptDesk/').pathname;
  const manifestResponse = await page.request.get(`${basePath}manifest.webmanifest`);
  expect(manifestResponse.ok()).toBe(true);
  const manifest = await manifestResponse.json();
  expect(manifest.start_url).toBe('/PromptDesk/#/capture');
  expect(manifest.scope).toBe('/PromptDesk/');
  expect(manifest.icons).toHaveLength(2);
  for (const icon of manifest.icons) {
    const iconResponse = await page.request.get(new URL(icon.src, baseURL).toString());
    expect(iconResponse.ok()).toBe(true);
    expect(iconResponse.headers()['content-type']).toContain('image/png');
  }
  const workerResponse = await page.request.get(`${basePath}sw.js`);
  expect(workerResponse.ok()).toBe(true);
  const worker = await workerResponse.text();
  expect(worker).toContain('manifest.webmanifest');
  expect(worker).toContain('icons/promptdesk-192.png');
  expect(worker).toMatch(/assets\/index-[A-Za-z0-9_-]+\.js/);
  expect(worker).not.toContain('/api/');

  await page.goto(`${basePath}#/capture`);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller));
  await page.getByRole('textbox', { name: '本机速记内容' }).fill('合成离线速记');
  await page.getByRole('button', { name: '保存记录' }).click();
  await expect(page.getByRole('status')).toContainText('已保存到此浏览器的本机暂存区');
  await page.context().setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: '先记下来。' })).toBeVisible();
  await page.locator('.quick-note-select').click();
  await expect(page.getByRole('textbox', { name: '本机速记内容' })).toHaveValue('合成离线速记');
  await page.context().setOffline(false);
});
