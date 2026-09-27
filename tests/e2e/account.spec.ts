import { expect, test } from '@playwright/test';

test('account UI explains email-free registration and preserves local Workspace privacy', async ({
  page,
}) => {
  await page.goto('/#/account');
  await expect(page.getByRole('heading', { name: '登录 PromptDesk' })).toBeVisible();
  await expect(page.getByText(/不会同步本地工作空间/)).toBeVisible();
  await expect(page.getByText(/不验证邮箱，也不会发送验证或密码重置邮件/)).toBeVisible();
  await expect(page.getByRole('button', { name: '忘记密码' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '重新发送验证邮件' })).toHaveCount(0);

  await page.getByRole('button', { name: '创建账户' }).click();
  await expect(page.getByRole('heading', { name: '创建账户' })).toBeVisible();
  await expect(page.getByLabel('显示名称')).toBeVisible();
  await expect(page.getByLabel('邮箱')).toBeVisible();
  await expect(page.getByLabel('确认密码')).toBeVisible();
});
