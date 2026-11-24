import { createRequire } from 'node:module';
const require = createRequire('/tmp/baudoku-test/package.json');
const { chromium } = require('playwright-core');
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { LINE_COLORS } from '../js/draw.js';
import { emptyDoc, addLine, setEdgeStyle } from '../js/plan.js';

const ORANGE = '#F57C00';

test('Orange steht in der Palette und bleibt an der Linie gespeichert', () => {
  const oranges = LINE_COLORS.filter((c) => c.name === 'Orange');
  assert.equal(LINE_COLORS.length, 9);
  assert.equal(oranges.length, 1);
  assert.equal(oranges[0].hex, ORANGE);
  assert.ok(LINE_COLORS.some((c) => c.hex === '#ffd43b'));
  assert.ok(LINE_COLORS.some((c) => c.hex === '#e03131'));
  let doc = emptyDoc();
  doc = addLine(doc, { x: 0, y: 0 }, { x: 1, y: 0 });
  doc = setEdgeStyle(doc, doc.edges[0].id, { color: ORANGE });
  assert.equal(doc.edges[0].color, ORANGE);
  const zwei = readFileSync(new URL('../zwei/js/draw.js', import.meta.url), 'utf8');
  const zweiSw = readFileSync(new URL('../zwei/sw.js', import.meta.url), 'utf8');
  assert.doesNotMatch(zwei, /#F57C00/);
  assert.match(zweiSw, /baudoku2-v1\.9\.0/);
});

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const art = '/opt/cursor/artifacts';
mkdirSync(art, { recursive: true });
const port = 8798;
const serveRoot = '/tmp/baudoku-serve-orange';
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
    await page.locator('input[name="name"]').fill('Orange ' + tag);
    await page.locator('#pf button[type="submit"]').click();
    await page.locator('button[data-tab="sketches"]').click();
    await page.locator('#newSheet').click();
    await page.locator('.modal input[name="title"]').fill('Orange');
    await page.locator('.modal button[type="submit"]').click();
    await page.waitForFunction(() => window.__baudoku.draw);
    await page.locator('#draw-pen').click();
    const orange = page.locator('#penBar [data-c="#F57C00"]');
    await orange.waitFor();
    const box = await orange.boundingBox();
    const bar = await page.locator('#penBar').boundingBox();
    assert.ok(box && bar, tag);
    assert.ok(box.x >= bar.x - 1 && box.x + box.width <= bar.x + bar.width + 1, tag + ' Orange steht über dem Rand');
    assert.ok(box.y >= bar.y - 1 && box.y + box.height <= bar.y + bar.height + 1, tag + ' Orange ist abgeschnitten');
    await orange.click();
    const at = (nx, ny) => page.evaluate(([x, y]) => window.__baudoku.draw.clientPoint(x, y), [nx, ny]);
    const c = page.locator('#drawCanvas');
    const gesture = async (pts) => {
      const fire = (type, p) => c.dispatchEvent(type, { clientX: p.x, clientY: p.y, pointerId: 1, pointerType: 'touch', bubbles: true, button: 0, buttons: type === 'pointerup' ? 0 : 1 });
      await fire('pointerdown', pts[0]);
      for (const p of pts.slice(1)) await fire('pointermove', p);
      await fire('pointerup', pts[pts.length - 1]);
    };
    await page.locator('#draw-line').click();
    await gesture([await at(0.12, 0.22), await at(0.88, 0.22)]);
    await page.waitForFunction((hex) => window.__baudoku.draw.edgeEnds().some((e) => e.color.toLowerCase() === hex), ORANGE.toLowerCase());
    const pixel = await page.evaluate(() => {
      const canvas = document.querySelector('#drawCanvas');
      const e = window.__baudoku.draw.edgeEnds()[0];
      const p = window.__baudoku.draw.clientPoint((e.x1 + e.x2) / 2, (e.y1 + e.y2) / 2);
      const rect = canvas.getBoundingClientRect();
      const x = Math.round((p.x - rect.left) * canvas.width / rect.width);
      const y = Math.round((p.y - rect.top) * canvas.height / rect.height);
      const ctx = canvas.getContext('2d');
      let best = null;
      for (let dy = -8; dy <= 8; dy++) for (let dx = -8; dx <= 8; dx++) {
        const px = ctx.getImageData(x + dx, y + dy, 1, 1).data;
        const score = px[0] - px[2];
        if (!best || score > best.score) best = { score, r: px[0], g: px[1], b: px[2] };
      }
      return best;
    });
    assert.ok(pixel.r > 200 && pixel.g > 70 && pixel.g < 190 && pixel.b < 40, tag + ' ' + JSON.stringify(pixel));
    await page.reload();
    await page.waitForFunction((hex) => window.__baudoku.draw?.edgeEnds?.().some((e) => e.color.toLowerCase() === hex), ORANGE.toLowerCase());
    if (tag === 'phone') {
      await page.locator('#draw-pen').click();
      await page.locator('#penBar [data-c="#F57C00"]').waitFor();
      await page.evaluate(() => { const t = document.querySelector('#toast'); if (t) t.style.display = 'none'; });
      await page.screenshot({ path: join(art, 'baudoku-orange.png') });
    }
    await page.close();
  }
  assert.equal(errors.length, 0, errors.join('\n'));
} finally {
  await browser.close();
  child.kill();
}

test('orange line is visible on phone and tablet', () => assert.ok(true));
