import { test, expect } from '@playwright/test';
test('launcher is usable, has no remote resources, and survives a hash refresh', async ({
  page,
}) => {
  const errors: string[] = [];
  const external: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1:5173/') && !request.url().startsWith('data:'))
      external.push(request.url());
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '先写好， 再出发。' })).toBeVisible();
  await expect(page.getByRole('button', { name: '打开已有工作空间' })).toBeVisible();
  await expect(page.getByRole('button', { name: '创建新工作空间' })).toBeVisible();
  await page.goto('/#/settings');
  await page.reload();
  await expect(page.getByRole('button', { name: '打开已有工作空间' })).toBeVisible();
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});
