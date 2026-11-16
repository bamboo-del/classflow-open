import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { campusClock, shiftDay, type Backup } from '@classflow/shared';

test('真实浏览器 · 通知拆分、修改、日程、完成、导出与恢复', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  const today = campusClock().date,
    original = '请整理团日活动策划书，并于周五收齐报名表。\n两项材料分别跟进。';
  const button = (name: string) => page.getByRole('button', { name, exact: true });
  const nav = (pageId: string) => page.locator('nav a[href="#' + pageId + '"]').click();
  const hasNoOverflow = async () =>
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.goto('/');
  await expect(page).toHaveTitle('ClassFlow 班务流');
  async function login() {
    await expect(page.getByRole('heading', { name: '班务流工作台' })).toBeVisible();
    await page.getByLabel('管理员账号').fill('tester');
    await page.getByLabel('密码', { exact: true }).fill(process.env.CLASSFLOW_QA_PASSWORD!);
    await button('登录').click();
  }
  await login();
  await expect(page.getByText('今日暂无待办')).toBeVisible();
  await button('录入通知').click();
  await page.getByLabel('通知原文').fill(original);
  await page.getByLabel('来源', { exact: true }).fill('班级工作群');
  await page.getByLabel('备注', { exact: true }).fill('验收用内部备注');
  await button('保存通知').click();
  await page.getByRole('button', { name: /请整理团日活动策划书/ }).click();
  for (const [title, due] of [
    ['提交团日活动策划书', today],
    ['收齐报名表', shiftDay(today, 1)],
  ]) {
    await button('转为任务').click();
    await page.getByLabel('任务标题').fill(title);
    await page.getByLabel('截止日期').fill(due);
    await page.getByLabel('截止时间（可选）').fill('23:59');
    await page.getByLabel('分类', { exact: true }).selectOption('材料');
    await page.getByLabel('负责人或跟进对象').fill('团支书');
    await expect(page.getByLabel('可见性', { exact: true })).toHaveValue('私人');
    await button('保存任务').click();
    await expect(page.getByRole('dialog', { name: '通知详情' })).toBeVisible();
  }
  await expect(page.getByText('关联任务 · 2')).toBeVisible();
  await button('标记已处理').click();
  await expect(button('设为未处理')).toBeVisible();
  await button('关闭').click();
  await page.reload();
  await expect(page.locator('.metric').filter({ hasText: '今日待办' }).locator('strong')).toHaveText('1');
  await nav('tasks');
  await page.getByLabel('搜索任务').fill('收齐报名');
  await expect(page.locator('.task-row')).toHaveCount(1);
  await page.locator('.row-link').click();
  await button('编辑任务').click();
  await page.getByLabel('任务标题').fill('核对报名表');
  await page.getByLabel('截止日期').fill(today);
  await button('保存任务').click();
  await nav('home');
  await expect(page.locator('.metric').filter({ hasText: '今日待办' }).locator('strong')).toHaveText('2');
  await button('完成 提交团日活动策划书').click();
  await expect(page.locator('.rate-card strong')).toHaveText('50%');
  await hasNoOverflow();
  await expect
    .poll(() => page.locator('.bar span').evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a))
    .toBeCloseTo(0.5, 2);
  await page.screenshot({ path: info.outputPath('desktop.png') });
  await nav('schedule');
  await button('按天').click();
  await page.locator('.row-link').filter({ hasText: '核对报名表' }).click();
  await expect(page.getByRole('heading', { name: '核对报名表' })).toBeVisible();
  await button('关闭').click();
  await nav('backup');
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: /导出备份/ }).click();
  const file = await event;
  const path = info.outputPath('export.json');
  await file.saveAs(path);
  const saved = JSON.parse(readFileSync(path, 'utf8')) as Backup;
  expect(saved.tasks).toHaveLength(2);
  expect(saved.notices[0].original).toBe(original);
  expect(saved.tasks.every((t) => t.sourceNoticeId === saved.notices[0].id)).toBe(true);
  await nav('tasks');
  await page.locator('.row-link').filter({ hasText: '核对报名表' }).click();
  await button('删除任务').click();
  await button('取消删除').click();
  await expect(page.getByRole('heading', { name: '核对报名表' })).toBeVisible();
  await button('删除任务').click();
  await button('确认删除').click();
  await expect(page.locator('.task-row')).toHaveCount(1);
  await nav('inbox');
  await page.locator('.notice-row').click();
  await expect(page.locator('.original.paper')).toHaveText(original);
  await button('关闭').click();
  await nav('backup');
  await page.getByLabel('备份文件').setInputFiles(path);
  await expect(page.getByRole('heading', { name: '恢复前核对' })).toBeVisible();
  await expect(button('确认覆盖并恢复')).toBeDisabled();
  await page.getByRole('checkbox').check();
  await button('确认覆盖并恢复').click();
  await expect(page.getByText('恢复完成。旧数据已保存到 data/backups/。')).toBeVisible();
  const restored = (await (await page.request.get('/api/backup')).json()) as Backup;
  expect(restored.tasks).toEqual(saved.tasks);
  expect(restored.notices).toEqual(saved.notices);
  await page.setViewportSize({ width: 390, height: 844 });
  await button('退出').click();
  await login();
  await nav('home');
  await expect(page.locator('.rate-card strong')).toHaveText('50%');
  await hasNoOverflow();
  await expect
    .poll(() => page.locator('.metrics').evaluate((el) => getComputedStyle(el.parentElement!).opacity))
    .toBe('1');
  await page.screenshot({ path: info.outputPath('mobile.png') });
  for (const pageId of ['inbox', 'tasks', 'schedule', 'backup']) {
    await nav(pageId);
    await hasNoOverflow();
  }
  await nav('tasks');
  await page.locator('.row-link').filter({ hasText: '核对报名表' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await hasNoOverflow();
  await button('编辑任务').click();
  await expect(page.getByLabel('截止日期')).toHaveValue(today);
  await hasNoOverflow();
  await button('取消').click();
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  await nav('home');
  await button('新建任务').click();
  await page.getByLabel('任务标题').fill('手机验收事务');
  await button('保存任务').click();
  await button('完成 手机验收事务').click();
  await nav('inbox');
  await button('录入通知').click();
  const longText = '请各组提交材料并核对日期。'.repeat(300);
  await page.getByLabel('通知原文').fill(longText);
  await page.getByLabel('来源', { exact: true }).fill('手机验收');
  await button('保存通知').click();
  await page.locator('.notice-row').filter({ hasText: '手机验收' }).click();
  await expect(page.locator('.original.paper')).toHaveText(longText);
  await hasNoOverflow();
  await button('关闭').click();
  await nav('backup');
  const mobileDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: /导出备份/ }).click();
  await mobileDownload;
  await button('退出').click();
  await expect(page.getByLabel('管理员账号')).toBeVisible();
  expect(errors).toEqual([]);
});
