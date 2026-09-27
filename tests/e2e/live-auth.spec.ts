import { expect, test } from '@playwright/test';

const productionUrl = process.env.PROMPTDESK_AUTH_SMOKE_URL;
test.skip(
  !productionUrl,
  'Set PROMPTDESK_AUTH_SMOKE_URL to run the live HTTPS account smoke test.',
);

test('production registration stores and sends a Secure HttpOnly session cookie', async ({
  browser,
}) => {
  const baseUrl = new URL(productionUrl!);
  const context = await browser.newContext(
    process.env.PROMPTDESK_TEST_PROXY
      ? { proxy: { server: process.env.PROMPTDESK_TEST_PROXY } }
      : {},
  );
  const page = await context.newPage();
  const email = `cookie-smoke-${crypto.randomUUID()}@example.test`;
  const password = `Synthetic-${crypto.randomUUID()}-12`;
  let accountCreated = false;

  try {
    await page.goto(`${baseUrl.origin}/#/account`);
    await expect(page.getByRole('heading', { name: '登录 PromptDesk' })).toBeVisible();
    await page.getByRole('button', { name: '创建账户' }).click();
    await page.getByLabel('显示名称').fill('Synthetic Cookie Smoke');
    await page.getByLabel('邮箱').fill(email);
    await page.getByLabel('密码', { exact: true }).fill(password);
    await page.getByLabel('确认密码').fill(password);
    await page.getByRole('button', { name: '创建账户' }).click();
    accountCreated = true;

    await expect(page.getByRole('heading', { name: '我的项目' })).toBeVisible();
    const sessionCookie = (await context.cookies(baseUrl.origin)).find((cookie) =>
      cookie.name.includes('session_token'),
    );
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie?.httpOnly).toBe(true);
    expect(sessionCookie?.secure).toBe(true);
    expect(sessionCookie?.sameSite).toBe('Lax');

    const session = await page.evaluate(async () => {
      const response = await fetch('/api/auth/get-session', { credentials: 'same-origin' });
      return (await response.json()) as { user?: { email?: string } } | null;
    });
    expect(session?.user?.email).toBe(email);

    const resetRoute = await page.evaluate(async () => {
      const response = await fetch('/api/auth/request-password-reset', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'synthetic@example.test' }),
      });
      return response.status;
    });
    expect(resetRoute).toBe(404);

    await page.getByRole('button', { name: '账户', exact: true }).click();
    await page.getByRole('button', { name: '删除账户' }).click();
    await page.getByRole('main').getByLabel('当前密码').fill(password);
    await page.getByLabel('输入“删除”确认').fill('删除');
    await page.getByRole('button', { name: '永久删除账户' }).click();
    await expect(page.getByRole('heading', { name: '登录 PromptDesk' })).toBeVisible();
    accountCreated = false;
  } finally {
    if (accountCreated) {
      const signIn = await context.request.post(`${baseUrl.origin}/api/auth/sign-in/email`, {
        data: { email, password },
        headers: { origin: baseUrl.origin },
      });
      if (signIn.ok()) {
        await context.request.post(`${baseUrl.origin}/api/auth/delete-user`, {
          data: { password },
          headers: { origin: baseUrl.origin },
        });
      }
    }
    await context.close();
  }
});
