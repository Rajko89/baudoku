import { createRequire } from 'node:module';
const require = createRequire('/tmp/baudoku-test/package.json');
const { chromium } = require('playwright-core');
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const art = '/opt/cursor/artifacts';
mkdirSync(art, { recursive: true });

function png(w, h) {
  // White field, black rectangle outline (detectable) .
  const raw = [];
  for (let y = 0; y < h; y++) {
    const row = [0];
    for (let x = 0; x < w; x++) {
      const border = (x >= 40 && x <= 320 && (y >= 36 && y <= 39 || y >= 210 && y <= 213)) || (y >= 36 && y <= 213 && (x >= 40 && x <= 43 || x >= 317 && x <= 320));
      const c = border ? 20 : 245;
      row.push(c, c, border ? 20 : 240);
    }
    raw.push(Buffer.from(row));
  }
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const chunk = (type, data) => {
    const t = Buffer.from(type);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])) >>> 0);
    return Buffer.concat([len, t, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const idat = deflateSync(Buffer.concat(raw));
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}
function crc32(buf) {
  let c = ~0;
  for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return ~c;
}
function pdfText(buf) {
  const raw = buf.toString('latin1');
  let out = raw;
  const re = /stream\r?\n([\s\S]*?)endstream/g;
  let m;
  while ((m = re.exec(raw))) {
    const body = Buffer.from(m[1], 'latin1');
    for (const slice of [body, body.subarray(0, Math.max(0, body.length - 1)), body.subarray(0, Math.max(0, body.length - 2))]) {
      try { out += inflateSync(slice).toString('latin1'); break; } catch { /* next */ }
    }
  }
  return out;
}

const pngPath = '/tmp/baudoku-rect.png';
writeFileSync(pngPath, png(400, 280));

const port = 8773;
const serveRoot = '/tmp/baudoku-serve-root';
mkdirSync(serveRoot, { recursive: true });
rmSync(join(serveRoot, 'baudoku'), { recursive: true, force: true });
symlinkSync(root, join(serveRoot, 'baudoku'));
const child = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: serveRoot, stdio: 'ignore' });
const base = `http://127.0.0.1:${port}/baudoku/`;
await new Promise((r) => setTimeout(r, 300));

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errors = [];
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    acceptDownloads: true,
    locale: 'de-DE',
    geolocation: { latitude: 51.35, longitude: 8.28 },
    permissions: ['geolocation'],
  });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon/i.test(m.text()) && !/Failed to load resource/i.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => { errors.push(String(e)); console.log('PAGEERROR', e); });
  page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('favicon')) errors.push('HTTP ' + r.status() + ' ' + r.url()); });

  await page.goto(base + 'css/app.css');
  await page.evaluate(async () => {
    await new Promise((res, rej) => { const r = indexedDB.deleteDatabase('baudoku'); r.onsuccess = () => res(); r.onerror = () => rej(r.error); r.onblocked = () => res(); });
    const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAAB2EmJcAAAADklEQVQI12P4z8DAwMAAAAKkAAD3kG0IAAAAAElFTkSuQmCC'), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: 'image/png' });
    await new Promise((resolve, reject) => {
      const req = indexedDB.open('baudoku', 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        d.createObjectStore('projects', { keyPath: 'id' });
        for (const s of ['photos', 'notes', 'aufmass']) d.createObjectStore(s, { keyPath: 'id' }).createIndex('projectId', 'projectId');
        d.createObjectStore('settings', { keyPath: 'key' });
      };
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(['projects', 'photos', 'notes', 'aufmass', 'settings'], 'readwrite');
        tx.objectStore('projects').put({ id: 'p-old', name: 'Altbau Schulstrasse', kunde: 'Bestand', datum: '2024-05-01', created: 1, updated: 2 });
        tx.objectStore('projects').put({ id: 'p-keep', name: 'Neubau Keep', kunde: 'Andere', datum: '2024-06-01', created: 2, updated: 1 });
        tx.objectStore('photos').put({ id: 'ph-old', projectId: 'p-old', created: 1, time: 1, caption: 'Bestandsfoto', original: blob, stamped: blob, thumb: blob, width: 8, height: 8, source: 'gallery' });
        tx.objectStore('notes').put({ id: 'n-old', projectId: 'p-old', created: 1, text: 'Alte Notiz bleibt', photoId: null });
        tx.objectStore('notes').put({ id: 'n-keep', projectId: 'p-keep', created: 1, text: 'Notiz des anderen Projekts', photoId: null });
        tx.objectStore('aufmass').put({ id: 'am-old', projectId: 'p-old', order: 1, pos: '01', bez: 'Traufe Bestand', menge: 12.5, expr: '12,5', einheit: 'm' });
        tx.objectStore('aufmass').put({ id: 'am-keep', projectId: 'p-keep', order: 1, pos: '01', bez: 'Ortgang bleibt', menge: 3, expr: '3', einheit: 'm' });
        tx.objectStore('settings').put({ key: 'app', value: { firma: 'Musterdach GmbH', bearbeiter: 'Ada Test', geocode: false, stampFirma: true, pdfStamped: true } });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  });

  await page.goto(base);
  await page.waitForSelector('text=Neues Projekt');
  await page.locator('button[aria-label="Einstellungen"]').click();
  await page.waitForSelector('input[name="firma"]');
  assert.equal(await page.locator('input[name="firma"]').inputValue(), 'Musterdach GmbH');
  assert.equal(await page.locator('input[name="stampFirma"]').isChecked(), true);
  assert.equal(await page.locator('input[name="bearbeiter"]').inputValue(), 'Ada Test');

  await page.locator('.hdr button[aria-label="Zurück"]').click();
  await page.waitForSelector('text=Altbau Schulstrasse');
  await page.getByText('Altbau Schulstrasse').click();
  await page.locator('button[data-tab="aufmass"]').click();
  await page.waitForSelector('input[value="Traufe Bestand"]');
  assert.equal(await page.locator('.totals').count(), 0);
  assert.match(await page.locator('#amlist').innerText(), /12,50/);

  await page.locator('.hdr button[aria-label="Zurück"]').click();
  await page.locator('[data-del-project="p-old"]').click();
  await page.waitForSelector('text=Projekt löschen?');
  assert.match(await page.locator('.modal').innerText(), /Altbau Schulstrasse/);
  assert.match(await page.locator('.modal').innerText(), /Backup/);
  await page.getByRole('button', { name: 'Abbrechen' }).click();
  await page.waitForSelector('text=Altbau Schulstrasse');

  await page.locator('[data-del-project="p-old"]').click();
  await page.getByRole('button', { name: 'Endgültig löschen' }).click();
  await page.waitForTimeout(500);
  const still = await page.getByText('Altbau Schulstrasse').count();
  if (still) {
    console.log('BODY', await page.locator('body').innerText());
    console.log('ERRORS', errors);
    const dbg = await page.evaluate(async () => {
      try {
        const db = await new Promise((res, rej) => { const r = indexedDB.open('baudoku'); r.onsuccess = () => res(r.result); r.onerror = () => rej(String(r.error)); });
        const names = [...db.objectStoreNames];
        const projects = await new Promise((res, rej) => { const q = db.transaction('projects').objectStore('projects').getAll(); q.onsuccess = () => res(q.result.map(p => p.name)); q.onerror = () => rej(q.error); });
        return { version: db.version, names, projects };
      } catch (e) { return { err: String(e) }; }
    });
    console.log('DB', JSON.stringify(dbg));
  }
  assert.equal(still, 0);
  const left = await page.evaluate(async () => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('baudoku'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const names = ['projects', 'photos', 'notes', 'aufmass', 'sketches'];
    const out = {};
    for (const name of names) {
      out[name] = await new Promise((res, rej) => {
        const q = db.transaction(name).objectStore(name).getAll();
        q.onsuccess = () => res(q.result.map((x) => x.projectId || x.id));
        q.onerror = () => rej(q.error);
      });
    }
    db.close();
    return out;
  });
  for (const name of ['photos', 'notes', 'aufmass', 'sketches']) assert.equal(left[name].includes('p-old'), false, name);
  assert.equal(left.projects.includes('p-old'), false);
  assert.ok(left.projects.includes('p-keep'));
  assert.ok(left.notes.includes('p-keep'));
  assert.ok(left.aufmass.includes('p-keep'));

  await page.getByText('Neubau Keep', { exact: true }).click();
  await page.locator('button[data-tab="aufmass"]').click();
  await page.waitForSelector('input[value="Ortgang bleibt"]');
  assert.equal(await page.locator('input[value="Ortgang bleibt"]').count(), 1);
  await page.locator('button[data-tab="export"]').click();
  await page.locator('#mkPdf').click();
  const pdfDl = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#pdfOut [data-act="download"]').click(),
  ]).then((x) => x[0]);
  const pdfPath = join(art, 'baudoku-stamp-sample.pdf');
  await pdfDl.saveAs(pdfPath);
  const text = pdfText(readFileSync(pdfPath));
  assert.match(text, /Ortgang bleibt/);
  assert.match(text, /Musterdach GmbH/);
  const banned = String.fromCharCode(77, 101, 115, 99, 104, 101, 100, 101);
  assert.equal(text.includes(banned), false);

  await page.locator('#mkZip').click();
  const zipDl = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#zipOut [data-act="download"]').click(),
  ]).then((x) => x[0]);
  const zipPath = '/tmp/baudoku-backup.zip';
  await zipDl.saveAs(zipPath);
  const zipNote = await page.evaluate(async (buf) => {
    const blob = new Blob([Uint8Array.from(buf)]);
    const zip = await window.JSZip.loadAsync(blob);
    const data = JSON.parse(await zip.file('data.json').async('string'));
    return { projects: (data.projects || []).map((p) => p.name), aufmass: (data.aufmass || []).map((r) => r.bez), sketches: Array.isArray(data.sketches) };
  }, [...readFileSync(zipPath)]);
  assert.ok(zipNote.projects.includes('Neubau Keep'));
  assert.ok(zipNote.aufmass.includes('Ortgang bleibt'));
  assert.equal(zipNote.sketches, true);

  await page.locator('.hdr button[aria-label="Zurück"]').click();
  await page.locator('button[aria-label="Einstellungen"]').click();
  await page.locator('#in-import').setInputFiles(zipPath);
  await page.waitForSelector('text=importiert');
  await page.waitForSelector('text=Neubau Keep (Import)');
  await page.getByText('Neubau Keep (Import)').click();
  await page.locator('button[data-tab="aufmass"]').click();
  await page.waitForSelector('input[value="Ortgang bleibt"]');

  await page.locator('.hdr button[aria-label="Zurück"]').click();
  await page.getByText('Neubau Keep', { exact: true }).click();
  await page.locator('button[data-tab="sketches"]').click();
  await page.locator('h2', { hasText: 'Skizze' }).first().waitFor();
  await page.waitForSelector('text=Flächenskizze');
  await page.locator('button[data-tab="photos"]').click();
  await page.waitForSelector('text=Foto aufnehmen');
  await page.locator('#in-gallery').setInputFiles(pngPath);
  await page.waitForSelector('[data-draw]');
  const zeichnenLabel = await page.locator('[data-draw]').innerText();
  if (!/Zeichnen/.test(zeichnenLabel)) throw new Error('Zeichnen-Schaltfläche fehlt: ' + zeichnenLabel);
  const photoId = await page.locator('[data-draw]').getAttribute('data-draw');
  const before = await page.evaluate(async (id) => {
    const ph = await window.__baudoku.db.get('photos', id);
    const buf = new Uint8Array(await ph.original.arrayBuffer());
    const stamp = new Uint8Array(await ph.stamped.arrayBuffer());
    return { size: buf.length, head: [...buf.slice(0, 12)].join(','), stamp: stamp.length };
  }, photoId);
  await page.locator('[data-draw]').click();
  await page.waitForSelector('#drawCanvas');
  await page.waitForFunction(() => { const r = document.querySelector('#drawCanvas')?.getBoundingClientRect(); return r && r.height > 120; });
  const box = await page.locator('#draw-undo').boundingBox();
  if (!(box && box.height >= 48)) throw new Error('undo target ' + JSON.stringify(box));
  const at = async (nx, ny) => page.evaluate(([x, y]) => window.__baudoku.draw.clientPoint(x, y), [nx, ny]);
  const stroke = async (pts) => {
    const c = page.locator('#drawCanvas');
    const fire = (type, p) => c.dispatchEvent(type, { clientX: p.x, clientY: p.y, pointerId: 1, pointerType: 'touch', bubbles: true, button: 0, buttons: type === 'pointerup' ? 0 : 1 });
    await fire('pointerdown', pts[0]);
    for (const p of pts.slice(1)) await fire('pointermove', p);
    await fire('pointerup', pts[pts.length - 1]);
  };
  await stroke([await at(0.2, 0.3), await at(0.45, 0.35), await at(0.7, 0.55)]);
  await page.locator('#draw-line').click();
  await stroke([await at(0.15, 0.8), await at(0.85, 0.2)]);
  await page.locator('#draw-pen').click();
  await stroke([await at(0.3, 0.7), await at(0.5, 0.5), await at(0.6, 0.75)]);
  await page.waitForFunction(() => window.__baudoku.draw.count() === 3);
  const kinds = await page.evaluate(() => window.__baudoku.draw.strokes());
  if (kinds[0].tool !== 'pen' || kinds[0].n < 3) throw new Error('pen ' + JSON.stringify(kinds));
  if (kinds[1].tool !== 'line' || kinds[1].n !== 2) throw new Error('line ' + JSON.stringify(kinds));
  await page.screenshot({ path: join(art, 'baudoku-draw-on-photo.png') });
  await page.locator('#draw-photo').click();
  await page.waitForFunction(() => /Foto an/.test(document.querySelector('#draw-photo').innerText));
  if (await page.evaluate(() => window.__baudoku.draw.count()) !== 3) throw new Error('hide dropped strokes');
  await page.screenshot({ path: join(art, 'baudoku-draw-hidden.png') });
  await page.locator('#draw-photo').click();
  await page.waitForFunction(() => /Foto aus/.test(document.querySelector('#draw-photo').innerText));
  await page.locator('#draw-undo').click();
  await page.waitForFunction(() => window.__baudoku.draw.count() === 2);
  await page.screenshot({ path: join(art, 'baudoku-draw-after-undo.png') });
  await page.locator('#draw-undo').click();
  await page.locator('#draw-undo').click();
  await page.waitForFunction(() => window.__baudoku.draw.count() === 0);
  await page.locator('#draw-pen').click();
  await stroke([await at(0.25, 0.25), await at(0.6, 0.4)]);
  await page.waitForFunction(() => window.__baudoku.draw.count() === 1);
  await page.waitForFunction(async (id) => {
    const ph = await window.__baudoku.db.get('photos', id);
    return ph.markup?.strokes?.length === 1;
  }, photoId);
  await page.reload();
  await page.waitForSelector('#draw-undo');
  await page.waitForFunction(() => window.__baudoku.draw && window.__baudoku.draw.count() === 1);
  const after = await page.evaluate(async (id) => {
    const ph = await window.__baudoku.db.get('photos', id);
    const buf = new Uint8Array(await ph.original.arrayBuffer());
    const stamp = new Uint8Array(await ph.stamped.arrayBuffer());
    return { size: buf.length, head: [...buf.slice(0, 12)].join(','), stamp: stamp.length, strokes: ph.markup.strokes.length };
  }, photoId);
  if (after.size !== before.size || after.head !== before.head || after.stamp !== before.stamp) throw new Error('photo bytes changed ' + JSON.stringify({ before, after }));
  if (after.strokes !== 1) throw new Error('strokes not stored');
  await page.locator('#drawBack').click();
  await page.locator('.hdr button[aria-label="Zurück"]').click();
  await page.locator('button[data-tab="export"]').click();
  await page.locator('#mkPdf').click();
  const drawPdf = await Promise.all([page.waitForEvent('download'), page.locator('#pdfOut [data-act="download"]').click()]).then((x) => x[0]);
  await drawPdf.saveAs(join(art, 'baudoku-draw-export.pdf'));

  await page.locator('button[data-tab="sketches"]').click();
  await page.locator('#newSheet').click();
  await page.locator('.modal input[name="title"]').fill('Blatt Nord');
  await page.locator('.modal button[type="submit"]').click();
  await page.waitForSelector('#drawCanvas');
  await page.waitForFunction(() => { const r = document.querySelector('#drawCanvas')?.getBoundingClientRect(); return r && r.height > 120 && window.__baudoku.draw; });
  const sheetAt = async (nx, ny) => page.evaluate(([x, y]) => window.__baudoku.draw.clientPoint(x, y), [nx, ny]);
  const sheetStroke = async (pts) => {
    const c = page.locator('#drawCanvas');
    const fire = (type, p) => c.dispatchEvent(type, { clientX: p.x, clientY: p.y, pointerId: 1, pointerType: 'touch', bubbles: true, button: 0, buttons: type === 'pointerup' ? 0 : 1 });
    await fire('pointerdown', pts[0]);
    for (const p of pts.slice(1)) await fire('pointermove', p);
    await fire('pointerup', pts[pts.length - 1]);
  };
  await sheetStroke([await sheetAt(0.2, 0.2), await sheetAt(0.5, 0.35), await sheetAt(0.8, 0.25)]);
  await page.locator('#draw-line').click();
  await sheetStroke([await sheetAt(0.2, 0.7), await sheetAt(0.8, 0.55)]);
  await page.waitForFunction(() => window.__baudoku.draw.count() === 2);
  await page.locator('#draw-undo').click();
  await page.waitForFunction(() => window.__baudoku.draw.count() === 1);
  await page.screenshot({ path: join(art, 'baudoku-freie-skizze.png') });
  const sheetUrl = page.url();
  await page.reload();
  await page.waitForFunction(() => window.__baudoku.draw && window.__baudoku.draw.count() === 1);
  if (!/Blatt Nord/.test(await page.locator('#drawTitle').innerText())) throw new Error('Titel fehlt nach Reload');
  await page.locator('#drawBack').click();
  await page.waitForSelector('text=Blatt Nord');
  await page.locator('button[data-tab="export"]').click();
  await page.locator('#mkPdf').click();
  const sheetPdf = await Promise.all([page.waitForEvent('download'), page.locator('#pdfOut [data-act="download"]').click()]).then((x) => x[0]);
  const sheetPdfPath = join(art, 'baudoku-freie-skizze.pdf');
  await sheetPdf.saveAs(sheetPdfPath);
  const sheetPdfText = pdfText(readFileSync(sheetPdfPath));
  if (!sheetPdfText.includes('Blatt Nord')) throw new Error('PDF ohne freie Skizze');
  void sheetUrl;

  await page.evaluate(async (bytes) => {
    const blob = new Blob([Uint8Array.from(bytes)], { type: 'image/png' });
    const db = window.__baudoku.db;
    await db.put('photos', { id: 'ph-v14', projectId: 'p-keep', created: 10, time: 10, caption: 'Altzeichnung', original: blob, stamped: blob, thumb: blob, width: 8, height: 8, source: 'gallery', markup: { hidePhoto: false, strokes: [{ tool: 'pen', points: [[0.2, 0.2], [0.4, 0.5], [0.6, 0.3]] }] } });
    await db.put('sheets', { id: 'sh-v14', projectId: 'p-keep', title: 'Altblatt', width: 1000, height: 1400, created: 10, updated: 10, strokes: [{ tool: 'line', points: [[0.1, 0.2], [0.8, 0.2]] }] });
    await db.put('sketches', {
      id: 'sk-v14', projectId: 'p-keep', title: 'Altskitze', created: 10, updated: 10, imgW: 1000, imgH: 1000, faces: [], viewKind: 'unknown',
      vertices: [{ id: 'v1', x: 100, y: 100 }, { id: 'v2', x: 500, y: 100 }, { id: 'v3', x: 500, y: 400 }, { id: 'v4', x: 100, y: 400 }],
      edges: [
        { id: 'e1', v1: 'v1', v2: 'v2', label: 'a', lengthM: 8.5 },
        { id: 'e2', v1: 'v2', v2: 'v3', label: 'b', lengthM: 4 },
        { id: 'e3', v1: 'v3', v2: 'v4', label: 'c', lengthM: 8.5 },
        { id: 'e4', v1: 'v4', v2: 'v1', label: 'd', lengthM: 4 },
      ],
    });
  }, [...readFileSync(pngPath)]);
  await page.locator('button[data-tab="photos"]').click();
  await page.locator('[data-draw="ph-v14"]').click();
  try {
    await page.waitForSelector('#drawBack', { timeout: 8000 });
    await page.waitForFunction(() => window.__baudoku.draw && window.__baudoku.draw.count() >= 1);
  } catch (e) {
    console.log('URL', page.url());
    console.log('BODY', await page.locator('body').innerText());
    console.log('ERRORS', errors);
    throw e;
  }
  await page.locator('#drawBack').click();
  await page.locator('.hdr button[aria-label="Zurück"]').click();
  await page.locator('button[data-tab="sketches"]').click();
  await page.getByText('Altblatt', { exact: true }).click();
  await page.waitForFunction(() => window.__baudoku.draw && window.__baudoku.draw.count() === 1 && /Altblatt/.test(document.querySelector('#drawTitle').textContent));
  await page.locator('#drawBack').click();
  await page.getByText('Altskitze', { exact: true }).click();
  await page.waitForFunction(() => window.__baudoku.draw && window.__baudoku.draw.edges() === 4);
  const legacyKept = await page.evaluate(async () => {
    const sk = await window.__baudoku.db.get('sketches', 'sk-v14');
    return sk.vertices.length === 4 && sk.edges.length === 4 && sk.edges[0].lengthM === 8.5;
  });
  if (!legacyKept) throw new Error('alte Flächenskizze wurde verändert');
  await page.locator('#drawBack').click();

  await page.locator('#newSheet').click();
  await page.locator('.modal input[name="title"]').fill('Rechteck Dach');
  await page.locator('.modal button[type="submit"]').click();
  await page.waitForFunction(() => { const r = document.querySelector('#drawCanvas')?.getBoundingClientRect(); return r && r.height > 120 && window.__baudoku.draw; });
  const pt = async (nx, ny) => page.evaluate(([x, y]) => window.__baudoku.draw.clientPoint(x, y), [nx, ny]);
  const gesture = async (pts) => {
    const c = page.locator('#drawCanvas');
    const fire = (type, p) => c.dispatchEvent(type, { clientX: p.x, clientY: p.y, pointerId: 1, pointerType: 'touch', bubbles: true, button: 0, buttons: type === 'pointerup' ? 0 : 1 });
    await fire('pointerdown', pts[0]);
    for (const p of pts.slice(1)) await fire('pointermove', p);
    await fire('pointerup', pts[pts.length - 1]);
  };
  const waitMsg = (needle) => page.waitForFunction((s) => (document.querySelector('#drawMsg')?.textContent || '').includes(s), needle);
  await page.locator('#draw-text').click();
  await gesture([await pt(0.5, 0.12)]);
  await page.waitForFunction(() => document.activeElement?.id === 'drawInput' && document.querySelector('#drawInput')?.getAttribute('inputmode') === 'text');
  await page.locator('#drawInput').fill('Kamin');
  await page.locator('#drawForm button[type="submit"]').click();
  await page.waitForFunction(() => window.__baudoku.draw.texts().some((t) => t.text === 'Kamin') && document.querySelector('#drawForm').hidden);
  await gesture([await pt(0.5, 0.12)]);
  await page.waitForFunction(() => document.activeElement?.id === 'drawInput');
  await page.locator('#drawInput').fill('Kamin Ost');
  await page.locator('#drawForm button[type="submit"]').click();
  await page.waitForFunction(() => window.__baudoku.draw.texts().some((t) => t.text === 'Kamin Ost') && document.querySelector('#drawForm').hidden);
  const from = await pt(0.5, 0.12);
  const to = await pt(0.66, 0.12);
  const canvas = page.locator('#drawCanvas');
  await canvas.dispatchEvent('pointerdown', { clientX: from.x, clientY: from.y, pointerId: 1, pointerType: 'touch', bubbles: true, button: 0, buttons: 1 });
  await canvas.dispatchEvent('pointermove', { clientX: to.x, clientY: to.y, pointerId: 1, pointerType: 'touch', bubbles: true, button: 0, buttons: 1 });
  await canvas.dispatchEvent('pointerup', { clientX: to.x, clientY: to.y, pointerId: 1, pointerType: 'touch', bubbles: true, button: 0, buttons: 0 });
  await page.waitForFunction(() => window.__baudoku.draw.texts().some((t) => t.text === 'Kamin Ost' && t.x > 0.55));
  if (!await page.locator('#drawForm').isHidden()) await page.locator('#drawForm button[type="submit"]').click();

  await page.locator('#draw-line').click();
  await gesture([await pt(0.2, 0.2), await pt(0.8, 0.8)]);
  await gesture([await pt(0.2, 0.8), await pt(0.8, 0.2)]);
  const end = await pt(0.23, 0.17);
  const cross = await pt(0.52, 0.48);
  await canvas.dispatchEvent('pointerdown', { clientX: end.x, clientY: end.y, pointerId: 1, pointerType: 'touch', bubbles: true, button: 0, buttons: 1 });
  await page.waitForSelector('#snapMark:not([hidden])');
  await page.screenshot({ path: join(art, 'baudoku-snap-endpunkt.png') });
  await canvas.dispatchEvent('pointermove', { clientX: cross.x, clientY: cross.y, pointerId: 1, pointerType: 'touch', bubbles: true, button: 0, buttons: 1 });
  await page.waitForSelector('#snapMark:not([hidden])');
  await page.screenshot({ path: join(art, 'baudoku-snap.png') });
  await canvas.dispatchEvent('pointerup', { clientX: cross.x, clientY: cross.y, pointerId: 1, pointerType: 'touch', bubbles: true, button: 0, buttons: 0 });
  await page.waitForFunction(() => window.__baudoku.draw.count() === 3);
  for (let i = 0; i < 3; i++) await page.locator('#draw-undo').click();
  await page.waitForFunction(() => window.__baudoku.draw.count() === 0);

  const rect = [[0.22, 0.28], [0.78, 0.28], [0.78, 0.62], [0.22, 0.62]];
  for (let i = 0; i < rect.length; i++) {
    const a = rect[i], b = rect[(i + 1) % rect.length];
    await gesture([await pt(a[0], a[1]), await pt(b[0], b[1])]);
  }
  await page.waitForFunction(() => window.__baudoku.draw.nodes() === 4 && window.__baudoku.draw.edges() === 4);
  await page.locator('#draw-area').click();
  await gesture([await pt(0.5, 0.45)]);
  await waitMsg('Winkel bei Punkt');
  await page.screenshot({ path: join(art, 'baudoku-fehlt.png') });
  for (const p of rect) {
    await page.locator('#draw-area').click();
    await gesture([await pt(p[0], p[1])]);
    await page.locator('#btn-right').click();
  }
  async function measureAt(nx, ny, value, shot) {
    await page.locator('#draw-measure').click();
    await gesture([await pt(nx, ny)]);
    await page.waitForSelector('#drawInput');
    const mode = await page.locator('#drawInput').getAttribute('inputmode');
    if (mode !== 'decimal') throw new Error('inputmode ' + mode);
    if (shot) await page.screenshot({ path: shot });
    await page.locator('#drawInput').fill(value);
    await page.locator('#drawUnit').selectOption('m');
    await page.locator('#drawForm button[type="submit"]').click();
    await page.waitForFunction(() => document.querySelector('#drawForm').hidden);
  }
  await measureAt(0.5, 0.28, '8,50', join(art, 'baudoku-mass.png'));
  await measureAt(0.78, 0.45, '4,20');
  await waitMsg('35,70');
  await page.screenshot({ path: join(art, 'baudoku-flaeche.png') });
  if (!/abgeleitet/.test(await page.locator('#drawMsg').innerText())) throw new Error(await page.locator('#drawMsg').innerText());
  await page.reload();
  await page.waitForFunction(() => window.__baudoku.draw && window.__baudoku.draw.edges() === 4);
  await page.locator('#draw-area').click();
  await gesture([await pt(0.5, 0.45)]);
  await waitMsg('35,70');
  await measureAt(0.78, 0.45, '5');
  await waitMsg('42,50');
  await measureAt(0.5, 0.62, '9');
  await waitMsg('verschieden');
  await page.screenshot({ path: join(art, 'baudoku-widerspruch.png') });
  await page.locator('#draw-undo').click();
  await page.locator('#draw-undo').click();
  await waitMsg('35,70');

  await page.locator('#drawBack').click();
  await page.locator('#newSheet').click();
  await page.locator('.modal input[name="title"]').fill('L-Form');
  await page.locator('.modal button[type="submit"]').click();
  await page.waitForFunction(() => window.__baudoku.draw && /L-Form/.test(document.querySelector('#drawTitle').textContent));
  const L = [[0.15, 0.22], [0.78, 0.22], [0.78, 0.42], [0.48, 0.42], [0.48, 0.62], [0.15, 0.62]];
  for (let i = 0; i < L.length; i++) {
    const a = L[i], b = L[(i + 1) % L.length];
    await page.locator('#draw-line').click();
    await gesture([await pt(a[0], a[1]), await pt(b[0], b[1])]);
  }
  const shape = await page.evaluate(() => ({ nodes: window.__baudoku.draw.nodes(), edges: window.__baudoku.draw.edges() }));
  if (shape.nodes !== 6 || shape.edges !== 6) throw new Error('L-Form ' + JSON.stringify(shape));
  for (const p of L) {
    await page.locator('#draw-area').click();
    await gesture([await pt(p[0], p[1])]);
    await page.locator('#btn-right').click();
  }
  const measures = [[0.46, 0.22, '8'], [0.78, 0.32, '3'], [0.63, 0.42, '3'], [0.48, 0.52, '2'], [0.31, 0.62, '5']];
  for (const [x, y, v] of measures) await measureAt(x, y, v);
  await waitMsg('34,00');
  const lmsg = await page.locator('#drawMsg').innerText();
  if (!lmsg.includes('F1') || !lmsg.includes('F2') || !lmsg.includes('abgeleitet')) throw new Error(lmsg);
  await page.screenshot({ path: join(art, 'baudoku-lform.png') });
  await page.locator('#drawBack').click();
  await page.locator('button[data-tab="aufmass"]').click();
  await page.waitForSelector('input[value="Ortgang bleibt"]');
  assert.equal(await page.locator('input[value="Ortgang bleibt"]').count(), 1);
  await page.locator('button[data-tab="export"]').click();
  await page.locator('#mkPdf').click();
  const calcPdf = await Promise.all([page.waitForEvent('download'), page.locator('#pdfOut [data-act="download"]').click()]).then((x) => x[0]);
  const calcPdfPath = join(art, 'baudoku-rechenweg.pdf');
  await calcPdf.saveAs(calcPdfPath);
  const calcText = pdfText(readFileSync(calcPdfPath));
  for (const needle of ['35,70', '34,00', 'abgeleitet', 'F1', 'F2', 'Musterdach GmbH', 'Rechteck Dach', 'L-Form']) {
    if (!calcText.includes(needle)) throw new Error('PDF ohne ' + needle);
  }
  assert.equal(calcText.includes(banned), false);
  execFileSync('pdftoppm', ['-png', '-r', '110', calcPdfPath, join(art, 'baudoku-pdf-page')]);

  assert.deepEqual(errors, [], errors.join('\n'));
  await context.close();

  const fresh = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'de-DE' });
  const page2 = await fresh.newPage();
  await page2.goto(base);
  await page2.waitForSelector('text=Neues Projekt');
  await page2.locator('button[aria-label="Einstellungen"]').click();
  await page2.waitForSelector('input[name="firma"]');
  assert.equal(await page2.locator('input[name="firma"]').inputValue(), '');
  await fresh.close();
} finally {
  await browser.close();
  child.kill();
}

test('browser flow completed', () => { assert.equal(errors.length, 0); });
