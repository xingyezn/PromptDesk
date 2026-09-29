import { expect, test } from '@playwright/test';
import { cloudSpaceSchema } from '../../src/domain/cloud';

test('batch B: project list/folder views, per-project color, ordering and ZIP export', async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin,
    password = `Synthetic-${crypto.randomUUID()}-12`;
  await context.setExtraHTTPHeaders({ 'cf-connecting-ip': '192.0.2.11' });
  const signup = await context.request.post(`${origin}/api/auth/sign-up/email`, {
    headers: { origin },
    data: {
      name: 'Synthetic Batch B User',
      email: `cloud-batch-b-${crypto.randomUUID()}@example.test`,
      password,
    },
  });
  expect(signup.status()).toBe(200);
  try {
    await page.goto('/');
    await page.getByRole('button', { name: '新建项目', exact: true }).click();
    await page.getByRole('textbox', { name: '项目名称', exact: true }).fill('Project One');
    await page.getByRole('button', { name: '创建', exact: true }).click();
    await page.getByRole('button', { name: '新建项目', exact: true }).click();
    await page.getByRole('textbox', { name: '项目名称', exact: true }).fill('Project Two');
    await page.getByRole('button', { name: '创建', exact: true }).click();

    // Projects render as folder cards in the folder view (no separate folder grouping).
    await page.getByRole('button', { name: '文件夹视图' }).click();
    const card = page
      .locator('.cloud-folder-card')
      .filter({ has: page.getByRole('button', { name: 'Project One', exact: true }) });
    await expect(card).toBeVisible();
    await expect(
      page
        .locator('.cloud-folder-card')
        .filter({ has: page.getByRole('button', { name: 'Project Two', exact: true }) }),
    ).toBeVisible();

    // Each project carries its own color, edited from the project settings.
    await page.getByRole('button', { name: 'Project One', exact: true }).click();
    await page.getByRole('button', { name: '修改项目信息' }).click();
    await page.getByRole('radio', { name: '颜色 blue' }).click();
    await expect(card).toHaveCSS('background-color', 'rgb(37, 99, 235)');

    // Keyboard reorder on the drag handle updates the server order.
    await page.getByRole('button', { name: '列表视图' }).click();
    const before = cloudSpaceSchema.parse(
      await (await context.request.get(`${origin}/api/space`)).json(),
    );
    await page
      .getByRole('button', { name: /拖动排序项目：/ })
      .first()
      .focus();
    await page.keyboard.press('ArrowDown');
    const after = cloudSpaceSchema.parse(
      await (await context.request.get(`${origin}/api/space`)).json(),
    );
    expect(after.projects.filter((p) => !p.deletedAt).map((p) => p.id)).not.toEqual(
      before.projects.filter((p) => !p.deletedAt).map((p) => p.id),
    );

    // One-click ZIP exports for the space and a single project.
    const spaceDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出个人空间' }).click();
    expect((await spaceDownload).suggestedFilename()).toMatch(/\.zip$/);
    await page.getByRole('button', { name: 'Project One', exact: true }).click();
    await page.getByRole('button', { name: '修改项目信息' }).click();
    const projectDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出项目' }).click();
    expect((await projectDownload).suggestedFilename()).toMatch(/\.zip$/);
  } finally {
    test.setTimeout(90000);
    const cleanup = await context.request.post(`${origin}/api/auth/delete-user`, {
      headers: { origin },
      data: { password },
    });
    expect(cleanup.ok()).toBe(true);
  }
});
