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
const port = 8781;
const serveRoot = '/tmp/baudoku-serve-17';
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
    await page.locator('input[name="name"]').fill('Editor ' + tag);
    await page.locator('#pf button[type="submit"]').click();
    await page.locator('button[data-tab="sketches"]').click();
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
    await page.locator('#draw-line').click();
    await gesture([await at(0.2, 0.42), await at(0.8, 0.42)]);
    await gesture([await at(0.5, 0.42)]);
    await page.waitForTimeout(400);
    await gesture([await at(0.5, 0.42)]);
    await gesture([await at(0.5, 0.42)]);
    await page.locator('#btn-split').waitFor();
    await page.locator('#penBar [data-c="#e03131"]').click();
    await page.locator('#draw-dash').click();
    const styled = await page.evaluate(() => window.__baudoku.draw.edgeEnds());
    assert.equal(styled.length, 1, tag);
    assert.equal(styled[0].color, '#e03131', tag);
    assert.equal(styled[0].dash, true, tag);
    await page.locator('#btn-split').click();
    await page.waitForFunction(() => window.__baudoku.draw.edgeEnds().some((e) => e.label === 'a2'));
    const parts = await page.evaluate(() => window.__baudoku.draw.edgeEnds());
    assert.ok(parts.some((e) => e.label === 'a1') && parts.some((e) => e.label === 'a2'), tag + ' ' + JSON.stringify(parts));
    await page.locator('#draw-text').click();
    await gesture([await at(0.3, 0.25)]);
    await page.locator('#drawInput').fill('Kamin');
    await page.locator('#drawForm button[type="submit"]').click();
    await page.waitForFunction(() => window.__baudoku.draw.texts().some((t) => t.text === 'Kamin'));
    await page.locator('#draw-edit').click();
    const before = await page.evaluate(() => window.__baudoku.draw.texts()[0]);
    await gesture([await at(before.x, before.y), await at(before.x + 0.2, before.y + 0.05)]);
    const after = await page.evaluate(() => window.__baudoku.draw.texts()[0]);
    assert.ok(after.x > before.x + 0.08, tag + ' Text ' + JSON.stringify({ before, after }));
    await page.locator('#draw-rect').click();
    await gesture([await at(0.25, 0.7)]);
    await page.locator('#draw-circle').click();
    await gesture([await at(0.72, 0.7)]);
    const end = await page.evaluate(() => ({ edges: window.__baudoku.draw.edges(), shapes: window.__baudoku.draw.shapes(), texts: window.__baudoku.draw.texts().length }));
    assert.equal(end.edges, 2, tag);
    assert.equal(end.shapes.length, 2, tag);
    assert.ok(end.shapes.some((s) => s.kind === 'rect') && end.shapes.some((s) => s.kind === 'circle'), tag);
    assert.equal(end.texts, 1, tag);
    const frame = await page.evaluate(() => {
      const c = document.querySelector('#drawCanvas');
      const g = c.getContext('2d');
      const p = g.getImageData(1, Math.floor(c.height / 2), 1, 1).data;
      return p[0] < 230 || p[1] < 230;
    });
    assert.equal(frame, true, tag + ' Zeichenbereich');
    if (tag === 'phone') {
      await page.locator('#penBar [data-c="#1864ab"]').click();
      await page.screenshot({ path: join(art, 'baudoku-editor-17.png') });
    }
    await page.close();
  }
  assert.equal(errors.length, 0, errors.join('\n'));
} finally {
  await browser.close();
  child.kill();
}

test('editor v1.7 completed', () => assert.ok(true));
