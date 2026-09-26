import { test, expect } from '@playwright/test';
import { installSyntheticPicker } from './synthetic-picker';

test('metadata, next prompt, ordering, queue search and scratchpad transfer stay local', async ({
  page,
}) => {
  await page.addInitScript(installSyntheticPicker, { migration: false });
  await page.goto('./');
  await page.getByRole('button', { name: '创建新工作空间', exact: true }).click();
  await page.getByLabel('名称', { exact: true }).fill('合成规划空间');
  await page.getByRole('button', { name: '确认', exact: true }).click();
  await page.getByRole('button', { name: '创建项目', exact: true }).click();
  await page.getByLabel('名称', { exact: true }).fill('合成规划项目');
  await page.getByRole('button', { name: '确认', exact: true }).click();
  await page.getByRole('button', { name: '新建 Prompt', exact: true }).last().click();
  const body = page.getByRole('textbox', { name: 'Prompt 正文' });
  await body.fill('合成第一条正文');
  await page.getByRole('button', { name: '资料与标签', exact: true }).click();
  await page.getByLabel('Prompt 标题', { exact: true }).fill('合成第一步');
  await page.getByLabel('标签（用逗号分隔）', { exact: true }).fill('规划, 开发');
  await page.getByLabel('Prompt 备注', { exact: true }).fill('合成备注');
  await page.getByRole('button', { name: '保存资料', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '合成第一步', exact: true, level: 1 }),
  ).toBeVisible();
  await page.getByRole('button', { name: '下一条', exact: true }).click();
  await expect(page.getByText('P002 / PROMPT', { exact: true })).toBeVisible();
  await expect(page.getByText('前置 P001', { exact: true })).toBeVisible();
  await body.fill('合成第二条 正文专属检索词');
  await page.getByRole('button', { name: '上移 P002', exact: true }).click();
  await expect(page.locator('.prompt-open').first()).toContainText('P002');
  await page.getByRole('button', { name: '项目资料', exact: true }).click();
  await page.getByLabel('项目说明', { exact: true }).fill('合成完整规划');
  await page.getByLabel('标签（用逗号分隔）', { exact: true }).fill('产品');
  await page.getByRole('button', { name: '保存资料', exact: true }).click();
  await page.getByRole('button', { name: '工作台', exact: true }).click();
  await page.getByLabel('全局搜索', { exact: true }).fill('正文专属检索词');
  await expect(page.getByText('没有匹配的 Prompt。', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '建立全文索引', exact: true }).click();
  await expect(page.getByText('全文索引 2/2 · 已完成', { exact: true })).toBeVisible();
  await expect(page.locator('.queue-row')).toHaveCount(1);
  await page.getByLabel('合成规划项目 P002 队列状态', { exact: true }).selectOption('completed');
  await expect(page.getByLabel('合成规划项目 P002 队列状态', { exact: true })).toHaveValue(
    'completed',
  );
  await expect(body).toHaveCount(0);
  await page.getByLabel('全局搜索', { exact: true }).fill('unknown:abc');
  await expect(page.getByText('无法识别筛选：unknown:abc', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '临时草稿', exact: true }).click();
  await page.getByRole('button', { name: '新建临时草稿', exact: true }).click();
  await page.getByLabel('草稿名称', { exact: true }).fill('合成临时构思');
  await body.fill('从临时草稿转入\n合成第二行');
  await page.getByRole('button', { name: '转入项目', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '合成临时构思', exact: true, level: 1 }),
  ).toBeVisible();
  await expect(body.locator('.cm-line')).toHaveText(['从临时草稿转入', '合成第二行']);
  await expect(page.getByText('V0', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '临时草稿', exact: true }).click();
  await page.getByRole('button', { name: '已转入', exact: true }).click();
  await page.getByRole('button', { name: /合成临时构思.*已转入项目/ }).click();
  await expect(page.getByLabel('草稿名称', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '新建临时草稿', exact: true }).click();
  await page.getByLabel('草稿名称', { exact: true }).fill('合成可恢复草稿');
  await body.fill('合成保留文本');
  await expect(page.getByLabel('草稿名称', { exact: true })).toHaveValue('合成可恢复草稿');
  await page.getByRole('button', { name: '删除临时草稿', exact: true }).click();
  await page.getByRole('button', { name: '确认删除临时草稿', exact: true }).click();
  await page.getByRole('button', { name: '已删除', exact: true }).click();
  await expect(page.locator('.deleted-row')).toContainText('合成可恢复草稿');
  await page.getByRole('button', { name: '恢复临时草稿', exact: true }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '清除浏览器缓存', exact: true }).click();
  await page.getByRole('button', { name: '确认清除缓存', exact: true }).click();
  await page.getByRole('button', { name: '关闭工作空间', exact: true }).click();
  await page.getByRole('button', { name: '打开已有工作空间', exact: true }).click();
  await page.getByRole('button', { name: '临时草稿', exact: true }).click();
  await page.getByRole('button', { name: /合成可恢复草稿/ }).click();
  await expect(body).toHaveText('合成保留文本');
});
