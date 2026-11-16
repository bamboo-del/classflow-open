import { test, expect } from '@playwright/test';

test('微信消息进入真实 API 后显示通知和私人待办，桌面与手机可核对', async ({ page }, info) => {
  await page.goto('/#inbox');
  await page.getByLabel('管理员账号').fill('tester');
  await page.getByLabel('密码', { exact: true }).fill(process.env.CLASSFLOW_QA_PASSWORD!);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '历史通知' })).toBeVisible();
  await page.getByRole('button', { name: '微信', exact: true }).click();
  const original = await (await page.request.get('/api/backup')).json();
  try {
  const response = await page.request.post('/api/integrations/wechat/messages', {
    headers: { Origin: 'http://127.0.0.1:4273', 'X-ClassFlow-Request': '1' },
    data: { account: 'e2e', chatId: 'e2e-group', chatName: '微信验收班群', messageId: 'e2e-001',
      sender: '测试老师', sentAt: '2026-11-09T02:00:00Z',
      text: '请明天18:00提交微信验收材料\n请下周一下午3点参加微信验收会议' },
  });
  expect(response.status()).toBe(200);
  expect((await response.json()).taskCount).toBe(2);
  const notice = page.locator('.notice-row').filter({ hasText: '微信验收材料' });
  await expect(notice).toBeVisible({ timeout: 22000 });
  await page.screenshot({ path: info.outputPath('wechat-inbox-desktop.png') });
  await notice.click();
  await expect(page.getByRole('heading', { name: '关联任务 · 2' })).toBeVisible();
  await expect(page.getByText('本地规则识别 v1', { exact: false })).toBeVisible();
  await page.screenshot({ path: info.outputPath('wechat-detail-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('wechat-detail-mobile.png') });
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: '微信', exact: true }).click();
  await expect(page.locator('.notice-row').filter({ hasText: '微信验收材料' })).toHaveCount(1);
  } finally {
    const headers = { Origin: 'http://127.0.0.1:4273', 'X-ClassFlow-Request': '1' };
    const preview = await page.request.post('/api/backup/preview', { headers, data: original });
    const restored = await page.request.post('/api/backup/restore', { headers,
      data: { backup: original, confirmed: true, revision: (await preview.json()).revision } });
    expect(restored.status()).toBe(200);
  }
});
