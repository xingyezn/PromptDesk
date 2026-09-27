import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';
import { installSyntheticPicker } from './synthetic-picker';

test('direct creation, todo completion, formatting, settings, ZIP and migration', async ({
  page,
}) => {
  await page.addInitScript(installSyntheticPicker);
  await page.goto('./');
  await page.getByRole('button', { name: '创建新工作空间', exact: true }).click();
  await page.getByLabel('名称', { exact: true }).fill('合成管理空间');
  await page.getByRole('button', { name: '确认', exact: true }).click();
  await page.getByRole('button', { name: '创建项目', exact: true }).click();
  await page.getByLabel('名称', { exact: true }).fill('合成管理项目');
  await page.getByRole('button', { name: '确认', exact: true }).click();
  await page.getByRole('button', { name: '新建 Prompt', exact: true }).last().click();
  await expect(page.getByRole('button', { name: '复制 Prompt', exact: true })).toBeVisible();
  const promptItems = page.locator('.prompt-items');
  await expect(promptItems).toHaveClass(/compact-list/);
  await page.getByRole('button', { name: '工作流', exact: true }).click();
  await expect(promptItems).toHaveClass(/workflow-list/);
  await page.getByRole('button', { name: '列表', exact: true }).click();
  await expect(page.getByRole('button', { name: '放大编辑区文字', exact: true })).toBeVisible();
  await expect(page.getByText('15px', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '放大编辑区文字', exact: true }).click();
  await expect(page.getByText('16px', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.prompt-list')).toBeHidden();
  await expect(page.locator('.editor-pane')).toBeVisible();
  await page.getByRole('button', { name: '返回提示词列表', exact: true }).click();
  await expect(page.locator('.prompt-list')).toBeVisible();
  await expect(page.locator('.editor-pane')).toBeHidden();
  await page.getByRole('button', { name: '打开 P001 未命名提示词', exact: true }).click();
  await expect(page.locator('.editor-pane')).toBeVisible();
  await page.getByRole('button', { name: '打开导航菜单', exact: true }).click();
  await expect(page.getByRole('button', { name: '临时草稿', exact: true })).toBeVisible();
  await page.locator('.mobile-nav-backdrop').click({ position: { x: 370, y: 420 } });
  await page.setViewportSize({ width: 1280, height: 800 });
  const body = page.getByRole('textbox', { name: 'Prompt 正文' });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await body.fill('合成第一条正文');
  await expect(page.getByText('已保存到工作空间', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '新建 Prompt', exact: true }).first().click();
  await expect(page.getByText('P002 / PROMPT', { exact: true })).toBeVisible();
  await body.fill('合成第二条正文');
  const url = page.url();
  await page.getByLabel('P001 标记已完成', { exact: true }).click();
  await page.getByRole('tab', { name: '已完成 1', exact: true }).click();
  await expect(page.getByLabel('P001 标记已完成', { exact: true })).toBeChecked();
  expect(page.url()).toBe(url);
  await expect(body).toHaveText('合成第二条正文');
  await expect(
    page.getByRole('button', { name: '打开 P001 未命名提示词', exact: true }),
  ).toBeVisible();
  await page.getByLabel('P001 标记已完成', { exact: true }).click();
  await page.getByRole('tab', { name: /待办/ }).click();
  await page.getByRole('button', { name: '打开 P001 未命名提示词', exact: true }).click();
  await expect(page.getByText('V1', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '修改标题', exact: true }).click();
  await page.getByLabel('名称', { exact: true }).fill('合成可选标题');
  await page.getByRole('button', { name: '确认', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '合成可选标题', exact: true, level: 1 }),
  ).toBeVisible();
  await body.fill('');
  await page.getByRole('button', { name: '有序列表', exact: true }).click();
  await expect(body).not.toContainText('内容');
  await body.fill('');
  await page.getByRole('button', { name: '无序列表', exact: true }).click();
  await body.press('End');
  await body.press('Enter');
  await body.pressSequentially('next');
  await expect(body.locator('.cm-line')).toHaveText(['- 内容', '- next']);
  await body.fill('');
  await page.getByRole('button', { name: '表格', exact: true }).click();
  await page.getByRole('button', { name: '预览', exact: true }).click();
  await expect(page.getByRole('table')).toBeVisible();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('工作空间名称', { exact: true }).fill('合成已设置空间');
  await page.getByLabel('新 Prompt 默认目标', { exact: true }).fill('ChatGPT');
  await page.getByLabel('自动保存草稿', { exact: true }).uncheck();
  await page.getByLabel('自动保存等待时间', { exact: true }).selectOption('1500');
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect(page.getByText('设置已保存到工作空间', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '查看本地应用文件', exact: true }).click();
  await page.getByRole('button', { name: '.promptdesk/settings.json', exact: true }).click();
  await expect(page.locator('.file-preview pre')).toContainText('"autosaveEnabled": false');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '打包工作空间 ZIP', exact: true }).click();
  const download = await downloadPromise;
  const archivePath = await download.path();
  expect(archivePath).not.toBeNull();
  const files = unzipSync(new Uint8Array(await readFile(archivePath!)));
  expect(JSON.parse(strFromU8(files['.promptdesk/settings.json']!)).defaultTarget).toBe('ChatGPT');
  expect(Object.keys(files).some((key) => key.endsWith('versions/v001.md'))).toBe(true);
  await page.getByRole('button', { name: '迁移到新目录', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Synthetic Destination');
  await page.getByRole('button', { name: '确认迁移并切换', exact: true }).click();
  await expect(
    page.getByText('迁移已校验，已切换到新目录。原目录仍保留。', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '关闭工作空间', exact: true }).click();
  await page.getByRole('button', { name: '打开已有工作空间', exact: true }).click();
  await expect(page.getByText('合成已设置空间', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '合成管理项目', exact: true }).click();
  await page.getByRole('button', { name: '打开 P001 合成可选标题', exact: true }).click();
  await expect(page.getByLabel('Prompt 状态', { exact: true })).toHaveValue('draft');
  await expect(body.locator('.cm-line')).toHaveText([
    '| 列 1 | 列 2 |',
    '| --- | --- |',
    '| 内容 | 内容 |',
  ]);
  await body.fill('合成手动保存草稿');
  await expect(page.getByText('有未保存修改', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByText('已保存到工作空间', { exact: true })).toBeVisible();
  await expect(page.getByText('V1', { exact: true })).toBeVisible();
});
