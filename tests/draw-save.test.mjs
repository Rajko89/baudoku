import { createRequire } from 'node:module';
const require = createRequire('/tmp/baudoku-test/package.json');
const { chromium } = require('playwright-core');
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const art = '/opt/cursor/artifacts';
mkdirSync(art, { recursive: true });

function crc32(buf) {
  let c = ~0;
  for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return ~c;
}
function png(w, h) {
  const raw = [];
  for (let y = 0; y < h; y++) {
    const row = [0];
    for (let x = 0; x < w; x++) row.push(240, 80, 40);
    raw.push(Buffer.from(row));
  }
  const chunk = (type, data) => {
    const t = Buffer.from(type);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])) >>> 0);
    return Buffer.concat([len, t, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(raw))), chunk('IEND', Buffer.alloc(0)),
  ]);
}
const pngPath = '/tmp/baudoku-draw-save.png';
writeFileSync(pngPath, png(80, 60));

const port = 8811;
const serveRoot = '/tmp/baudoku-serve-drawsave';
mkdirSync(serveRoot, { recursive: true });
rmSync(join(serveRoot, 'baudoku'), { recursive: true, force: true });
symlinkSync(root, join(serveRoot, 'baudoku'));
const child = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: serveRoot, stdio: 'ignore' });
const base = `http://127.0.0.1:${port}/baudoku/`;
await new Promise((r) => setTimeout(r, 250));
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  for (const [tag, viewport, pointer] of [
    ['phone', { width: 390, height: 844 }, 'touch'],
    ['tablet', { width: 820, height: 1180 }, 'mouse'],
  ]) {
    const page = await browser.newPage({ viewport, locale: 'de-DE', hasTouch: true });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(base);
    await page.locator('button', { hasText: 'Neues Projekt' }).click();
    await page.locator('input[name="name"]').fill('Zeichnung ' + tag);
    await page.locator('#pf button[type="submit"]').click();
    await page.locator('#bGal').waitFor();
    await page.locator('#in-gallery').setInputFiles(pngPath);
    await page.locator('[data-draw]').waitFor();
    const photoId = await page.locator('[data-draw]').getAttribute('data-draw');
    const before = await page.evaluate(async (id) => {
      const ph = await window.__baudoku.db.get('photos', id);
      return { original: (await ph.original.arrayBuffer()).byteLength, stamped: (await ph.stamped.arrayBuffer()).byteLength };
    }, photoId);
    await page.locator('[data-draw]').click();
    await page.waitForFunction(() => window.__baudoku.draw && document.querySelector('#drawCanvas')?.getBoundingClientRect().height > 80);
    const at = (nx, ny) => page.evaluate(([x, y]) => window.__baudoku.draw.clientPoint(x, y), [nx, ny]);
    const gesture = async (pts) => {
      const c = page.locator('#drawCanvas');
      const fire = (type, p) => c.dispatchEvent(type, { clientX: p.x, clientY: p.y, pointerId: 1, pointerType: pointer, bubbles: true, button: 0, buttons: type === 'pointerup' ? 0 : 1 });
      await fire('pointerdown', pts[0]);
      for (const p of pts.slice(1)) await fire('pointermove', p);
      await fire('pointerup', pts[pts.length - 1]);
    };
    await page.locator('#draw-line').click();
    await gesture([await at(0.15, 0.2), await at(0.8, 0.7)]);
    await page.locator('#draw-text').click();
    await gesture([await at(0.4, 0.4)]);
    await page.locator('#drawInput').fill('Traufe');
    await page.locator('#drawForm button[type="submit"]').click();
    await page.locator('#draw-fold').click();
    await page.locator('#draw-save').click();
    await page.waitForFunction(() => (document.querySelector('#drawMsg')?.textContent || '').includes('Als eigenes Foto gespeichert'));
    assert.equal(await page.locator('.modal').count(), 0, tag + ' erstes Speichern ohne Dialog');
    await page.locator('#draw-unfold').click();
    await page.locator('#draw-line').click();
    await gesture([await at(0.2, 0.85), await at(0.75, 0.25)]);
    await page.locator('#draw-fold').click();
    await page.locator('#draw-save').click();
    const aktualisieren = page.getByRole('button', { name: 'Vorhandene Zeichnung aktualisieren' });
    await aktualisieren.waitFor();
    const dialogBox = await aktualisieren.boundingBox();
    assert.ok(dialogBox && dialogBox.height >= 48, tag + ' dialog');
    await page.screenshot({ path: join(art, tag === 'phone' ? 'baudoku-zeichnung-dialog-390.png' : 'baudoku-zeichnung-dialog-820.png') });
    await page.getByRole('button', { name: 'Abbrechen' }).click();
    await page.waitForFunction(() => (document.querySelector('#drawMsg')?.textContent || '').includes('Nicht geändert'));
    assert.equal(await page.evaluate(() => window.__baudoku.db.all('photos').then((a) => a.filter((p) => p.source === 'drawing').length)), 1, tag);
    await page.locator('#draw-save').click();
    await page.getByRole('button', { name: 'Als neues Foto speichern' }).click();
    await page.waitForFunction(() => (document.querySelector('#drawMsg')?.textContent || '').includes('Als eigenes Foto gespeichert'));
    assert.equal(await page.evaluate(() => window.__baudoku.db.all('photos').then((a) => a.filter((p) => p.source === 'drawing').length)), 2, tag);
    await page.locator('#drawBack').click();
    await page.locator('.hdr button[aria-label="Zurück"]').click();
    await page.locator('[data-draw]').nth(1).waitFor();
    assert.equal(await page.locator('[data-draw]').count(), 3, tag);
    await page.getByText('Zeichnung', { exact: false }).first().waitFor();
    const check = await page.evaluate(async (id) => {
      const photos = await window.__baudoku.db.all('photos');
      const orig = photos.find((p) => p.id === id);
      const kopien = photos.filter((p) => p.source === 'drawing' && p.sourcePhotoId === id);
      const o1 = new Uint8Array(await orig.original.arrayBuffer());
      const s1 = new Uint8Array(await orig.stamped.arrayBuffer());
      const k = new Uint8Array(await kopien[0].stamped.arrayBuffer());
      return {
        original: o1.byteLength, stamped: s1.byteLength, copy: k.byteLength, anzahl: kopien.length,
        jpeg: k[0] === 0xff && k[1] === 0xd8, markup: (orig.markup?.strokes || []).length + (orig.markup?.doc?.texts || []).length,
        exportId: kopien.some((p) => p.id === orig.markup?.exportId), caption: kopien[0].caption,
      };
    }, photoId);
    assert.equal(check.original, before.original, tag);
    assert.equal(check.stamped, before.stamped, tag);
    assert.equal(check.jpeg, true, tag);
    assert.ok(check.copy > 100, tag);
    assert.equal(check.anzahl, 2, tag);
    assert.equal(check.exportId, true, tag);
    assert.match(check.caption, /^Zeichnung/);
    assert.ok(check.markup >= 1, tag);
    await page.reload();
    await page.locator('[data-draw]').nth(1).waitFor();
    assert.equal(await page.locator('[data-draw]').count(), 3, tag + ' reload');
    if (tag === 'phone') {
      await page.locator('.ph').nth(1).click();
      await page.locator('#pimg').waitFor();
      const shareBox = await page.locator('#sharePh').boundingBox();
      assert.ok(shareBox && shareBox.height >= 48, 'teilen');
      const [fotoDl] = await Promise.all([
        page.waitForEvent('download'),
        page.locator('#dl').click(),
      ]);
      assert.match(fotoDl.suggestedFilename(), /^Zeichnung_phone_\d{4}-\d{2}-\d{2}_\d+\.jpg$/);
      await fotoDl.saveAs(join(art, 'baudoku-zeichnung.jpg'));
      await page.screenshot({ path: join(art, 'baudoku-zeichnung-foto-390.png') });
      await page.locator('.hdr button[aria-label="Zurück"]').click();
      await page.locator('button[data-tab="export"]').click();
      await page.locator('#mkZip').click();
      const zipDl = await Promise.all([
        page.waitForEvent('download'),
        page.locator('#zipOut [data-act="download"]').click(),
      ]).then((x) => x[0]);
      const zipPath = '/tmp/baudoku-zeichnung.zip';
      await zipDl.saveAs(zipPath);
      const zip = await page.evaluate(async (buf) => {
        const blob = new Blob([Uint8Array.from(buf)]);
        const z = await window.JSZip.loadAsync(blob);
        const data = JSON.parse(await z.file('data.json').async('string'));
        const drawing = (data.photos || []).find((p) => p.source === 'drawing');
        const file = drawing?.stamped?.file;
        const bytes = file ? await z.file(file).async('uint8array') : null;
        return { n: (data.photos || []).length, jpeg: !!(bytes && bytes[0] === 255 && bytes[1] === 216) };
      }, [...readFileSync(zipPath)]);
      assert.equal(zip.n, 3, 'zip');
      assert.equal(zip.jpeg, true, 'zip jpeg');
    } else {
      await page.locator('#bSel').click();
      await page.locator('.ph').nth(1).click();
      await page.locator('#bShare').waitFor();
      assert.match(await page.locator('#bShare').innerText(), /Teilen \(1\)/);
      await page.locator('#bSel').click();
      await page.locator('.ph').nth(1).click();
      await page.locator('#pimg').waitFor();
      await page.screenshot({ path: join(art, 'baudoku-zeichnung-foto-820.png') });
    }
    assert.equal(errors.length, 0, errors.join('\n'));
    await page.close();
  }
} finally {
  await browser.close();
  child.kill();
}
