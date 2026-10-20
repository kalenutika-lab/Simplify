// Shared helpers for browser tests (Playwright + Chromium).
import { createRequire } from 'node:module';
import { startServer } from '../../tools/serve.js';

const require = createRequire(import.meta.url);
function loadPlaywright() {
  for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(p); } catch { /* try next */ }
  }
  throw new Error('Playwright is not installed. Run: npm install --no-save playwright');
}
export const { chromium } = loadPlaywright();

export async function setup() {
  const server = await startServer(0);
  const url = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  return { server, url, browser };
}

export async function teardown({ server, browser }) {
  await browser.close();
  await new Promise((r) => server.close(r));
}

/** New isolated profile. `time` fixes the clock (local time in `timezoneId`). */
export async function openApp(env, { width = 390, height = 844, timezoneId = 'Europe/Paris', time = '2026-10-17T10:00:00', locale = 'en-GB', userAgent } = {}) {
  const context = await env.browser.newContext({ viewport: { width, height }, timezoneId, locale, acceptDownloads: true, ...(userAgent && { userAgent }) });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  if (time) await page.clock.setFixedTime(new Date(`${time}${offsetFor(timezoneId, time)}`));
  await page.goto(env.url);
  await page.waitForSelector('.quickadd input');
  return { context, page, errors };
}

// Fixed offsets for the test dates used (October 2026, before the European DST change on 25/10).
function offsetFor(tz, time) {
  const m = { 'Europe/Paris': '+02:00', 'America/New_York': '-04:00', UTC: 'Z', 'Asia/Tokyo': '+09:00' };
  if (tz === 'Europe/Paris' && time >= '2026-10-25T03:00') return '+01:00';
  return m[tz] || 'Z';
}

export async function quickAdd(page, text) {
  const qa = page.locator('.quickadd input').first();
  await qa.fill(text);
  await qa.press('Enter');
}

export async function saveEditor(page) {
  await page.locator('.sheet-foot .btn.primary').click();
  await page.waitForSelector('.sheet', { state: 'detached' });
}

export const titles = async (loc) => (await loc.locator('.task-title').allInnerTexts()).map((s) => s.trim());

export async function setTime(page, timezoneId, time) {
  await page.clock.setFixedTime(new Date(`${time}${offsetFor(timezoneId, time)}`));
}
