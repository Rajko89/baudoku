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
const port = 8778;
const serveRoot = '/tmp/baudoku-serve-zoom';
mkdirSync(serveRoot, { recursive: true });
rmSync(join(serveRoot, 'baudoku'), { recursive: true, force: true });
symlinkSync(root, join(serveRoot, 'baudoku'));
const child = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: serveRoot, stdio: 'ignore' });
const base = `http://127.0.0.1:${port}/baudoku/`;
await new Promise((r) => setTimeout(r, 250));

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'de-DE', hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(base);
  await page.locator('button', { hasText: 'Neues Projekt' }).click();
  await page.locator('input[name="name"]').fill('Zoom');
  await page.locator('#pf button[type="submit"]').click();
  await page.locator('button[data-tab="sketches"]').click();
  await page.locator('#newSheet').click();
  await page.locator('.modal input[name="title"]').fill('Zoomblatt');
  await page.locator('.modal button[type="submit"]').click();
  await page.waitForFunction(() => window.__baudoku.draw && document.querySelector('#drawCanvas')?.getBoundingClientRect().height > 80);
  assert.equal(await page.evaluate(() => window.__baudoku.draw.zoom()), 1);
  assert.equal(await page.locator('#drawZoom').isHidden(), true);

  const at = (nx, ny) => page.evaluate(([x, y]) => window.__baudoku.draw.clientPoint(x, y), [nx, ny]);
  const gesture = async (pts) => {
    const c = page.locator('#drawCanvas');
    const fire = (type, p) => c.dispatchEvent(type, { clientX: p.x, clientY: p.y, pointerId: 1, pointerType: 'touch', bubbles: true, button: 0, buttons: type === 'pointerup' ? 0 : 1 });
    await fire('pointerdown', pts[0]);
    for (const p of pts.slice(1)) await fire('pointermove', p);
    await fire('pointerup', pts[pts.length - 1]);
  };
  await page.locator('#draw-line').click();
  await gesture([await at(0.25, 0.72), await at(0.75, 0.72)]);
  const before = await page.evaluate(() => window.__baudoku.draw.edgeEnds());
  assert.equal(before.length, 1);
  const spreadBefore = await page.evaluate(() => {
    const a = window.__baudoku.draw.clientPoint(0.3, 0.5);
    const b = window.__baudoku.draw.clientPoint(0.7, 0.5);
    return Math.hypot(b.x - a.x, b.y - a.y);
  });

  const box = await page.locator('#drawCanvas').boundingBox();
  const client = await context.newCDPSession(page);
  await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
  const touch = (type, points) => client.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: points.map((p) => ({ x: p.x, y: p.y, id: p.id, radiusX: 2, radiusY: 2, force: 1, rotationAngle: 0 })),
  });
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const span0 = 50;
  const span1 = 110;
  await touch('touchStart', [{ id: 1, x: cx - span0, y: cy }, { id: 2, x: cx + span0, y: cy }]);
  for (let i = 1; i <= 6; i++) {
    const s = span0 + (span1 - span0) * (i / 6);
    await touch('touchMove', [{ id: 1, x: cx - s, y: cy - 8 }, { id: 2, x: cx + s, y: cy + 8 }]);
  }
  await touch('touchEnd', [{ id: 1, x: cx - span1, y: cy }, { id: 2, x: cx + span1, y: cy }]);
  const zoomed = await page.evaluate(() => window.__baudoku.draw.zoom());
  assert.ok(zoomed > 1.6 && zoomed <= 6, 'Zoom ' + zoomed);
  assert.equal(await page.locator('#drawZoom').isHidden(), false);
  const spread = await page.evaluate(() => {
    const a = window.__baudoku.draw.clientPoint(0.3, 0.5);
    const b = window.__baudoku.draw.clientPoint(0.7, 0.5);
    return Math.hypot(b.x - a.x, b.y - a.y);
  });
  assert.ok(spread > spreadBefore * 1.5, `Abstand ${spread} gegen ${spreadBefore}`);

  await gesture([await at(0.28, 0.5), await at(0.72, 0.5)]);
  const drawn = await page.evaluate(() => window.__baudoku.draw.edgeEnds());
  assert.equal(drawn.length, 2, JSON.stringify(drawn));
  const line = drawn.find((e) => Math.abs(e.y1 - 0.5) < 0.06 && Math.abs(e.y2 - 0.5) < 0.06);
  assert.ok(line, JSON.stringify(drawn));
  assert.ok(Math.min(line.x1, line.x2) < 0.3 && Math.max(line.x1, line.x2) > 0.6, JSON.stringify(line));
  await page.waitForTimeout(2800);
  await page.screenshot({ path: join(art, 'baudoku-zoom.png') });
  const end = await at(Math.max(line.x1, line.x2), line.y2);
  const shorter = await at(Math.max(line.x1, line.x2) - 0.16, line.y2);
  const c = page.locator('#drawCanvas');
  await c.dispatchEvent('pointerdown', { clientX: end.x, clientY: end.y, pointerId: 3, pointerType: 'touch', bubbles: true, button: 0, buttons: 1 });
  await c.dispatchEvent('pointermove', { clientX: end.x + 6, clientY: end.y - 2, pointerId: 3, pointerType: 'touch', bubbles: true, button: 0, buttons: 1 });
  await c.dispatchEvent('pointermove', { clientX: shorter.x, clientY: shorter.y, pointerId: 3, pointerType: 'touch', bubbles: true, button: 0, buttons: 1 });
  await c.dispatchEvent('pointerup', { clientX: shorter.x, clientY: shorter.y, pointerId: 3, pointerType: 'touch', bubbles: true, button: 0, buttons: 0 });
  const pulled = await page.evaluate(() => window.__baudoku.draw.edgeEnds());
  assert.equal(pulled.length, 2, JSON.stringify(pulled));
  const moved = pulled.find((e) => Math.abs(e.y1 - line.y1) < 0.08 || Math.abs(e.y2 - line.y2) < 0.08);
  assert.ok(Math.max(moved.x1, moved.x2) < Math.max(line.x1, line.x2) - 0.08, JSON.stringify({ line, moved }));

  const n = pulled.length;
  const live = await page.locator('#drawCanvas').boundingBox();
  const start = { x: live.x + live.width * 0.42, y: live.y + live.height * 0.48 };
  const mid = { x: live.x + live.width * 0.62, y: live.y + live.height * 0.48 };
  await touch('touchStart', [{ id: 1, x: start.x, y: start.y }]);
  await touch('touchMove', [{ id: 1, x: mid.x, y: mid.y }]);
  await touch('touchStart', [{ id: 2, x: mid.x + 30, y: mid.y + 40 }]);
  await touch('touchMove', [{ id: 1, x: mid.x - 10, y: mid.y }, { id: 2, x: mid.x + 70, y: mid.y + 20 }]);
  await touch('touchEnd', [{ id: 1, x: mid.x, y: mid.y }, { id: 2, x: mid.x + 70, y: mid.y + 20 }]);
  const afterCancel = await page.evaluate(() => window.__baudoku.draw.edgeEnds());
  assert.equal(afterCancel.length, n, 'zweiter Finger hat eine Linie erzeugt ' + JSON.stringify(afterCancel));

  const state = await page.evaluate(() => ({ z: window.__baudoku.draw.zoom(), hidden: document.querySelector('#drawZoom')?.hidden, text: document.querySelector('#drawZoom')?.textContent }));
  assert.equal(state.hidden, false, JSON.stringify(state));
  await page.locator('#drawZoom').click();
  const back = await page.evaluate(() => window.__baudoku.draw.zoom());
  assert.ok(Math.abs(back - 1) < 0.02, 'Reset ' + back);
  assert.equal(await page.locator('#drawZoom').isHidden(), true);

  await touch('touchStart', [{ id: 1, x: cx - 90, y: cy }, { id: 2, x: cx + 90, y: cy }]);
  await touch('touchMove', [{ id: 1, x: cx - 30, y: cy }, { id: 2, x: cx + 30, y: cy }]);
  await touch('touchEnd', [{ id: 1, x: cx - 30, y: cy }, { id: 2, x: cx + 30, y: cy }]);
  const shrunk = await page.evaluate(() => window.__baudoku.draw.zoom());
  assert.ok(shrunk < 0.85 && shrunk >= 0.5, 'Rauszoomen ' + shrunk);
  const corner = await page.locator('#drawCanvas').boundingBox();
  const tap = { x: corner.x + 24, y: corner.y + 24 };
  await c.dispatchEvent('pointerdown', { clientX: tap.x, clientY: tap.y, pointerId: 4, pointerType: 'touch', bubbles: true, button: 0, buttons: 1 });
  await c.dispatchEvent('pointerup', { clientX: tap.x, clientY: tap.y, pointerId: 4, pointerType: 'touch', bubbles: true, button: 0, buttons: 0 });
  await c.dispatchEvent('pointerdown', { clientX: tap.x, clientY: tap.y, pointerId: 4, pointerType: 'touch', bubbles: true, button: 0, buttons: 1 });
  await c.dispatchEvent('pointerup', { clientX: tap.x, clientY: tap.y, pointerId: 4, pointerType: 'touch', bubbles: true, button: 0, buttons: 0 });
  const tapped = await page.evaluate(() => window.__baudoku.draw.zoom());
  assert.ok(Math.abs(tapped - 1) < 0.02, 'Doppeltipp ' + tapped);
  assert.equal(errors.length, 0, errors.join('\n'));
  await context.close();
} finally {
  await browser.close();
  child.kill();
}

test('zoom flow completed', () => assert.ok(true));
