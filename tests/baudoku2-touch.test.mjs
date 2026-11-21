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
const port = 8796;
const serveRoot = '/tmp/baudoku-serve-b2';
mkdirSync(serveRoot, { recursive: true });
rmSync(join(serveRoot, 'baudoku'), { recursive: true, force: true });
symlinkSync(root, join(serveRoot, 'baudoku'));
const child = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: serveRoot, stdio: 'ignore' });
const base = `http://127.0.0.1:${port}/baudoku/`;
await new Promise((r) => setTimeout(r, 250));
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errors = [];
try {
  const probe = await (await browser.newContext()).newPage();
  await probe.goto(base);
  await probe.locator('h1', { hasText: 'Baudoku' }).first().waitFor();
  assert.equal(await probe.locator('a,button', { hasText: 'Leistungskatalog' }).count(), 0);
  const mainSw = await probe.evaluate(async (url) => (await (await fetch(url, { cache: 'no-store' })).text()), base + 'sw.js');
  const zweiSw = await probe.evaluate(async (url) => (await (await fetch(url, { cache: 'no-store' })).text()), base + 'zwei/sw.js');
  assert.match(mainSw, /baudoku-v1\.7\.7/);
  assert.match(zweiSw, /baudoku2-v1\.8\.0/);
  await probe.close();
  for (const [tag, viewport] of [['phone', { width: 390, height: 844 }], ['tablet', { width: 820, height: 1180 }]]) {
    const page = await (await browser.newContext({ viewport, locale: 'de-DE', hasTouch: true })).newPage();
    page.on('pageerror', (e) => errors.push(tag + ' ' + e));
    await page.goto(base + 'zwei/');
    await page.locator('button,a', { hasText: 'Leistungskatalog' }).click();
    await page.getByText('Testkatalog – Preise vor Verwendung prüfen').waitFor();
    assert.equal(await page.locator('#catList article').count(), 10);
    await page.getByText('01.Blende montieren').waitFor();
    if (tag === 'phone') await page.screenshot({ path: join(art, 'baudoku2-katalog.png') });
    await page.locator('.hdr button[aria-label="Zurück"]').click();
    await page.locator('button', { hasText: 'Neues Projekt' }).click();
    await page.locator('input[name="name"]').fill('Angebot ' + tag);
    await page.locator('#pf button[type="submit"]').click();
    await page.locator('button[data-tab="sketches"]').click();
    await page.locator('#newSheet').click();
    await page.locator('.modal input[name="title"]').fill('Dach');
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
    await gesture([await at(0.2, 0.4), await at(0.8, 0.4)]);
    const mid = await at(0.5, 0.4);
    await gesture([mid]);
    await gesture([mid]);
    await page.locator('#btn-assign').click();
    await page.locator('#assignName').fill('Blende');
    await page.locator('#assignModes button', { hasText: 'Leistungskurzname und Maß' }).click();
    await page.locator('#assignList input[data-cat="cat-seed-01"]').check();
    await page.locator('#assignBox button[type="submit"]').click();
    await page.waitForFunction(() => window.__baudoku.draw.edgeEnds().some((e) => e.name === 'Blende' && e.caption.includes('Blende montieren')));
    await page.locator('#draw-measure').click();
    const edge = await page.evaluate(() => window.__baudoku.draw.edgeEnds()[0]);
    await gesture([await at((edge.x1 + edge.x2) / 2, (edge.y1 + edge.y2) / 2)]);
    await page.locator('#drawForm:not([hidden])').waitFor();
    await page.locator('#drawInput').fill('10');
    await page.locator('#drawForm button[type="submit"]').click();
    await page.waitForFunction(() => window.__baudoku.draw.edgeEnds()[0].m === 10);
    if (tag === 'phone') {
      await page.waitForFunction(() => document.querySelector('#drawForm').hidden);
      await page.locator('#draw-line').click();
      await gesture([await at(0.5, 0.12)]);
      await page.locator('#draw-fold').click();
      await page.evaluate(() => { const t = document.querySelector('#toast'); if (t) t.style.display = 'none'; });
      await page.screenshot({ path: join(art, 'baudoku2-linie.png') });
    }
    const before = await page.evaluate(async () => {
      const rows = await new Promise((resolve, reject) => {
        const req = indexedDB.open('baudoku-2');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const q = db.transaction('sheets').objectStore('sheets').getAll();
          q.onsuccess = () => resolve(q.result.map((s) => ({ title: s.title, edges: (s.doc?.edges || []).map((e) => ({ name: e.name, m: e.measure, mode: e.labelMode })) })));
        };
      });
      return rows;
    });
    if (!JSON.stringify(before).includes('10')) throw new Error('vor reload ' + JSON.stringify(before));
    await page.reload();
    await page.waitForFunction(() => window.__baudoku.draw, null, { timeout: 10000 });
    const kept = await page.evaluate(() => ({ ends: window.__baudoku.draw.edgeEnds(), text: document.body.innerText.slice(0, 400) }));
    if (!kept.ends.some((e) => e.m === 10 && String(e.caption).includes('Blende montieren'))) throw new Error(JSON.stringify(kept));
    await page.locator('#drawBack').click();
    await page.locator('button[data-tab="aufmass"]').click();
    await page.getByText('01.Blende montieren').first().waitFor();
    await page.getByText(/10,00 m/).first().waitFor();
    if (tag === 'phone') await page.screenshot({ path: join(art, 'baudoku2-aufmass.png'), fullPage: true });
    await page.locator('button[data-tab="angebot"]').click();
    await page.waitForTimeout(500);
    if (await page.locator('#takeAll').count() === 0) {
      const text = await page.locator('body').innerText();
      throw new Error('kein Angebot\n' + text.slice(0, 1500));
    }
    await page.locator('#takeAll').click();
    await page.getByText('680,00 EUR').first().waitFor();
    await page.getByText(/Brutto/).waitFor();
    if (tag === 'phone') {
      await page.evaluate(() => { const nav = document.querySelector('.tabs'); if (nav) nav.style.position = 'static'; });
      await page.screenshot({ path: join(art, 'baudoku2-angebot.png'), fullPage: true });
    }
    if (tag === 'phone') {
      await page.locator('#doPdf').click();
      await page.locator('.modal button', { hasText: 'PDF erstellen' }).click();
      await page.waitForFunction(() => window.__baudoku.lastPdf);
      const bytes = await page.evaluate(async () => Array.from(new Uint8Array(await window.__baudoku.lastPdf.arrayBuffer())));
      const pdfPath = join(art, 'baudoku2-angebot.pdf');
      writeFileSync(pdfPath, Buffer.from(bytes));
      const text = execFileSync('pdftotext', ['-layout', pdfPath, '-'], { encoding: 'utf8' });
      assert.match(text, /ENTWURF/);
      assert.match(text, /680,00 EUR/);
      assert.doesNotMatch(text, /Testkatalog/);
      execFileSync('pdftoppm', ['-png', '-r', '120', '-f', '1', '-l', '1', pdfPath, join(art, 'baudoku2-angebot-pdf')]);
    }
    await page.close();
  }
  assert.equal(errors.length, 0, errors.join('\n'));
} finally {
  await browser.close();
  child.kill();
}
test('Baudoku 2 touch flow', () => assert.ok(true));
