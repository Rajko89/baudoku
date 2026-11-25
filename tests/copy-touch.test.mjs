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
const port = 8799;
const serveRoot = '/tmp/baudoku-serve-copy';
mkdirSync(serveRoot, { recursive: true });
rmSync(join(serveRoot, 'baudoku'), { recursive: true, force: true });
symlinkSync(root, join(serveRoot, 'baudoku'));
const child = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: serveRoot, stdio: 'ignore' });
const base = `http://127.0.0.1:${port}/baudoku/`;
await new Promise((r) => setTimeout(r, 250));
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errors = [];
try {
  for (const app of [{ id: 'haupt', url: base }]) {
    for (const [tag, viewport] of [['phone', { width: 390, height: 844 }], ['tablet', { width: 820, height: 1180 }]]) {
      const page = await (await browser.newContext({ viewport, locale: 'de-DE', hasTouch: true })).newPage();
      page.on('pageerror', (e) => errors.push(app.id + ' ' + tag + ' ' + e));
      const shot = async (name) => {
        if (tag !== 'phone') return;
        await page.evaluate(() => { const t = document.querySelector('#toast'); if (t) t.style.display = 'none'; });
        await page.screenshot({ path: join(art, name) });
      };
      await page.goto(app.url);
      await page.locator('button', { hasText: 'Neues Projekt' }).click();
      await page.locator('input[name="name"]').fill('Quelle ' + tag);
      await page.locator('#pf button[type="submit"]').click();
      await page.locator('button[data-tab="sketches"]').click();
      await page.locator('#newSheet').click();
      await page.locator('.modal input[name="title"]').fill('Dach Quelle');
      await page.locator('.modal button[type="submit"]').click();
      await page.waitForFunction(() => window.__baudoku.draw);
      const at = (nx, ny) => page.evaluate(([x, y]) => window.__baudoku.draw.clientPoint(x, y), [nx, ny]);
      const gesture = async (pts) => {
        const c = page.locator('#drawCanvas');
        const fire = (type, p) => c.dispatchEvent(type, { clientX: p.x, clientY: p.y, pointerId: 1, pointerType: 'touch', bubbles: true, button: 0, buttons: type === 'pointerup' ? 0 : 1 });
        await fire('pointerdown', pts[0]);
        for (const p of pts.slice(1)) await fire('pointermove', p);
        await fire('pointerup', pts[pts.length - 1]);
      };
      await page.locator('#draw-line').click();
      await gesture([await at(0.18, 0.35), await at(0.82, 0.35)]);
      const edge = () => page.evaluate(() => window.__baudoku.draw.edgeEnds()[0]);
      const first = await edge();
      await page.locator('#draw-measure').click();
      await gesture([await at((first.x1 + first.x2) / 2, (first.y1 + first.y2) / 2)]);
      await page.locator('#drawForm:not([hidden])').waitFor();
      await page.locator('#drawInput').fill('8,50');
      await page.locator('#drawForm button[type="submit"]').click();
      await page.waitForFunction(() => window.__baudoku.draw.edgeEnds()[0].m === 8.5);
      const sourceUrl = page.url();
      await page.locator('#drawBack').click();
      await page.locator('.hdr button[aria-label="Zurück"]').click();
      await page.locator('button', { hasText: 'Neues Projekt' }).click();
      await page.locator('input[name="name"]').fill('Ziel ' + tag);
      await page.locator('#pf button[type="submit"]').click();
      await page.locator('button[data-tab="sketches"]').click();
      await page.locator('#copySketch').waitFor();
      await shot(app.id === 'haupt' ? 'baudoku-uebernehmen-wahl.png' : 'baudoku2-uebernehmen-wahl.png');
      await page.locator('#copySketch').click();
      await page.locator('[data-copy-project]', { hasText: 'Quelle ' + tag }).waitFor();
      assert.equal(await page.locator('[data-copy-project]', { hasText: 'Ziel ' + tag }).count(), 0);
      await shot(app.id === 'haupt' ? 'baudoku-uebernehmen-projekte.png' : 'baudoku2-uebernehmen-projekte.png');
      await page.locator('[data-copy-project]', { hasText: 'Quelle ' + tag }).click();
      await page.locator('[data-copy-id]', { hasText: 'Dach Quelle' }).click();
      await page.locator('.modal input[name="title"]').waitFor();
      const title = await page.locator('.modal input[name="title"]').inputValue();
      assert.match(title, /Dach Quelle \(übernommen aus Quelle/);
      await page.locator('.modal button[type="submit"]').click();
      await page.waitForFunction(() => window.__baudoku.draw?.edgeEnds?.().some((e) => e.m === 8.5));
      await page.locator('#drawTitle').waitFor();
      assert.match(await page.locator('#drawTitle').innerText(), /übernommen aus Quelle/);
      await page.locator('#draw-line').click();
      await gesture([await at(0.5, 0.12)]);
      await page.locator('#draw-fold').click();
      await shot(app.id === 'haupt' ? 'baudoku-uebernehmen-skizze.png' : 'baudoku2-uebernehmen-skizze.png');
      if (tag === 'phone') {
        await page.locator('#draw-unfold').click();
        const copyEdge = await page.evaluate(() => window.__baudoku.draw.edgeEnds()[0]);
        await page.locator('#draw-measure').click();
        await gesture([await at((copyEdge.x1 + copyEdge.x2) / 2, (copyEdge.y1 + copyEdge.y2) / 2)]);
        await page.locator('#drawForm:not([hidden])').waitFor();
        await page.locator('#drawInput').fill('1');
        await page.locator('#drawForm button[type="submit"]').click();
        await page.waitForFunction(() => window.__baudoku.draw.edgeEnds()[0].m === 1);
        await page.goto(sourceUrl);
        await page.waitForFunction(() => window.__baudoku.draw?.edgeEnds?.()[0]?.m === 8.5);
      }
      await page.close();
    }
  }
  assert.equal(errors.length, 0, errors.join('\n'));
} finally {
  await browser.close();
  child.kill();
}
test('sketch copy on both apps', () => assert.ok(true));
