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
const port = 8787;
const serveRoot = '/tmp/baudoku-serve-174';
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
    await page.locator('input[name="name"]').fill('Pfeil ' + tag);
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
    async function measure(nx, ny, value) {
      await page.locator('#draw-measure').click();
      await gesture([await at(nx, ny)]);
      await page.locator('#drawInput').fill(value);
      await page.locator('#drawForm button[type="submit"]').click();
      await page.waitForFunction(() => document.querySelector('#drawForm').hidden);
    }
    const box = [[0.18, 0.26], [0.78, 0.26], [0.78, 0.66], [0.18, 0.66]];
    await page.locator('#draw-line').click();
    for (let i = 0; i < box.length; i++) {
      const a = box[i], b = box[(i + 1) % box.length];
      await gesture([await at(a[0], a[1]), await at(b[0], b[1])]);
    }
    await page.waitForFunction(() => window.__baudoku.draw.rights() >= 4);
    await measure(0.48, 0.26, '8,50');
    await measure(0.78, 0.46, '4,20');
    await page.waitForFunction(() => (window.__baudoku.draw.faces()[0]?.text || '').includes('35,70'));
    await page.locator('#draw-rect').click();
    await gesture([await at(0.4, 0.46)]);
    await page.locator('#draw-arrow').click();
    await gesture([await at(0.68, 0.5), await at(0.46, 0.46)]);
    const drawn = await page.evaluate(() => window.__baudoku.draw.shapes().find((s) => s.kind === 'arrow'));
    assert.ok(drawn, tag + ' Pfeil fehlt');
    assert.ok(drawn.x > 0.6 && drawn.x2 < 0.55, tag + ' Spitze ' + JSON.stringify(drawn));
    assert.ok(Math.hypot(drawn.x2 - 0.46, drawn.y2 - 0.46) < 0.06, tag);
    const mid = { x: (drawn.x + drawn.x2) / 2, y: (drawn.y + drawn.y2) / 2 };
    await page.waitForTimeout(400);
    await gesture([await at(mid.x, mid.y)]);
    await gesture([await at(mid.x, mid.y)]);
    await page.locator('#btn-arrow-text').waitFor();
    await page.locator('#penBar').waitFor();
    assert.equal(await page.locator('#draw-dash').isVisible(), true, tag);
    await page.locator('#btn-arrow-text').click();
    await page.locator('#drawInput').fill('Kamin');
    await page.locator('#drawForm button[type="submit"]').click();
    await page.waitForFunction(() => window.__baudoku.draw.shapes().some((s) => s.kind === 'arrow' && s.text === 'Kamin'));
    await page.locator('#draw-arrow').click();
    await gesture([await at(0.28, 0.36)]);
    const both = await page.evaluate(() => window.__baudoku.draw.shapes().filter((s) => s.kind === 'arrow'));
    assert.equal(both.length, 2, tag);
    const second = both.find((s) => s.text !== 'Kamin');
    assert.ok(second.x2 > second.x, tag + ' zweiter Pfeil nach rechts ' + JSON.stringify(second));
    assert.ok(Math.abs((drawn.y2 - drawn.y) / ((drawn.x2 - drawn.x) || 1) - (second.y2 - second.y) / ((second.x2 - second.x) || 1)) > 0.2 || Math.sign(drawn.x2 - drawn.x) !== Math.sign(second.x2 - second.x), tag);
    await page.locator('#draw-line').click();
    await gesture([await at(0.05, 0.08)]);
    if (tag === 'phone') await page.screenshot({ path: join(art, 'baudoku-pfeil.png') });
    const before = await page.evaluate(() => window.__baudoku.draw.shapes().find((s) => s.text === 'Kamin'));
    const shaft = { x: (before.x + before.x2) / 2, y: (before.y + before.y2) / 2 };
    await gesture([await at(shaft.x, shaft.y), await at(shaft.x, shaft.y + 0.08)]);
    const shifted = await page.evaluate(() => window.__baudoku.draw.shapes().find((s) => s.text === 'Kamin'));
    assert.equal(shifted.text, 'Kamin', tag);
    assert.ok(shifted.y > before.y + 0.03, tag + ' verschoben ' + JSON.stringify({ before, shifted }));
    assert.ok(Math.abs((shifted.x2 - shifted.x) - (before.x2 - before.x)) < 0.02, tag);
    const tip = await at(shifted.x2, shifted.y2);
    const tipTo = await at(shifted.x2, shifted.y2 - 0.12);
    await gesture([tip, tipTo]);
    const turned = await page.evaluate(() => window.__baudoku.draw.shapes().find((s) => s.text === 'Kamin'));
    assert.ok(Math.abs(turned.x - shifted.x) < 0.03, tag + ' Ende bleibt ' + JSON.stringify({ shifted, turned }));
    assert.ok(turned.y2 < shifted.y2 - 0.05, tag + ' Spitze ' + JSON.stringify(turned));
    await page.waitForTimeout(400);
    const other = await page.evaluate(() => window.__baudoku.draw.shapes().find((s) => s.kind === 'arrow' && s.text !== 'Kamin'));
    await gesture([await at((other.x + other.x2) / 2, (other.y + other.y2) / 2)]);
    await gesture([await at((other.x + other.x2) / 2, (other.y + other.y2) / 2)]);
    await page.locator('#penBar [data-c="#e03131"]').click();
    await page.locator('#draw-dash').click();
    const styled = await page.evaluate(() => window.__baudoku.draw.shapes().find((s) => s.kind === 'arrow' && s.text !== 'Kamin'));
    assert.equal(styled.color, '#e03131', tag);
    assert.equal(styled.dash, true, tag);
    assert.match(await page.evaluate(() => window.__baudoku.draw.faces()[0]?.text || ''), /35,70/, tag);
    assert.equal(await page.evaluate(() => window.__baudoku.draw.edges()), 4, tag);
    await page.close();
  }
  assert.equal(errors.length, 0, errors.join('\n'));
} finally {
  await browser.close();
  child.kill();
}

test('arrow tool', () => assert.ok(true));
