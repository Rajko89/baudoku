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
const port = 8784;
const serveRoot = '/tmp/baudoku-serve-171';
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
    await page.locator('input[name="name"]').fill('Symbole ' + tag);
    await page.locator('#pf button[type="submit"]').click();
    await page.locator('button[data-tab="sketches"]').click();
    const pid = await page.evaluate(() => location.hash.split('/')[2].split('?')[0]);
    await page.locator('#newSheet').click();
    await page.locator('.modal input[name="title"]').fill('Blatt ' + tag);
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
    await page.locator('#draw-rect').click();
    await gesture([await at(0.3, 0.35)]);
    await page.locator('#draw-circle').click();
    await gesture([await at(0.68, 0.42)]);
    const placed = await page.evaluate(() => ({ sheet: window.__baudoku.draw.sheet(), shapes: window.__baudoku.draw.shapes() }));
    const side = Math.min(placed.sheet.w, placed.sheet.h) * 0.022;
    const square = placed.shapes.find((s) => s.kind === 'rect');
    const circle = placed.shapes.find((s) => s.kind === 'circle');
    assert.ok(square && circle, tag + ' ' + JSON.stringify(placed.shapes));
    assert.equal(square.symbol, true, tag);
    assert.equal(circle.symbol, true, tag);
    assert.ok(Math.abs(square.w * placed.sheet.w - side) < 1, tag + ' Quadrat ' + JSON.stringify(square));
    assert.ok(Math.abs(square.h * placed.sheet.h - side) < 1, tag + ' Quadrat-Höhe ' + JSON.stringify(square));
    assert.ok(Math.abs(circle.d * placed.sheet.w - side) < 1, tag + ' Kreis ' + JSON.stringify(circle));
    assert.ok(square.w < 0.04 && square.w > 0.01, tag);
    const before = circle.d;
    await page.locator('#draw-line').click();
    const sqMid = await at(square.x + square.w / 2, square.y + square.h / 2);
    await gesture([{ x: sqMid.x + 18, y: sqMid.y }, { x: sqMid.x + 70, y: sqMid.y }]);
    const grabbed = await page.evaluate(() => window.__baudoku.draw.shapes().find((s) => s.kind === 'rect'));
    assert.ok(grabbed.x > square.x + 0.03, tag + ' Trefferzone ' + JSON.stringify({ square, grabbed }));
    assert.equal(grabbed.w, square.w, tag);
    await gesture([await at(circle.x, circle.y), await at(circle.x + 0.12, circle.y + 0.04)]);
    const moved = await page.evaluate(() => window.__baudoku.draw.shapes().find((s) => s.kind === 'circle'));
    assert.equal(moved.d, before, tag + ' Größe blieb');
    assert.ok(moved.x > circle.x + 0.05, tag + ' verschoben ' + JSON.stringify({ circle, moved }));
    await page.locator('#draw-circle').click();
    const n0 = await page.evaluate(() => window.__baudoku.draw.shapes().length);
    await gesture([await at(0.15, 0.8), await at(0.55, 0.8)]);
    assert.equal(await page.evaluate(() => window.__baudoku.draw.shapes().length), n0, tag + ' Ziehen formt kein Symbol');
    if (tag === 'phone') await page.screenshot({ path: join(art, 'baudoku-symbole-klein.png') });

    await page.evaluate(async (id) => {
      await window.__baudoku.db.put('sheets', {
        id: 'sh-v170-' + id, projectId: id, title: 'Alt v1.7.0', width: 1000, height: 1400, created: 1, updated: 1, strokes: [],
        doc: {
          next: 8, nodes: [], edges: [], strokes: [], texts: [], rights: [], parallels: [], seq: [], chains: [], faceOffsets: [],
          shapes: [
            { id: 'h1', kind: 'rect', x: 0.12, y: 0.55, w: 0.42, h: 0.18, color: '#1864ab', dash: false },
            { id: 'h2', kind: 'circle', x: 0.78, y: 0.3, d: 0.28, color: '#e03131', dash: true },
          ],
        },
      });
      await window.__baudoku.db.put('sheets', {
        id: 'sh-v171-' + id, projectId: id, title: 'Symbole v1.7.1', width: 1000, height: 1400, created: 1, updated: 1, strokes: [],
        doc: {
          next: 6, nodes: [], edges: [], strokes: [], texts: [], rights: [], parallels: [], seq: [], chains: [], faceOffsets: [],
          shapes: [
            { id: 's1', kind: 'circle', x: 0.42, y: 0.36, d: 0.11, w: 0.11, h: 110 / 1400, symbol: true, color: '#111111', dash: false },
            { id: 's2', kind: 'rect', x: 0.62, y: 0.58, w: 0.11, h: 110 / 1400, d: 0.11, symbol: true, color: '#111111', dash: false },
          ],
        },
      });
    }, pid);
    await page.locator('#drawBack').click();
    await page.getByText('Symbole v1.7.1', { exact: true }).click();
    await page.waitForFunction(() => window.__baudoku.draw && window.__baudoku.draw.shapes().length === 2 && window.__baudoku.draw.shapes()[0].d < 0.04);
    const shrunk = await page.evaluate(() => window.__baudoku.draw.shapes());
    const oldCircle = shrunk.find((s) => s.kind === 'circle');
    const oldSquare = shrunk.find((s) => s.kind === 'rect');
    assert.ok(Math.abs(oldCircle.x - 0.42) < 1e-6 && Math.abs(oldCircle.y - 0.36) < 1e-6, tag + ' Kreisposition');
    assert.ok(Math.abs(oldCircle.d - 0.022) < 1e-6, tag + ' Kreisgröße ' + oldCircle.d);
    const cx = 0.62 + 0.11 / 2;
    const cy = 0.58 + (110 / 1400) / 2;
    assert.ok(Math.abs(oldSquare.x + oldSquare.w / 2 - cx) < 1e-6, tag + ' Quadratposition');
    assert.ok(Math.abs(oldSquare.y + oldSquare.h / 2 - cy) < 1e-6, tag);
    assert.ok(Math.abs(oldSquare.w - 0.022) < 1e-6, tag);
    await page.locator('#drawBack').click();
    await page.getByText('Symbole v1.7.1', { exact: true }).click();
    await page.waitForFunction(() => window.__baudoku.draw && Math.abs(window.__baudoku.draw.shapes().find((s) => s.kind === 'circle').d - 0.022) < 1e-6);
    await page.locator('#drawBack').click();
    await page.getByText('Alt v1.7.0', { exact: true }).click();
    await page.waitForFunction(() => window.__baudoku.draw && window.__baudoku.draw.shapes().length === 2);
    const kept = await page.evaluate(() => window.__baudoku.draw.shapes());
    const oldRect = kept.find((s) => s.id === undefined ? s.kind === 'rect' : s.kind === 'rect');
    assert.equal(kept.find((s) => s.kind === 'rect').w, 0.42, tag);
    assert.equal(kept.find((s) => s.kind === 'rect').h, 0.18, tag);
    assert.equal(kept.find((s) => s.kind === 'rect').color, '#1864ab', tag);
    assert.equal(kept.find((s) => s.kind === 'circle').d, 0.28, tag);
    assert.equal(kept.find((s) => s.kind === 'circle').dash, true, tag);
    assert.equal(kept.find((s) => s.kind === 'circle').symbol, false, tag);
    const legacy = kept.find((s) => s.kind === 'rect');
    await page.locator('#draw-line').click();
    await gesture([await at(legacy.x + legacy.w / 2, legacy.y + legacy.h / 2), await at(legacy.x + legacy.w / 2 + 0.1, legacy.y + legacy.h / 2)]);
    const legacyMoved = await page.evaluate(() => window.__baudoku.draw.shapes().find((s) => s.kind === 'rect'));
    assert.equal(legacyMoved.w, 0.42, tag);
    assert.equal(legacyMoved.h, 0.18, tag);
    assert.ok(legacyMoved.x > legacy.x + 0.04, tag + ' alte Form verschoben');
    await page.locator('#drawBack').click();
    await page.getByText('Alt v1.7.0', { exact: true }).click();
    await page.waitForFunction(() => window.__baudoku.draw && window.__baudoku.draw.shapes().some((s) => s.kind === 'circle' && s.d === 0.28));
    const reopened = await page.evaluate(() => window.__baudoku.draw.shapes());
    assert.equal(reopened.find((s) => s.kind === 'rect').w, 0.42, tag);
    assert.equal(reopened.find((s) => s.kind === 'rect').h, 0.18, tag);
    assert.equal(reopened.find((s) => s.kind === 'circle').d, 0.28, tag);
    assert.equal(reopened.find((s) => s.kind === 'circle').dash, true, tag);
    void oldRect;
    assert.equal(await page.locator('#draw-line').isVisible(), true, tag);
    if (tag === 'phone') await page.screenshot({ path: join(art, 'baudoku-leiste-auf.png') });
    await page.locator('#draw-fold').click();
    assert.equal(await page.locator('#draw-line').isHidden(), true, tag);
    assert.equal(await page.locator('#draw-unfold').isVisible(), true, tag);
    assert.equal(await page.locator('#draw-home').isVisible(), true, tag);
    assert.equal(await page.locator('#draw-save').isVisible(), true, tag);
    assert.equal(await page.locator('#drawBack').isVisible(), true, tag);
    await page.locator('#draw-save').click();
    await page.waitForFunction(() => (document.querySelector('#drawMsg')?.textContent || '').includes('Gespeichert'));
    if (tag === 'phone') await page.screenshot({ path: join(art, 'baudoku-leiste-zu.png') });
    await page.reload();
    await page.waitForFunction(() => window.__baudoku.draw && document.querySelector('#draw-unfold') && !document.querySelector('#draw-unfold').hidden);
    assert.equal(await page.evaluate(() => window.__baudoku.draw.toolsOpen()), false, tag + ' bleibt zu');
    await page.locator('#draw-unfold').click();
    assert.equal(await page.locator('#draw-line').isVisible(), true, tag);
    await page.reload();
    await page.waitForFunction(() => window.__baudoku.draw && window.__baudoku.draw.toolsOpen());
    assert.equal(await page.locator('#draw-fold').isVisible(), true, tag + ' bleibt auf');
    await page.locator('#draw-line').click();
    await gesture([await at(0.2, 0.4), await at(0.8, 0.4)]);
    await gesture([await at(0.5, 0.4)]);
    assert.equal(await page.locator('#btn-split').count(), 0, tag + ' Einzeltipp');
    assert.equal(await page.locator('#penBar').evaluate((n) => n.classList.contains('on')), false, tag + ' Leiste zu');
    await page.waitForTimeout(400);
    await gesture([await at(0.5, 0.4)]);
    await gesture([await at(0.5, 0.4)]);
    await page.locator('#btn-split').waitFor();
    assert.equal(await page.locator('#penBar').evaluate((n) => n.classList.contains('on')), true, tag + ' Doppeltipp');
    assert.equal(await page.locator('#draw-dash').isVisible(), true, tag);
    if (tag === 'phone') await page.screenshot({ path: join(art, 'baudoku-linienleiste.png') });
    await gesture([await at(0.08, 0.08)]);
    assert.equal(await page.locator('#btn-split').count(), 0, tag + ' Tipp ins Leere');
    await page.close();
  }
  assert.equal(errors.length, 0, errors.join('\n'));
} finally {
  await browser.close();
  child.kill();
}

test('editor v1.7.1 symbols', () => assert.ok(true));
