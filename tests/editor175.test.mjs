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
const port = 8788;
const serveRoot = '/tmp/baudoku-serve-175';
mkdirSync(serveRoot, { recursive: true });
rmSync(join(serveRoot, 'baudoku'), { recursive: true, force: true });
symlinkSync(root, join(serveRoot, 'baudoku'));
const child = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: serveRoot, stdio: 'ignore' });
const base = `http://127.0.0.1:${port}/baudoku/`;
await new Promise((r) => setTimeout(r, 250));

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errors = [];
try {
  for (const [tag, viewport] of [['phone', { width: 390, height: 844 }], ['tablet', { width: 820, height: 1180 }]]) {
    const page = await (await browser.newContext({ viewport, locale: 'de-DE', hasTouch: true })).newPage();
    page.on('pageerror', (e) => errors.push(tag + ' ' + e));
    await page.goto(base);
    await page.locator('button', { hasText: 'Neues Projekt' }).click();
    await page.locator('input[name="name"]').fill('Drehen ' + tag);
    await page.locator('#pf button[type="submit"]').click();
    await page.locator('button[data-tab="sketches"]').click();
    await page.locator('#newSheet').click();
    await page.locator('.modal input[name="title"]').fill('Hinweis ' + tag);
    await page.locator('.modal button[type="submit"]').click();
    await page.waitForFunction(() => window.__baudoku.draw && document.querySelector('#drawCanvas')?.getBoundingClientRect().height > 80);
    const at = (nx, ny) => page.evaluate(([x, y]) => window.__baudoku.draw.clientPoint(x, y), [nx, ny]);
    const gesture = async (pts) => {
      const c = page.locator('#drawCanvas');
      const fire = (type, p) => c.dispatchEvent(type, { clientX: p.x, clientY: p.y, pointerId: 1, pointerType: 'touch', bubbles: true, button: 0, buttons: type === 'pointerup' ? 0 : 1 });
      await fire('pointerdown', pts[0]);
      for (const p of pts.slice(1)) await fire('pointermove', p);
      await fire('pointerup', pts[pts.length - 1]);
    };
    await page.locator('#draw-line').click();
    await gesture([await at(0.15, 0.72), await at(0.72, 0.58)]);
    await page.locator('#draw-text').click();
    await gesture([await at(0.4, 0.62)]);
    await page.locator('#drawInput').fill('Traufe');
    await page.locator('#drawForm button[type="submit"]').click();
    await page.waitForFunction(() => window.__baudoku.draw.texts().some((t) => t.text === 'Traufe'));
    const placed = await page.evaluate(() => window.__baudoku.draw.texts()[0]);
    await gesture([await at(placed.x, placed.y)]);
    await page.locator('#drawForm button[type="submit"]').click();
    await page.waitForFunction(() => document.querySelector('#drawForm').hidden);
    const grip = await page.evaluate(() => window.__baudoku.draw.textGrip());
    assert.ok(grip, tag + ' Drehgriff');
    const aim = await page.evaluate(() => {
      const t = window.__baudoku.draw.texts()[0];
      const e = window.__baudoku.draw.edgeEnds()[0];
      const sh = window.__baudoku.draw.sheet();
      const ang = Math.atan2((e.y2 - e.y1) * sh.h, (e.x2 - e.x1) * sh.w);
      return { x: t.x + 140 * Math.cos(ang) / sh.w, y: t.y + 140 * Math.sin(ang) / sh.h, ang };
    });
    await gesture([await at(grip.x, grip.y), await at(aim.x, aim.y)]);
    const turned = await page.evaluate(() => window.__baudoku.draw.texts()[0]);
    const delta = Math.atan2(Math.sin(turned.ang - aim.ang), Math.cos(turned.ang - aim.ang));
    assert.ok(Math.abs(delta) < 0.2 || Math.abs(Math.abs(delta) - Math.PI) < 0.2, tag + ' entlang der Linie ' + JSON.stringify({ turned, aim }));
    await page.locator('#draw-arrow').click();
    await gesture([await at(0.62, 0.42), await at(0.4, 0.36)]);
    await page.locator('[data-arrow-label="Kamin"]').waitFor();
    assert.equal(await page.locator('#penBar').evaluate((n) => n.classList.contains('on')), true, tag);
    assert.equal(await page.locator('#draw-dash').isVisible(), true, tag);
    assert.equal(await page.locator('#btn-del-shape').isVisible(), true, tag);
    if (tag === 'phone') await page.screenshot({ path: join(art, 'baudoku-pfeil-leiste.png') });
    await page.locator('[data-arrow-label="Kamin"]').click();
    await page.waitForFunction(() => window.__baudoku.draw.shapes().some((s) => s.text === 'Kamin'));
    const first = await page.evaluate(() => window.__baudoku.draw.shapes().find((s) => s.text === 'Kamin'));
    const dir = Math.atan2(first.y2 - first.y, first.x2 - first.x);
    assert.ok(Math.abs(dir) > 0.15, tag + ' Pfeil zeigt schräg ' + dir);
    const tip = await at(first.x2, first.y2);
    const tipTo = await at(first.x2 + 0.08, first.y2 + 0.12);
    await gesture([tip, tipTo]);
    const followed = await page.evaluate(() => window.__baudoku.draw.shapes().find((s) => s.text === 'Kamin'));
    assert.equal(followed.text, 'Kamin', tag);
    assert.ok(Math.abs(followed.x - first.x) < 0.03, tag + ' Ende bleibt');
    assert.ok(Math.hypot(followed.x2 - first.x2, followed.y2 - first.y2) > 0.05, tag + ' Spitze folgt ' + JSON.stringify({ first, followed }));
    await page.locator('#draw-arrow').click();
    await gesture([await at(0.22, 0.3), await at(0.48, 0.22)]);
    await page.locator('[data-arrow-label="Dachfenster"]').click();
    await page.waitForFunction(() => window.__baudoku.draw.shapes().some((s) => s.text === 'Dachfenster'));
    await page.locator('#draw-line').click();
    await gesture([await at(0.05, 0.08)]);
    if (tag === 'phone') await page.screenshot({ path: join(art, 'baudoku-gedreht.png') });
    const labels = await page.evaluate(() => window.__baudoku.draw.shapes().filter((s) => s.kind === 'arrow').map((s) => s.text));
    assert.ok(labels.includes('Kamin') && labels.includes('Dachfenster'), tag + ' ' + labels.join(','));
    assert.equal(await page.evaluate(() => window.__baudoku.draw.edges()), 1, tag);
    await page.close();
  }
  assert.equal(errors.length, 0, errors.join('\n'));
} finally {
  await browser.close();
  child.kill();
}

test('text rotation and arrow labels', () => assert.ok(true));
