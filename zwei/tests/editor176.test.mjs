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
const port = 8789;
const serveRoot = '/tmp/baudoku-serve-176';
mkdirSync(serveRoot, { recursive: true });
rmSync(join(serveRoot, 'baudoku'), { recursive: true, force: true });
symlinkSync(root, join(serveRoot, 'baudoku'));
const child = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: serveRoot, stdio: 'ignore' });
const base = `http://127.0.0.1:${port}/baudoku/`;
await new Promise((r) => setTimeout(r, 250));

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errors = [];
function beside(label, tag) {
  assert.ok(label.mid < label.tail * 0.65, tag + ' nicht am Ende ' + JSON.stringify(label));
  assert.ok(label.mid < label.tip * 0.65, tag + ' nicht an der Spitze ' + JSON.stringify(label));
  assert.ok(label.mid > 6 && label.mid < 40, tag + ' Abstand ' + label.mid);
}
try {
  for (const [tag, viewport] of [['phone', { width: 390, height: 844 }], ['tablet', { width: 820, height: 1180 }]]) {
    const page = await (await browser.newContext({ viewport, locale: 'de-DE', hasTouch: true })).newPage();
    page.on('pageerror', (e) => errors.push(tag + ' ' + e));
    await page.goto(base);
    await page.locator('button', { hasText: 'Neues Projekt' }).click();
    await page.locator('input[name="name"]').fill('Seite ' + tag);
    await page.locator('#pf button[type="submit"]').click();
    await page.locator('button[data-tab="sketches"]').click();
    await page.locator('#newSheet').click();
    await page.locator('.modal input[name="title"]').fill('Seitlich ' + tag);
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
    await page.locator('#draw-text').click();
    await gesture([await at(0.2, 0.16)]);
    await page.locator('#drawInput').fill('frei');
    await page.locator('#drawForm button[type="submit"]').click();
    await page.waitForFunction(() => window.__baudoku.draw.texts().some((t) => t.text === 'frei' && t.ang === 0));
    await page.locator('#draw-arrow').click();
    await gesture([await at(0.18, 0.42), await at(0.55, 0.36)]);
    await page.locator('[data-arrow-label="Kamin"]').click();
    await gesture([await at(0.62, 0.62), await at(0.3, 0.7)]);
    await page.locator('[data-arrow-label="Dachrinne"]').click();
    await gesture([await at(0.72, 0.22), await at(0.74, 0.58)]);
    await page.locator('[data-arrow-label="Attika"]').click();
    await page.waitForFunction(() => window.__baudoku.draw.arrowLabels().length === 3);
    const labels = await page.evaluate(() => window.__baudoku.draw.arrowLabels());
    for (const label of labels) beside(label, tag + ' ' + label.text);
    const vertical = labels.find((l) => l.text === 'Attika');
    assert.ok(vertical, tag);
    const kamin = labels.find((l) => l.text === 'Kamin');
    assert.ok(kamin.cross !== 0, tag);
    await page.locator('#btn-arrow-side').click();
    const flipped = await page.evaluate(() => window.__baudoku.draw.arrowLabels().find((l) => l.text === 'Attika'));
    assert.equal(flipped.side, -1, tag);
    assert.ok(flipped.cross * vertical.cross < 0, tag + ' Seite gewechselt');
    beside(flipped, tag + ' andere Seite');
    const before = await page.evaluate(() => window.__baudoku.draw.shapes().find((s) => s.text === 'Kamin'));
    const tip = await at(before.x2, before.y2);
    const tipTo = await at(before.x2 - 0.05, before.y2 + 0.14);
    await gesture([tip, tipTo]);
    const after = await page.evaluate(() => ({
      shape: window.__baudoku.draw.shapes().find((s) => s.text === 'Kamin'),
      label: window.__baudoku.draw.arrowLabels().find((l) => l.text === 'Kamin'),
      free: window.__baudoku.draw.texts().find((t) => t.text === 'frei'),
    }));
    assert.equal(after.shape.text, 'Kamin', tag);
    assert.ok(Math.abs(after.shape.x - before.x) < 0.03, tag + ' Ende bleibt');
    assert.ok(Math.hypot(after.shape.x2 - before.x2, after.shape.y2 - before.y2) > 0.05, tag);
    beside(after.label, tag + ' nach Drehen');
    assert.equal(after.free.ang, 0, tag + ' freier Text');
    assert.equal(after.free.x, 0.2, tag);
    await page.locator('#draw-line').click();
    await gesture([await at(0.05, 0.9)]);
    if (tag === 'phone') await page.screenshot({ path: join(art, 'baudoku-pfeil-seitlich.png') });
    await page.close();
  }
  assert.equal(errors.length, 0, errors.join('\n'));
} finally {
  await browser.close();
  child.kill();
}

test('arrow labels sit beside the shaft', () => assert.ok(true));
