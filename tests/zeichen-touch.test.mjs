import { createRequire } from 'node:module';
const require = createRequire('/tmp/baudoku-test/package.json');
const { chromium } = require('playwright-core');
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
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
    for (let x = 0; x < w; x++) row.push(80, 140, 180);
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
const pngPath = '/tmp/baudoku-zeichen.png';
writeFileSync(pngPath, png(240, 160));

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

const port = 8824;
const serveRoot = '/tmp/baudoku-serve-zeichen';
mkdirSync(serveRoot, { recursive: true });
rmSync(join(serveRoot, 'baudoku'), { recursive: true, force: true });
symlinkSync(root, join(serveRoot, 'baudoku'));
const child = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: serveRoot, stdio: 'ignore' });
const base = `http://127.0.0.1:${port}/baudoku/`;
await new Promise((r) => setTimeout(r, 300));
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

async function projekt(page, name) {
  await page.goto(base);
  await page.locator('button', { hasText: 'Neues Projekt' }).click();
  await page.locator('input[name="name"]').fill(name);
  await page.locator('#pf button[type="submit"]').click();
  await page.locator('#bGal').waitFor();
  await page.locator('#in-gallery').setInputFiles(pngPath);
  await page.locator('[data-draw]').waitFor();
  return page.locator('[data-draw]').first().getAttribute('data-draw');
}
async function zeichnen(page) {
  await page.locator('[data-draw]').first().click();
  await page.waitForFunction(() => window.__baudoku.draw && document.querySelector('#drawCanvas')?.getBoundingClientRect().height > 80);
}
function at(page, nx, ny) {
  return page.evaluate(([x, y]) => window.__baudoku.draw.clientPoint(x, y), [nx, ny]);
}
async function zug(page, pts, pointer) {
  const c = page.locator('#drawCanvas');
  const fire = (type, p) => c.dispatchEvent(type, { clientX: p.x, clientY: p.y, pointerId: 1, pointerType: pointer, bubbles: true, button: 0, buttons: type === 'pointerup' ? 0 : 1 });
  await fire('pointerdown', pts[0]);
  for (const p of pts.slice(1)) await fire('pointermove', p);
  await fire('pointerup', pts[pts.length - 1]);
}
async function hoehe(page, sel) {
  const box = await page.locator(sel).boundingBox();
  assert.ok(box, sel);
  assert.ok(box.height >= 48, `${sel} ${box.height}`);
  return box;
}

try {
  for (const [tag, viewport, pointer] of [
    ['390', { width: 390, height: 844 }, 'touch'],
    ['820', { width: 820, height: 1180 }, 'mouse'],
  ]) {
    const page = await browser.newPage({ viewport, locale: 'de-DE', hasTouch: true });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const photoId = await projekt(page, 'Zeichen ' + tag);
    await zeichnen(page);
    const canvas = await page.locator('#drawCanvas').boundingBox();
    const dock = await page.locator('#drawDock').boundingBox();
    assert.ok(canvas.y + canvas.height <= dock.y + 2, 'Werkzeugleiste liegt auf dem Bild');
    for (const sel of ['#draw-undo', '#draw-redo', '#draw-delete', '#draw-snap', '#draw-dim', '#draw-marker', '#draw-symbols']) {
      await hoehe(page, sel);
    }
    await page.screenshot({ path: join(art, `baudoku-werkzeuge-${tag}.png`) });
    await page.locator('#draw-dim').click();
    await zug(page, [await at(page, 0.18, 0.42), await at(page, 0.78, 0.44)], pointer);
    await page.locator('#drawForm').waitFor({ state: 'visible' });
    await page.locator('#drawInput').fill('3,45');
    await page.locator('#drawUnit').selectOption('m');
    await page.locator('#drawForm button[type="submit"]').click();
    await page.waitForFunction(() => window.__baudoku.draw.dims().some((d) => d.text === '3,45 m'));
    await page.locator('#drawForm').waitFor({ state: 'hidden' });
    await page.screenshot({ path: join(art, `baudoku-masskette-${tag}.png`) });
    await page.locator('#draw-scale').click();
    await page.waitForFunction(() => window.__baudoku.draw.scaleOn());
    await page.locator('#draw-dim').click();
    await zug(page, [await at(page, 0.2, 0.62), await at(page, 0.5, 0.64)], pointer);
    await page.locator('#drawForm').waitFor({ state: 'visible' });
    const vorschlag = await page.locator('#drawInput').inputValue();
    assert.match(vorschlag, /,/);
    await page.locator('#drawForm button[type="submit"]').click();
    await page.waitForFunction(() => window.__baudoku.draw.dims().some((d) => d.approx && String(d.text).startsWith('ca. ')));
    await page.locator('#draw-symbols').click();
    await page.locator('#symbolBar').waitFor({ state: 'visible' });
    for (const name of ['Schaden', 'Undicht', 'Wasserlauf', 'Dachrinne', 'Durchdringung']) {
      await page.locator('#symbolBar button', { hasText: name }).click();
    }
    const arten = await page.evaluate(() => window.__baudoku.draw.shapes().map((s) => s.kind));
    for (const kind of ['damage', 'leak', 'water', 'gutter', 'penetration']) assert.ok(arten.includes(kind), kind);
    await page.locator('#symbolBar').evaluate((el) => { el.scrollLeft = 0; });
    await page.screenshot({ path: join(art, `baudoku-symbole-${tag}.png`) });
    await page.locator('#draw-marker').click();
    await zug(page, [await at(page, 0.3, 0.25)], pointer);
    await page.locator('#drawForm').waitFor({ state: 'visible' });
    await page.locator('#drawInput').fill('Riss an der Traufe');
    await page.locator('#drawForm button[type="submit"]').click();
    await page.waitForFunction(() => window.__baudoku.draw.markers().some((m) => m.n === 1 && m.note === 'Riss an der Traufe'));
    await page.screenshot({ path: join(art, `baudoku-marker-${tag}.png`) });
    await page.locator('#draw-undo').click();
    await page.waitForFunction(() => window.__baudoku.draw.markers().every((m) => !m.note));
    await page.locator('#draw-undo').click();
    await page.waitForFunction(() => window.__baudoku.draw.markers().length === 0);
    await page.locator('#draw-redo').click();
    await page.waitForFunction(() => window.__baudoku.draw.markers().length === 1);
    await page.locator('#draw-redo').click();
    await page.waitForFunction(() => window.__baudoku.draw.markers().some((m) => m.note === 'Riss an der Traufe'));
    await page.locator('#draw-snap').click();
    await page.waitForFunction(() => !document.querySelector('#draw-snap').classList.contains('on'));
    await page.locator('#draw-pen').click();
    await page.locator('#penBar button', { hasText: 'Weiß' }).click();
    await page.waitForFunction(() => window.__baudoku.draw.pen().color === '#ffffff');
    const zoomVorher = await page.evaluate(() => window.__baudoku.draw.zoom());
    await page.evaluate(() => {
      const c = document.querySelector('#drawCanvas');
      const r = c.getBoundingClientRect();
      const fire = (type, id, x, y) => c.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: id, pointerType: 'touch', buttons: type === 'pointerup' ? 0 : 1 }));
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      fire('pointerdown', 7, cx - 20, cy);
      fire('pointerdown', 8, cx + 20, cy);
      fire('pointermove', 7, cx - 90, cy);
      fire('pointermove', 8, cx + 90, cy);
      fire('pointerup', 7, cx - 90, cy);
      fire('pointerup', 8, cx + 90, cy);
    });
    const zoomNachher = await page.evaluate(() => window.__baudoku.draw.zoom());
    assert.ok(zoomNachher > zoomVorher + 0.2, `Pinch ${zoomVorher} -> ${zoomNachher}`);
    await page.reload();
    await page.waitForFunction(() => window.__baudoku.draw && window.__baudoku.draw.dims().some((d) => d.text === '3,45 m') && window.__baudoku.draw.pen().color === '#ffffff');
    assert.deepEqual(errors, []);
    await page.close();
  }

  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'de-DE', hasTouch: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const photoId = await projekt(page, 'Notiz am Foto');
  await page.evaluate(async (id) => {
    const ph = await window.__baudoku.db.get('photos', id);
    await window.__baudoku.db.put('notes', { id: 'n-foto', projectId: ph.projectId, created: Date.now(), updated: Date.now(), text: 'Rinne undicht', photoId: id });
    await window.__baudoku.db.put('notes', { id: 'n-lose', projectId: ph.projectId, created: Date.now() + 1, updated: Date.now(), text: 'Allgemeine Notiz ohne Foto', photoId: null });
    ph.markup = { ...(ph.markup || {}), doc: { ...(ph.markup?.doc || {}), markers: [{ id: 'm1', n: 1, x: 0.28, y: 0.35, note: 'Riss an der Traufe' }] } };
    await window.__baudoku.db.put('photos', ph);
  }, photoId);
  await page.reload();
  await page.locator('.photo-note', { hasText: 'Rinne undicht' }).waitFor();
  await page.locator('.ph').first().click();
  await page.locator('#photoNotes', { hasText: 'Rinne undicht' }).waitFor();
  const noteBox = await page.locator('#photoNotes').boundingBox();
  const bild = await page.locator('#pimg').boundingBox();
  assert.ok(noteBox.y >= bild.y + bild.height - 2);
  await page.screenshot({ path: join(art, 'baudoku-notiz-foto-390.png') });
  await page.locator('button', { hasText: 'Notiz' }).click();
  await page.locator('#nlist', { hasText: 'Rinne undicht' }).waitFor();
  await page.locator('#nlist', { hasText: 'Allgemeine Notiz ohne Foto' }).waitFor();
  await page.locator('.tabs button', { hasText: 'Export' }).click();
  await page.locator('#oAm').uncheck();
  await page.locator('#oMi').uncheck();
  await page.locator('#oSk').uncheck();
  await page.locator('#oSheet').uncheck();
  await page.locator('#mkPdf').click();
  await page.locator('#pdfOut [data-act="download"]').waitFor();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#pdfOut [data-act="download"]').click(),
  ]);
  const pdfPath = '/tmp/baudoku-notiz.pdf';
  await download.saveAs(pdfPath);
  const text = pdfText(readFileSync(pdfPath));
  assert.match(text, /Notiz: Rinne undicht/);
  assert.match(text, /Riss an der Traufe/);
  assert.match(text, /Allgemeine Notiz ohne Foto/);
  assert.doesNotMatch(text, /zu Foto Nr\./);
  let pngOut = null;
  for (const bin of ['pdftoppm', 'pdftocairo']) {
    try {
      execFileSync(bin, bin === 'pdftoppm' ? ['-png', '-r', '110', pdfPath, '/tmp/baudoku-notiz-seite'] : ['-png', '-r', '110', pdfPath, '/tmp/baudoku-notiz-seite'], { stdio: 'ignore' });
      pngOut = bin;
      break;
    } catch { /* nächster Renderer */ }
  }
  if (!pngOut) {
    const viewer = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await viewer.goto('file://' + pdfPath);
    await viewer.waitForTimeout(800);
    await viewer.screenshot({ path: join(art, 'baudoku-notiz-pdf-390.png') });
    await viewer.close();
  } else {
    const { readdirSync, copyFileSync } = await import('node:fs');
    const seiten = readdirSync('/tmp').filter((f) => f.startsWith('baudoku-notiz-seite') && f.endsWith('.png')).sort();
    assert.ok(seiten.length >= 1, 'PDF-Seite fehlt');
    const fotoSeite = seiten[1] || seiten[0];
    copyFileSync('/tmp/' + fotoSeite, join(art, 'baudoku-notiz-pdf-390.png'));
  }
  await page.locator('.tabs button', { hasText: 'Fotos' }).click();
  await page.locator('#bSketch').click();
  await page.waitForFunction(() => document.querySelector('#drawTitle')?.textContent === 'Skizze' && document.querySelector('#drawCanvas')?.getBoundingClientRect().height > 80);
  const raster = await page.evaluate(() => {
    const c = document.querySelector('#drawCanvas');
    const g = c.getContext('2d');
    const w = c.width, h = c.height;
    const x0 = Math.floor(w * 0.4), x1 = Math.floor(w * 0.6);
    const y0 = Math.floor(h * 0.3), y1 = Math.floor(h * 0.7);
    let grau = 0, hell = 0;
    for (let y = y0; y < y1; y += 3) {
      for (let x = x0; x < x1; x += 3) {
        const p = g.getImageData(x, y, 1, 1).data;
        if (p[0] > 245 && p[1] > 245 && p[2] > 245) hell++;
        else if (p[0] > 150 && p[0] < 220 && p[2] > p[0] - 10) grau++;
      }
    }
    return { grau, hell };
  });
  assert.ok(raster.grau > 8 && raster.hell > 8, JSON.stringify(raster));
  await page.screenshot({ path: join(art, 'baudoku-skizze-390.png') });
  await page.locator('#draw-symbols').click();
  await page.locator('#symbolBar button', { hasText: 'Kreis' }).click();
  await page.locator('#draw-fold').click();
  await page.locator('#draw-save').click();
  await page.waitForFunction(() => document.querySelector('#drawMsg')?.textContent?.includes('Foto'));
  assert.deepEqual(errors, []);
  await page.close();
} finally {
  await browser.close();
  child.kill();
}
