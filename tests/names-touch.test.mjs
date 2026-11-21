import { createRequire } from 'node:module';
const require = createRequire('/tmp/baudoku-test/package.json');
const { chromium } = require('playwright-core');
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const art = '/opt/cursor/artifacts';
mkdirSync(art, { recursive: true });
const port = 8794;
const serveRoot = '/tmp/baudoku-serve-names';
mkdirSync(serveRoot, { recursive: true });
rmSync(join(serveRoot, 'baudoku'), { recursive: true, force: true });
symlinkSync(root, join(serveRoot, 'baudoku'));
const child = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: serveRoot, stdio: 'ignore' });
const base = `http://127.0.0.1:${port}/baudoku/`;
await new Promise((r) => setTimeout(r, 250));

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errors = [];
try {
  for (const app of [{ id: 'haupt', url: base, key: 'baudoku-line-names' }, { id: 'zwei', url: base + 'zwei/', key: 'baudoku2-line-names' }]) {
    for (const [tag, viewport] of [['phone', { width: 390, height: 844 }], ['tablet', { width: 820, height: 1180 }]]) {
      const page = await (await browser.newContext({ viewport, locale: 'de-DE', hasTouch: true })).newPage();
      page.on('pageerror', (e) => errors.push(app.id + ' ' + tag + ' ' + e));
      const mark = app.id + '-' + tag;
      await page.goto(app.url);
      await page.locator('button', { hasText: 'Neues Projekt' }).click();
      await page.locator('input[name="name"]').fill('Namen ' + mark);
      await page.locator('#pf button[type="submit"]').click();
      await page.locator('button[data-tab="sketches"]').click();
      await page.locator('#newSheet').click();
      await page.locator('.modal input[name="title"]').fill('Dach ' + mark);
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
      const box = [[0.22, 0.28], [0.75, 0.28], [0.75, 0.62], [0.22, 0.62]];
      await page.locator('#draw-line').click();
      for (let i = 0; i < box.length; i++) {
        const a = box[i], b = box[(i + 1) % box.length];
        await gesture([await at(a[0], a[1]), await at(b[0], b[1])]);
      }
      await page.waitForFunction(() => window.__baudoku.draw.edges() === 4);
      const horizontal = () => page.evaluate(() => window.__baudoku.draw.edgeEnds().filter((e) => Math.abs(e.y1 - e.y2) < 0.04).sort((a, b) => a.y1 - b.y1));
      const vertical = () => page.evaluate(() => window.__baudoku.draw.edgeEnds().filter((e) => Math.abs(e.x1 - e.x2) < 0.04).sort((a, b) => a.x1 - b.x1));
      async function openLine(e) {
        const p = await at((e.x1 + e.x2) / 2, (e.y1 + e.y2) / 2);
        await page.locator('#draw-line').click();
        await gesture([p]);
        await gesture([p]);
        await page.waitForSelector('#lineNames:not([hidden]) button');
      }
      const top = (await horizontal())[0];
      await openLine(top);
      await page.locator('#lineNames [data-line-name="Blende"]').click();
      await page.waitForFunction(() => window.__baudoku.draw.edgeEnds().some((e) => e.name === 'Blende' && e.label === 'a'));
      await page.locator('#lineNames [data-line-name="__clear"]').click();
      await page.waitForFunction(() => window.__baudoku.draw.edgeEnds().every((e) => !e.name));
      await page.locator('#lineNames [data-line-name="__custom"]').click();
      await page.locator('#drawInput').fill('Kamin-Einfassung');
      await page.locator('#drawForm button[type="submit"]').click();
      await page.waitForFunction(() => window.__baudoku.draw.edgeEnds().some((e) => e.name === 'Kamin-Einfassung'));
      const stored = await page.evaluate((key) => localStorage.getItem(key), app.key);
      assert.match(stored, /Kamin-Einfassung/, mark);
      assert.equal(await page.evaluate((key) => localStorage.getItem(key), app.id === 'haupt' ? 'baudoku2-line-names' : 'baudoku-line-names'), null, mark);
      await openLine((await horizontal())[0]);
      await page.locator('#lineNames [data-line-name="Kamin-Einfassung"]').waitFor();
      await page.locator('#lineNames [data-line-name="__clear"]').click();
      const plan = [
        [horizontal, 0, 'Blende'],
        [vertical, 1, 'Dachrinne'],
        [horizontal, 1, 'Blende'],
        [vertical, 0, 'Attika'],
      ];
      const seen = {};
      for (const [pick, index, name] of plan) {
        const list = await pick();
        await openLine(list[index]);
        await page.locator(`#lineNames [data-line-name="${name}"]`).click();
        seen[name] = (seen[name] || 0) + 1;
        await page.waitForFunction((n) => window.__baudoku.draw.edgeEnds().filter((e) => e.name === n[0]).length >= n[1], [name, seen[name]]);
      }
      async function measure(e, value) {
        await page.locator('#draw-measure').click();
        await gesture([await at((e.x1 + e.x2) / 2, (e.y1 + e.y2) / 2)]);
        await page.locator('#drawInput').fill(value);
        await page.locator('#drawUnit').selectOption('m');
        await page.locator('#drawForm button[type="submit"]').click();
        await page.waitForFunction(() => document.querySelector('#drawForm').hidden);
      }
      const named = await page.evaluate(() => window.__baudoku.draw.edgeEnds());
      for (const e of named) await measure(e, Math.abs(e.y1 - e.y2) < 0.04 ? '8,50' : '4,20');
      const shown = await page.evaluate(() => window.__baudoku.draw.edgeEnds().map((e) => e.measureText).sort());
      assert.deepEqual(shown, ['Attika 4,20 m', 'Blende 8,50 m', 'Blende 8,50 m', 'Dachrinne 4,20 m'], mark + ' ' + shown.join(' | '));
      await page.locator('#draw-line').click();
      await gesture([await at(0.05, 0.08)]);
      await page.locator('#draw-fold').click();
      await page.waitForFunction(() => document.querySelector('#lineNames').hidden && document.querySelector('.draw-tools').hidden);
      await page.evaluate(() => { const t = document.querySelector('#toast'); if (t) t.style.display = 'none'; });
      if (tag === 'phone') await page.screenshot({ path: join(art, app.id === 'haupt' ? 'baudoku-namen-skizze.png' : 'baudoku-2-namen-skizze.png') });
      if (tag === 'phone' || app.id === 'haupt') {
        await page.locator('#drawBack').click();
        await page.locator('button[data-tab="aufmass"]').click();
        await page.locator('#amSketch').click();
        await page.locator('.sk-src').click();
        await page.locator('#skTake').click();
        await page.locator('.part-sum').waitFor();
        const sum = await page.locator('.part-sum').innerText();
        assert.match(sum, /Zusammenfassung nach Bauteil/);
        assert.match(sum, /Blende: 8,50 m \+ 8,50 m = 17,00 m/, mark + ' ' + sum);
        assert.doesNotMatch(sum, /Dachrinne:/);
        assert.doesNotMatch(sum, /m²/);
        if (tag === 'phone' && app.id === 'haupt') {
          await page.evaluate(() => {
            const t = document.querySelector('#toast'); if (t) { t.classList.remove('show'); t.textContent = ''; }
            const nav = document.querySelector('.tabs'); if (nav) nav.style.position = 'static';
          });
          await page.screenshot({ path: join(art, 'baudoku-namen-aufmass.png'), fullPage: true });
          await page.locator('button[data-tab="export"]').click();
          for (const id of ['#oPh', '#oNo', '#oMi', '#oSk', '#oSheet']) await page.locator(id).uncheck();
          await page.locator('#mkPdf').click();
          await page.waitForFunction(() => window.__baudoku.lastPdf);
          const bytes = await page.evaluate(async () => Array.from(new Uint8Array(await window.__baudoku.lastPdf.arrayBuffer())));
          const pdfPath = join(art, 'baudoku-namen.pdf');
          writeFileSync(pdfPath, Buffer.from(bytes));
          const text = execFileSync('pdftotext', ['-layout', pdfPath, '-'], { encoding: 'utf8' });
          assert.match(text, /Zusammenfassung nach Bauteil/);
          assert.match(text, /Blende: 8,50 m \+ 8,50 m = 17,00 m/);
          assert.match(text, /Dachrinne/);
          assert.match(text, /Attika/);
          execFileSync('pdftoppm', ['-png', '-r', '120', '-f', '2', '-l', '2', pdfPath, join(art, 'baudoku-namen-pdf')]);
        }
      }
      await page.close();
    }
  }
  assert.equal(errors.length, 0, errors.join('\n'));
} finally {
  await browser.close();
  child.kill();
}

test('named lines on both apps', () => assert.ok(true));
