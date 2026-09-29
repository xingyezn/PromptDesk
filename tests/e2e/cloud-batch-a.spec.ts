import { expect, test } from '@playwright/test';
import { cloudProjectSchema } from '../../src/domain/cloud';

test('batch A: default ordered list, renumber on delete, token estimate and last-prompt reload', async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin,
    password = `Synthetic-${crypto.randomUUID()}-12`;
  await context.setExtraHTTPHeaders({ 'cf-connecting-ip': '192.0.2.10' });
  const signup = await context.request.post(`${origin}/api/auth/sign-up/email`, {
    headers: { origin },
    data: {
      name: 'Synthetic Batch A User',
      email: `cloud-batch-a-${crypto.randomUUID()}@example.test`,
      password,
    },
  });
  expect(signup.status()).toBe(200);
  try {
    const project = cloudProjectSchema.parse(
      await (
        await context.request.post(`${origin}/api/projects`, {
          headers: { origin },
          data: { name: 'Synthetic batch A project' },
        })
      ).json(),
    );
    await page.goto('/');
    await page.getByRole('button', { name: project.name, exact: true }).click();
    await page.getByRole('button', { name: '新建', exact: true }).click();

    const body = page.getByRole('textbox', { name: 'Prompt 正文' });
    // A1: a brand new prompt starts as an ordered list.
    await expect(body).toHaveText('1. ');

    // A6: deleting a middle ordered-list line renumbers the following items.
    await body.fill('1. a\n2. b\n3. c');
    const lines = body.locator('.cm-line');
    await lines.nth(1).click({ position: { x: 2, y: 8 } });
    await lines.nth(2).click({ position: { x: 2, y: 8 }, modifiers: ['Shift'] });
    await page.keyboard.press('Delete');
    await expect(body).toHaveText(/1\. a/);
    await expect(body).toHaveText(/2\. c/);
    await expect(body).not.toHaveText(/3\. c/);

    // A2: footer shows a rough token estimate next to the character count.
    await expect(page.getByText(/Tokens（粗估）/)).toBeVisible();

    // Persist, then A7: reopening the project auto-loads the last edited prompt.
    await page.getByRole('button', { name: '保存提示词', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: '已保存到服务器' })).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: project.name, exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Prompt 正文' })).toHaveText(/2\. c/);
  } finally {
    test.setTimeout(90000);
    const cleanup = await context.request.post(`${origin}/api/auth/delete-user`, {
      headers: { origin },
      data: { password },
    });
    expect(cleanup.ok()).toBe(true);
  }
});
