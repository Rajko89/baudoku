import { createRequire } from 'node:module';
const require = createRequire('/tmp/baudoku-test/package.json');
const { chromium } = require('playwright-core');
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const art = '/opt/cursor/artifacts';
mkdirSync(art, { recursive: true });
const pngPath = '/tmp/baudoku-photo.png';
writeFileSync(pngPath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC', 'base64'));
const port = 8786;
const serveRoot = '/tmp/baudoku-serve-173';
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
    await page.locator('input[name="name"]').fill('Dach ' + tag);
    await page.locator('#pf button[type="submit"]').click();
    await page.locator('button[data-tab="sketches"]').click();
    await page.locator('#newSheet').click();
    await page.locator('.modal input[name="title"]').fill('Dachfläche ' + tag);
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
    async function measure(nx, ny, value) {
      await page.locator('#draw-measure').click();
      await gesture([await at(nx, ny)]);
      await page.locator('#drawInput').fill(value);
      await page.locator('#drawForm button[type="submit"]').click();
      await page.waitForFunction(() => document.querySelector('#drawForm').hidden);
    }
    const box = [[0.22, 0.28], [0.75, 0.28], [0.75, 0.62], [0.22, 0.62]];
    await page.locator('#draw-line').click();
    for (let i = 0; i < box.length; i++) {
      const a = box[i], b = box[(i + 1) % box.length];
      await gesture([await at(a[0], a[1]), await at(b[0], b[1])]);
    }
    await page.waitForFunction(() => window.__baudoku.draw.rights() >= 4);
    await measure(0.48, 0.28, '8,50');
    await measure(0.75, 0.45, '4,20');
    await page.waitForFunction(() => (window.__baudoku.draw.faces()[0]?.text || '').includes('35,70'));
    const face = await page.evaluate(() => window.__baudoku.draw.faces()[0]);
    await page.locator('#draw-text').click();
    await gesture([await at(face.x, face.y)]);
    await page.waitForFunction(() => document.querySelector('#drawForm') && !document.querySelector('#drawForm').hidden);
    await page.locator('#drawInput').fill('Kamin');
    await page.locator('#drawForm button[type="submit"]').click();
    await page.waitForFunction(() => window.__baudoku.draw.texts().some((t) => t.text === 'Kamin'));
    await page.locator('#draw-circle').click();
    await gesture([await at(face.x, face.y)]);
    await page.locator('#draw-rect').click();
    await gesture([await at(0.35, 0.4)]);
    await gesture([await at(0.5, 0.32)]);
    const inside = await page.evaluate(() => ({
      shapes: window.__baudoku.draw.shapes(),
      face: window.__baudoku.draw.faces()[0]?.text || '',
      edges: window.__baudoku.draw.edges(),
      text: window.__baudoku.draw.texts().map((t) => t.text),
    }));
    assert.equal(inside.edges, 4, tag);
    assert.match(inside.face, /35,70/, tag + ' Fläche bleibt ' + inside.face);
    assert.ok(inside.text.includes('Kamin'), tag);
    assert.equal(inside.shapes.length, 3, tag + ' ' + JSON.stringify(inside.shapes));
    const circle = inside.shapes.find((s) => s.kind === 'circle');
    const squares = inside.shapes.filter((s) => s.kind === 'rect');
    assert.ok(circle && squares.length === 2, tag);
    assert.ok(circle.x > 0.22 && circle.x < 0.75 && circle.y > 0.28 && circle.y < 0.62, tag + ' Kreis in der Fläche');
    for (const s of squares) {
      const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
      assert.ok(cx > 0.22 && cx < 0.75 && cy > 0.28 && cy < 0.62, tag + ' Quadrat in der Fläche ' + JSON.stringify(s));
    }
    await page.locator('#draw-line').click();
    await gesture([await at(0.05, 0.08)]);
    if (tag === 'phone') await page.screenshot({ path: join(art, 'baudoku-symbole-in-flaeche.png') });
    const square = squares.reduce((a, b) => Math.hypot(a.x + a.w / 2 - 0.35, a.y + a.h / 2 - 0.4) < Math.hypot(b.x + b.w / 2 - 0.35, b.y + b.h / 2 - 0.4) ? a : b);
    const parked = squares.find((s) => s !== square);
    const sx = square.x + square.w / 2;
    const sy = square.y + square.h / 2;
    await gesture([await at(sx, sy), await at(Math.max(0.26, sx - 0.08), sy + 0.06)]);
    const moved = await page.evaluate((origin) => window.__baudoku.draw.shapes().filter((s) => s.kind === 'rect').find((s) => Math.hypot(s.x - origin.x, s.y - origin.y) > 0.02) || null, square);
    assert.ok(moved && Math.hypot(moved.x - square.x, moved.y - square.y) > 0.02, tag + ' verschoben ' + JSON.stringify({ square, moved }));
    assert.match(await page.evaluate(() => window.__baudoku.draw.faces()[0]?.text || ''), /35,70/);
    await page.waitForTimeout(400);
    const px = parked.x + parked.w / 2;
    const py = parked.y + parked.h / 2;
    await gesture([await at(px, py)]);
    await gesture([await at(px, py)]);
    await page.locator('#btn-del-shape').waitFor();
    await page.locator('#drawBack').click();

    await page.locator('button[data-tab="photos"]').click();
    await page.locator('#in-gallery').setInputFiles(pngPath);
    await page.waitForSelector('[data-draw]');
    await page.locator('[data-draw]').click();
    await page.waitForFunction(() => window.__baudoku.draw && document.querySelector('#drawCanvas')?.getBoundingClientRect().height > 80);
    await page.locator('#draw-circle').click();
    await gesture([await at(0.5, 0.5)]);
    const onPhoto = await page.evaluate(() => window.__baudoku.draw.shapes());
    assert.equal(onPhoto.length, 1, tag + ' Foto ' + JSON.stringify(onPhoto));
    assert.equal(onPhoto[0].kind, 'circle', tag);
    await page.close();
  }
  assert.equal(errors.length, 0, errors.join('\n'));
} finally {
  await browser.close();
  child.kill();
}

test('symbols inside a face', () => assert.ok(true));
