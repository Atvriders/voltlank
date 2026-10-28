import { chromium } from '@playwright/test';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE:', m.text().slice(0, 120)); });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message.slice(0, 160)));
const hydrated = page.waitForResponse((r) => r.url().includes('/api/v1/auth/me'));
await page.goto('http://127.0.0.1:3111/register', { waitUntil: 'domcontentloaded' });
await hydrated;
await page.getByLabel('Name').fill('E2E Tester');
await page.getByLabel('Email').fill(`showroom-${Date.now()}@voltlank.test`);
await page.getByLabel('Password').fill('e2e-password-123');
const pd = page.waitForResponse((r) => r.url().includes('/auth/register') && r.request().method() === 'POST');
await page.getByRole('button', { name: 'Create account' }).click();
await pd;
await page.goto('http://127.0.0.1:3111/providers');
await page.getByRole('button', { name: /Enable demo mode|Refresh demo fleet/ }).click();
await page.waitForTimeout(4000);
await page.goto('http://127.0.0.1:3111/showroom');
await page.waitForTimeout(6000);
// click each vehicle button and screenshot the viewer area
const names = await page.locator('button[aria-pressed]').count();
console.log('vehicle buttons:', names);
const viewer = page.locator('[data-testid="vehicle-viewer"]').first();
for (let i = 0; i < names; i++) {
  await page.locator('button[aria-pressed]').nth(i).click();
  await page.waitForTimeout(3500);
  const name = await page.locator('button[aria-pressed]').nth(i).locator('p').first().innerText();
  await viewer.screenshot({ path: `/tmp/show_${i}_${name.replace(/\s+/g, '_')}.png` });
  console.log('shot', i, name);
}
await browser.close();
