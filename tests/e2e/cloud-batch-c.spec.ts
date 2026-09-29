import { expect, test } from '@playwright/test';

test('batch C: create a public read-only share link and revoke it', async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin,
    password = `Synthetic-${crypto.randomUUID()}-12`;
  await context.setExtraHTTPHeaders({ 'cf-connecting-ip': '192.0.2.12' });
  const signup = await context.request.post(`${origin}/api/auth/sign-up/email`, {
    headers: { origin },
    data: {
      name: 'Synthetic Batch C User',
      email: `cloud-batch-c-${crypto.randomUUID()}@example.test`,
      password,
    },
  });
  expect(signup.status()).toBe(200);
  try {
    await page.goto('/');
    await page.getByRole('button', { name: '新建项目', exact: true }).click();
    await page.getByRole('textbox', { name: '项目名称', exact: true }).fill('Share Project');
    await page.getByRole('button', { name: '创建', exact: true }).click();
    await page.getByRole('button', { name: '新建', exact: true }).click();
    await page.getByRole('textbox', { name: 'Prompt 正文' }).fill('Shared body text');
    await page.getByRole('button', { name: '保存提示词', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: '已保存到服务器' })).toBeVisible();

    await page.getByRole('button', { name: '修改项目信息' }).click();
    await page.getByRole('button', { name: '分享链接', exact: true }).click();
    await page.getByRole('button', { name: '创建分享链接', exact: true }).click();
    const link = await page.getByLabel('分享链接').inputValue();
    expect(link).toContain('#/share/');

    // A visitor with no account can read the shared project.
    const visitor = await browser.newContext();
    try {
      const visitorPage = await visitor.newPage();
      await visitorPage.goto(link);
      await expect(visitorPage.getByRole('heading', { name: 'Share Project' })).toBeVisible();
      await expect(visitorPage.getByText('Shared body text')).toBeVisible();
      await expect(visitorPage.getByRole('button', { name: /账户/ })).toHaveCount(0);
    } finally {
      await visitor.close();
    }

    // Revoking invalidates the link immediately.
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: '撤销分享', exact: true }).click();
    await page.getByRole('button', { name: '创建分享链接', exact: true }).waitFor();
    const blocked = await browser.newContext();
    try {
      const blockedPage = await blocked.newPage();
      await blockedPage.goto(link);
      await expect(blockedPage.getByRole('alert')).toBeVisible();
      await expect(blockedPage.getByRole('heading', { name: 'Share Project' })).toHaveCount(0);
    } finally {
      await blocked.close();
    }
  } finally {
    test.setTimeout(120000);
    const cleanup = await context.request.post(`${origin}/api/auth/delete-user`, {
      headers: { origin },
      data: { password },
    });
    expect(cleanup.ok()).toBe(true);
  }
});
