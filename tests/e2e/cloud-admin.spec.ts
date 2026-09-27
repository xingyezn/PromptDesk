import { expect, test } from '@playwright/test';

test('synthetic administrator changes initial password and manages a user', async ({
  page,
  playwright,
  baseURL,
}) => {
  test.skip(
    Boolean(process.env.PROMPTDESK_CLOUD_URL || process.env.PROMPTDESK_AUTH_SMOKE_URL),
    'Never operate the real default administrator in live tests.',
  );
  const origin = new URL(baseURL!).origin;
  const member = await playwright.request.newContext({
    baseURL: origin,
    extraHTTPHeaders: { origin },
  });
  const memberPassword = 'Synthetic-member-password-12';
  const email = `cloud-admin-target-${crypto.randomUUID()}@example.test`;
  const signup = await member.post('/api/auth/sign-up/email', {
    data: { name: 'Synthetic Managed User', email, password: memberPassword },
  });
  expect(signup.ok()).toBe(true);
  let cleanupPassword = memberPassword;
  let removed = false;
  try {
    await page.goto('/');
    await page.getByLabel('邮箱', { exact: true }).fill('admin@prompt.com');
    await page.getByLabel('密码', { exact: true }).fill('Synthetic-local-admin-password-12');
    await page.getByRole('button', { name: '登录 PromptDesk', exact: true }).click();
    await expect(page.getByRole('heading', { name: '请先修改初始密码' })).toBeVisible();
    await page.getByLabel('当前密码', { exact: true }).fill('Synthetic-local-admin-password-12');
    await page.getByLabel('新密码', { exact: true }).fill('Synthetic-changed-admin-password-12');
    await page
      .getByLabel('确认新密码', { exact: true })
      .fill('Synthetic-changed-admin-password-12');
    await page.getByRole('button', { name: '保存新密码' }).click();
    await expect(page.getByRole('heading', { name: '我的项目' })).toBeVisible();
    await page.getByRole('button', { name: '账户 / 管理', exact: true }).click();
    await page.getByRole('button', { name: '加载用户' }).click();
    const row = page.getByRole('listitem').filter({ hasText: email });
    await expect(row).toBeVisible();
    page.on('dialog', (dialog) => void dialog.accept());
    await row.getByRole('button', { name: '停用', exact: true }).click();
    await expect(row.getByText('已停用', { exact: true })).toBeVisible();
    expect((await member.get('/api/projects')).status()).toBe(401);
    await row.getByRole('button', { name: '启用', exact: true }).click();
    await expect(row.getByText('正常', { exact: true })).toBeVisible();
    await row.getByRole('button', { name: '重置密码', exact: true }).click();
    cleanupPassword = 'Synthetic-reset-member-password-12';
    await page.getByLabel('新临时密码').fill(cleanupPassword);
    await page.getByRole('button', { name: '确认重置', exact: true }).click();
    await expect(page.getByText('已更新账户，原有会话已撤销。')).toBeVisible();
    expect(
      (
        await member.post('/api/auth/sign-in/email', { data: { email, password: cleanupPassword } })
      ).ok(),
    ).toBe(true);
    expect((await member.get('/api/projects')).status()).toBe(403);
    await row.getByRole('button', { name: '删除用户', exact: true }).click();
    await expect(row).toHaveCount(0);
    removed = true;
    expect((await member.get('/api/projects')).status()).toBe(401);
  } finally {
    if (!removed) {
      await member.post('/api/auth/sign-in/email', { data: { email, password: cleanupPassword } });
      expect(
        (await member.post('/api/auth/delete-user', { data: { password: cleanupPassword } })).ok(),
      ).toBe(true);
    }
    await member.dispose();
  }
});
