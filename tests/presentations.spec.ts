import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('课件上传、真实隔离播放、手机宽度与离线下载', async ({ page }, info) => {
  const html = readFileSync('courseware/01-water-defense.html', 'utf8');
  await page.goto('/#presentations');
  await page.getByLabel('管理员账号').fill('tester');
  await page.getByLabel('密码', { exact: true }).fill(process.env.CLASSFLOW_QA_PASSWORD!);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByRole('button', { name: '上传课件', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles({
    name: 'water-defense.html', mimeType: 'text/html', buffer: Buffer.from(html),
  });
  await page.getByLabel('课件名称').fill('智慧水利与国防');
  await page.getByRole('button', { name: '保存课件' }).click();
  await expect(page.getByRole('status')).toContainText('课件已保存');
  await page.reload();
  const playback = page.waitForResponse(r => r.url().endsWith('/content'));
  await page.getByRole('button', { name: '播放', exact: true }).click();
  expect((await playback).status()).toBe(200);
  const iframe = page.locator('.deck-player iframe');
  const deck = iframe.contentFrame();
  await expect(deck.getByRole('heading', { name: '智慧水利与国防' })).toBeVisible();
  const isolation = await deck.locator('body').evaluate(() => {
    try { return { origin: self.origin, parentAccessible: !!parent.document }; }
    catch { return { origin: self.origin, parentAccessible: false }; }
  });
  expect(isolation).toEqual({ origin: 'null', parentAccessible: false });
  await deck.getByRole('button', { name: '暂停动画' }).click();
  await expect(deck.getByRole('button', { name: '继续动画' })).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: info.outputPath('presentations-desktop.png') });
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect.poll(() => deck.locator('#viewport').evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
  await page.getByRole('button', { name: '全屏', exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.className)).toBe('deck-player');
  await page.evaluate(() => document.exitFullscreen());
  await deck.getByRole('button', { name: '下一页' }).click();
  await expect(deck.getByRole('heading', { name: '花园口决堤' })).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(deck.getByRole('heading', { name: '军事意图与平民代价' })).toBeVisible();
  const jump = deck.getByLabel('跳转章节');
  const selectSlide = async (name: string) => {
    const label = await jump.locator('option').filter({ hasText: name }).textContent();
    await jump.selectOption({ label: label! });
  };
  await selectSlide('决口之后');
  await expect(deck.getByText('1947.03', { exact: true })).toBeVisible();
  await expect.poll(() => deck.locator('#viewport').evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath('presentations-archive.png') });
  await selectSlide('洪水过程线');
  await expect(deck.getByRole('heading', { name: '读懂洪峰' })).toBeVisible();
  await expect(deck.getByRole('img', { name: /情景甲洪峰/ })).toBeVisible();
  await page.screenshot({ path: info.outputPath('presentations-hydrograph.png') });
  await selectSlide('四预 ·');
  await deck.getByRole('button', { name: '预演', exact: true }).click();
  await expect(deck.locator('#forecastDetail')).toContainText('不同响应方案');
  await selectSlide('互动推演');
  await expect(deck.locator('#remaining')).toHaveText('剩余 45 分钟');
  await expect.poll(() => deck.locator('#viewport').evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath('presentations-exercise.png') });
  await deck.locator('#delayTime').fill('110');
  await expect(deck.locator('#remaining')).toHaveText('时间窗已耗尽');
  await deck.getByRole('button', { name: '讲稿', exact: true }).click();
  await expect(deck.getByLabel('讲稿')).toContainText('100−55');
  await deck.getByRole('button', { name: '关闭', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => deck.locator('body').evaluate(body => body.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('presentations-mobile.png') });
  await selectSlide('测站失联');
  await deck.getByRole('button', { name: /C · 核验其他信号/ }).click();
  await expect(deck.locator('#decisionFeedback')).toContainText('同时告知属地做好准备');
  await page.getByRole('button', { name: '关闭播放' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: '下载', exact: true }).click();
  expect(readFileSync((await (await download).path())!, 'utf8')).toBe(html);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '删除', exact: true }).click();
  await expect(page.getByText('第一份课件，从这里开始')).toBeVisible();
});
