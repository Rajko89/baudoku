import { createRequire } from 'node:module';
const require = createRequire('/tmp/baudoku-test/package.json');
const { chromium } = require('playwright-core');
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const art = '/opt/cursor/artifacts';
mkdirSync(art, { recursive: true });
const port = 8801;
const serveRoot = '/tmp/baudoku-serve-sync';
mkdirSync(serveRoot, { recursive: true });
rmSync(join(serveRoot, 'baudoku'), { recursive: true, force: true });
symlinkSync(root, join(serveRoot, 'baudoku'));
const child = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: serveRoot, stdio: 'ignore' });
const base = `http://127.0.0.1:${port}/baudoku/`;
await new Promise((r) => setTimeout(r, 250));
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errors = [];
try {
  const probe = await (await browser.newContext()).newPage();
  await probe.goto(base + '#/settings');
  await probe.locator('body').waitFor();
  assert.equal(await probe.locator('#gClient').count(), 0);
  await probe.close();
  for (const [tag, viewport] of [['phone', { width: 390, height: 844 }], ['tablet', { width: 820, height: 1180 }]]) {
    const page = await (await browser.newContext({ viewport, locale: 'de-DE', hasTouch: true })).newPage();
    page.on('pageerror', (e) => errors.push(tag + ' ' + e));
    await page.goto(base + 'zwei/');
    await page.locator('button', { hasText: 'Neues Projekt' }).click();
    await page.locator('input[name="name"]').fill('Sync ' + tag);
    await page.locator('#pf button[type="submit"]').click();
    await page.locator('button[data-tab="export"]').click();
    await page.locator('#expProject').click();
    await page.locator('#zipOut button', { hasText: 'Teilen' }).waitFor();
    await page.locator('#zipOut button', { hasText: 'Herunterladen' }).waitFor();
    const share = await page.locator('#zipOut button', { hasText: 'Teilen' }).boundingBox();
    assert.ok(share.x >= 0 && share.x + share.width <= viewport.width + 1, tag);
    if (tag === 'phone') {
      await page.evaluate(() => {
        const t = document.querySelector('#toast'); if (t) t.style.display = 'none';
        const nav = document.querySelector('.tabs'); if (nav) nav.style.position = 'static';
      });
      await page.locator('#zipOut').scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(art, 'baudoku2-export.png'), fullPage: true });
    }
    await page.locator('button[data-nav="#/settings"], .hdr button[aria-label="Einstellungen"]').first().click().catch(() => {});
    await page.goto(base + 'zwei/#/settings');
    await page.locator('#gClient').waitFor();
    assert.equal(await page.locator('#gConnect').isDisabled(), true);
    await page.getByText('Ohne Client-ID ist die Synchronisation aus').waitFor();
    if (tag === 'phone') await page.screenshot({ path: join(art, 'baudoku2-sync-aus.png'), fullPage: true });
    await page.locator('#gClient').fill('1234567890-test.apps.googleusercontent.com');
    await page.locator('#gSaveId').click();
    await page.waitForFunction(() => document.querySelector('#gConnect') && !document.querySelector('#gConnect').disabled);
    assert.equal(await page.locator('#syncHint').isHidden(), true);
    const connect = await page.locator('#gConnect').boundingBox();
    assert.ok(connect.y + connect.height > 0, tag);
    if (tag === 'phone') {
      await page.evaluate(() => { const t = document.querySelector('#toast'); if (t) t.style.display = 'none'; });
      await page.locator('#syncCard').scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(art, 'baudoku2-sync-an.png') });
    }
    await page.close();
  }
  assert.equal(errors.length, 0, errors.join('\n'));
} finally {
  await browser.close();
  child.kill();
}
test('sync screens on phone and tablet', () => assert.ok(true));
