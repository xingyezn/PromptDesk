import { expect, test } from '@playwright/test';
import { cloudProjectSchema, cloudPromptSchema } from '../../src/domain/cloud';

test('personal space persists text, checkpoints, compact completion and mobile navigation', async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const email = `cloud-ui-${crypto.randomUUID()}@example.test`,
    password = `Synthetic-${crypto.randomUUID()}-12`;
  let registered = false;
  try {
    await page.goto('/');
    await page.getByRole('button', { name: '创建账户', exact: true }).click();
    await page.getByLabel('显示名称').fill('Synthetic UI User');
    await page.getByLabel('邮箱', { exact: true }).fill(email);
    await page.getByLabel('密码', { exact: true }).fill(password);
    await page.getByLabel('确认密码').fill(password);
    await page.getByRole('button', { name: '创建账户', exact: true }).click();
    await expect(page.getByRole('heading', { name: '我的项目' })).toBeVisible();
    registered = true;
    await expect(page.getByText('选择本地文件夹')).toHaveCount(0);
    await page.getByRole('button', { name: '新建项目', exact: true }).click();
    await page
      .getByRole('textbox', { name: '项目名称', exact: true })
      .fill('Synthetic Mobile Project');
    await page.getByRole('button', { name: '创建', exact: true }).click();
    await page.getByRole('button', { name: '新建', exact: true }).click();
    const body = page.getByRole('textbox', { name: 'Prompt 正文' });
    await body.fill('Synthetic prompt body\n1. First\n2. Second');
    await expect(page.getByRole('status').filter({ hasText: '已保存到服务器' })).toBeVisible();
    await page.getByRole('button', { name: '设为待提交', exact: true }).click();
    await page.getByRole('checkbox', { name: /标记完成/ }).click();
    await expect(page.getByRole('checkbox', { name: /取消完成/ })).toHaveCount(0);
    await page.getByRole('button', { name: /已完成 · 1/ }).click();
    await page.getByRole('checkbox', { name: /取消完成/ }).click();
    await expect(page.getByRole('checkbox', { name: /标记完成/ })).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: 'Synthetic Mobile Project', exact: true }).click();
    await page.getByRole('button', { name: /Synthetic prompt body 草稿/ }).click();
    await expect(body).toHaveText(/Synthetic prompt body/);
    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 850 });
      if (width <= 700) await page.getByRole('button', { name: '编辑', exact: true }).click();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await expect(body).toBeVisible();
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: '提示词', exact: true }).click();
    await page.getByRole('button', { name: '新建', exact: true }).click();
    await body.fill('Synthetic mobile idea');
    await expect(page.getByRole('button', { name: '保存草稿', exact: true })).toBeHidden();
    const composerBounds = await body.boundingBox();
    expect(composerBounds!.height).toBeGreaterThan(420);
    const mobileNav = page.getByRole('navigation', { name: '个人空间导航' });
    expect((await mobileNav.boundingBox())!.y).toBeGreaterThan(750);
    await page.getByRole('button', { name: '提示词操作', exact: true }).click();
    await page.getByRole('button', { name: '保存草稿', exact: true }).click();
    await page.getByRole('button', { name: '提示词操作', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: '已保存到服务器' })).toBeVisible();
    await page.screenshot({ path: 'test-results/cloud-mobile-editor.png' });
    await page.getByRole('button', { name: '项目', exact: true }).click();
    await expect(page.getByRole('heading', { name: '我的项目' })).toBeVisible();
    await page.screenshot({ path: 'test-results/cloud-mobile.png' });
    const projectData = cloudProjectSchema
      .array()
      .parse(await (await context.request.get(`${origin}/api/projects`)).json());
    const prompts = cloudPromptSchema
      .array()
      .parse(
        await (
          await context.request.get(`${origin}/api/projects/${projectData[0]!.id}/prompts`)
        ).json(),
      );
    expect(prompts.some((p) => p.body === 'Synthetic mobile idea')).toBe(true);
  } finally {
    test.setTimeout(90000);
    if (registered) {
      const cleanup = await context.request.post(`${origin}/api/auth/delete-user`, {
        headers: { origin },
        data: { password },
      });
      expect(cleanup.ok()).toBe(true);
    }
  }
});

test('delayed autosave preserves new typing and conflicting writes preserve the local draft', async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin,
    password = `Synthetic-${crypto.randomUUID()}-12`;
  const signup = await context.request.post(`${origin}/api/auth/sign-up/email`, {
    headers: { origin },
    data: {
      name: 'Synthetic Conflict User',
      email: `cloud-conflict-${crypto.randomUUID()}@example.test`,
      password,
    },
  });
  expect(signup.status()).toBe(200);
  try {
    const project = cloudProjectSchema.parse(
      await (
        await context.request.post(`${origin}/api/projects`, {
          headers: { origin },
          data: { name: 'Synthetic conflict project' },
        })
      ).json(),
    );
    const prompt = cloudPromptSchema.parse(
      await (
        await context.request.post(`${origin}/api/projects/${project.id}/prompts`, {
          headers: { origin },
          data: {},
        })
      ).json(),
    );
    await page.goto('/');
    await page.getByRole('button', { name: project.name, exact: true }).click();
    await page.getByRole('button', { name: /未命名提示词 草稿/ }).click();
    let first = true;
    await page.route(`**/api/prompts/${prompt.id}`, async (route) => {
      if (route.request().method() === 'PATCH' && first) {
        first = false;
        const response = await route.fetch();
        await new Promise((resolve) => setTimeout(resolve, 800));
        await route.fulfill({ response });
      } else await route.continue();
    });
    const body = page.getByRole('textbox', { name: 'Prompt 正文' });
    await body.fill('Synthetic initial text');
    await page.getByRole('button', { name: '保存草稿', exact: true }).click({ noWaitAfter: true });
    await body.fill('Synthetic new typing during save');
    await expect(page.getByRole('status').filter({ hasText: '已保存到服务器' })).toBeVisible();
    expect(
      cloudPromptSchema.parse(
        await (await context.request.get(`${origin}/api/prompts/${prompt.id}`)).json(),
      ).body,
    ).toBe('Synthetic new typing during save');
    const latest = cloudPromptSchema.parse(
      await (await context.request.get(`${origin}/api/prompts/${prompt.id}`)).json(),
    );
    await context.request.patch(`${origin}/api/prompts/${prompt.id}`, {
      headers: { origin },
      data: { revision: latest.revision, body: 'Synthetic other device' },
    });
    await body.fill('Synthetic conflicting draft');
    await page.getByRole('button', { name: '保存草稿', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: '其他页面已修改' })).toBeVisible();
    await expect(body).toHaveText(/Synthetic conflicting draft/);
    expect(
      cloudPromptSchema.parse(
        await (await context.request.get(`${origin}/api/prompts/${prompt.id}`)).json(),
      ).body,
    ).toBe('Synthetic other device');
  } finally {
    test.setTimeout(90000);
    const cleanup = await context.request.post(`${origin}/api/auth/delete-user`, {
      headers: { origin },
      data: { password },
    });
    expect(cleanup.ok()).toBe(true);
  }
});
