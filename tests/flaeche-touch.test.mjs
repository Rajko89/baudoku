import { createRequire } from 'node:module';
const require = createRequire('/tmp/baudoku-test/package.json');
const { chromium } = require('playwright-core');
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, readdirSync, copyFileSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';
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
    for (let x = 0; x < w; x++) row.push(90, 150, 190);
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
const pngPath = '/tmp/baudoku-flaeche.png';
writeFileSync(pngPath, png(400, 300));

function pdfText(buf) {
  const raw = buf.toString('latin1');
  let out = '';
  const re = /stream\r?\n([\s\S]*?)endstream/g;
  let m;
  while ((m = re.exec(raw))) {
    const body = Buffer.from(m[1], 'latin1');
    for (const slice of [body, body.subarray(0, Math.max(0, body.length - 1))]) {
      try { out += inflateSync(slice).toString('latin1'); break; } catch { /* next */ }
    }
  }
  return out || raw;
}

const port = 8827;
const serveRoot = '/tmp/baudoku-serve-flaeche';
mkdirSync(serveRoot, { recursive: true });
rmSync(join(serveRoot, 'baudoku'), { recursive: true, force: true });
symlinkSync(root, join(serveRoot, 'baudoku'));
const child = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: serveRoot, stdio: 'ignore' });
const base = `http://127.0.0.1:${port}/baudoku/`;
await new Promise((r) => setTimeout(r, 300));
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

async function tippe(page, ix, iy, pointer) {
  const p = await page.evaluate(([x, y]) => window.__baudoku.editor.clientPoint(x, y), [ix, iy]);
  const c = page.locator('.me canvas');
  const fire = (type, buttons) => c.dispatchEvent(type, { clientX: p.x, clientY: p.y, pointerId: 1, pointerType: pointer, bubbles: true, button: 0, buttons });
  await fire('pointerdown', 1);
  await fire('pointerup', 0);
}
async function modalOk(page, fields) {
  for (const [name, value] of Object.entries(fields)) await page.locator(`#modal-root [name="${name}"]`).fill(value);
  await page.locator('#modal-root button[type="submit"]').click();
}

try {
  for (const [tag, viewport, pointer] of [
    ['390', { width: 390, height: 844 }, 'touch'],
    ['820', { width: 820, height: 1180 }, 'mouse'],
  ]) {
    const page = await browser.newPage({ viewport, locale: 'de-DE', hasTouch: true });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(base);
    await page.locator('button', { hasText: 'Neues Projekt' }).click();
    await page.locator('input[name="name"]').fill('Flaeche ' + tag);
    await page.locator('#pf button[type="submit"]').click();
    await page.locator('#bGal').waitFor();
    await page.locator('#in-gallery').setInputFiles(pngPath);
    await page.locator('.ph').first().click();
    const planeBtn = page.locator('#bPlane');
    await planeBtn.waitFor();
    const bh = await planeBtn.boundingBox();
    assert.ok(bh.height >= 48, tag);
    await planeBtn.click();
    await page.waitForFunction(() => window.__baudoku.editor && document.querySelector('.me canvas')?.getBoundingClientRect().height > 80);
    for (const sel of ['[data-t="persp"]', '[data-t="area"]', '[data-t="deduct"]', '[data-t="line"]']) {
      const box = await page.locator(sel).boundingBox();
      assert.ok(box.height >= 48, sel);
    }
    const canvas = await page.locator('.me canvas').boundingBox();
    const tools = await page.locator('.me .tools').boundingBox();
    assert.ok(canvas.y + canvas.height <= tools.y + 2, 'Werkzeuge liegen auf dem Bild');
    for (const p of [[12, 12], [388, 12], [388, 288], [12, 288]]) await tippe(page, p[0], p[1], pointer);
    await page.locator('#modal-root [name="w"]').waitFor();
    await modalOk(page, { w: '4,20', h: '3,00' });
    await page.locator('#planeBox', { hasText: 'Referenz ca.' }).waitFor();
    await page.evaluate(() => { const t = document.querySelector('#toast'); if (t) t.classList.remove('show'); });
    await page.screenshot({ path: join(art, `baudoku-flaeche-ecken-${tag}.png`) });
    await page.locator('[data-t="area"]').click();
    for (const p of [[40, 40], [360, 40], [360, 250], [40, 250]]) await tippe(page, p[0], p[1], pointer);
    try {
      await page.locator('[data-a="finish"]').waitFor({ timeout: 4000 });
    } catch (e) {
      const info = await page.evaluate(() => ({ on: document.querySelector('.tools .on')?.innerText, ctx: document.querySelector('.ctx')?.innerText, hint: document.querySelector('.hint')?.innerText }));
      throw new Error(JSON.stringify(info) + ' ' + e.message);
    }
    await page.locator('[data-a="finish"]').click();
    await modalOk(page, { name: 'Dach' });
    await page.locator('[data-t="deduct"]').click();
    for (const p of [[120, 90], [280, 90], [280, 180], [120, 180]]) await tippe(page, p[0], p[1], pointer);
    await page.locator('[data-a="finish"]').click();
    await modalOk(page, { name: 'Fenster' });
    await page.locator('#planeBox', { hasText: 'Netto' }).waitFor();
    await page.locator('#planeBox', { hasText: 'Abzug Fenster' }).waitFor();
    await page.locator('#planeBox', { hasText: 'kein Ersatz für ein Aufmaß' }).waitFor();
    const sum = await page.evaluate(() => window.__baudoku.editor.summary());
    assert.ok(sum.net > 0 && sum.net < sum.gross, JSON.stringify(sum));
    assert.ok(sum.deductions.length === 1);
    await page.evaluate(() => { const t = document.querySelector('#toast'); if (t) t.classList.remove('show'); });
    await page.screenshot({ path: join(art, `baudoku-flaeche-ergebnis-${tag}.png`) });
    const ueber = await page.locator('[data-a="takeNet"]').boundingBox();
    assert.ok(ueber.height >= 48);
    if (tag === '390') {
      await page.locator('[data-a="takeNet"]').click();
      await modalOk(page, { bez: 'Dachfläche' });
      await page.waitForFunction(() => window.__baudoku.editor.measure.planeAufmassId);
      await page.locator('[data-a="back"]').click();
      await page.locator('#bPlane').waitFor();
      await page.reload();
      await page.locator('#bPlane').click();
      await page.waitForFunction(() => window.__baudoku.editor && window.__baudoku.editor.summary()?.net > 0);
      await page.locator('[data-a="back"]').click();
      await page.locator('#bPlane').waitFor();
      await page.locator('.hdr [data-nav]').click();
      await page.locator('.tabs button', { hasText: 'Aufmaß' }).click();
      await page.locator('.am-row input[data-k="bez"]').waitFor();
      assert.equal(await page.locator('.am-row input[data-k="bez"]').inputValue(), 'Dachfläche');
      await page.locator('.src', { hasText: 'Foto' }).waitFor();
      await page.locator('.src', { hasText: 'ca.' }).waitFor();
      await page.screenshot({ path: join(art, 'baudoku-flaeche-aufmass-390.png') });
      await page.locator('.tabs button', { hasText: 'Export' }).click();
      await page.locator('#oMi').uncheck();
      await page.locator('#oSk').uncheck();
      await page.locator('#oSheet').uncheck();
      await page.locator('#oNo').uncheck();
      await page.locator('#mkPdf').click();
      await page.locator('#pdfOut [data-act="download"]').waitFor();
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.locator('#pdfOut [data-act="download"]').click(),
      ]);
      const pdfPath = '/tmp/baudoku-flaeche.pdf';
      await download.saveAs(pdfPath);
      const text = pdfText(readFileSync(pdfPath));
      assert.match(text, /Netto ca\./);
      assert.match(text, /Abzug Fenster/);
      assert.match(text, /kein Ersatz/);
      let rendered = false;
      for (const bin of ['pdftoppm', 'pdftocairo']) {
        try {
          execFileSync(bin, ['-png', '-r', '110', pdfPath, '/tmp/baudoku-flaeche-seite'], { stdio: 'ignore' });
          rendered = true;
          break;
        } catch { /* next */ }
      }
      assert.ok(rendered, 'PDF-Renderer fehlt');
      const seiten = readdirSync('/tmp').filter((f) => f.startsWith('baudoku-flaeche-seite') && f.endsWith('.png')).sort();
      copyFileSync('/tmp/' + (seiten[1] || seiten[0]), join(art, 'baudoku-flaeche-pdf-390.png'));
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
} finally {
  await browser.close();
  child.kill();
}
