import { createRequire } from 'node:module';
const require = createRequire('/tmp/baudoku-test/package.json');
const { chromium } = require('playwright-core');
import { spawn } from 'node:child_process';
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
  page.on('pageerror', (e) => errors.push(String(e)));
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

  await page.getByText('Neubau Keep').click();
  await page.locator('button[data-tab="sketches"]').click();
  await page.waitForSelector('text=Bild wählen');
  await page.locator('#in-sketch').setInputFiles(pngPath);
  try {
    await page.waitForSelector('#skCropFull', { timeout: 8000 });
  } catch (e) {
    console.log('SKETCH FAIL', errors);
    console.log('files', await page.locator('#in-sketch').evaluate((el) => el.files.length));
    console.log(await page.locator('#app').innerText());
    console.log('URL', page.url());
    throw e;
  }
  await page.locator('#skCropFull').click();
  await page.waitForSelector('#sk-detect');
  await page.waitForFunction(() => { const r = document.querySelector('#skCanvas')?.getBoundingClientRect(); return r && r.height > 80; });
  await page.locator('#sk-detect').click();
  await page.waitForFunction(() => (document.querySelector('#toast')?.textContent || '').length > 5);
  const detectToast = await page.locator('#toast').innerText();
  const suggested = await page.evaluate(() => window.__baudoku.editor.sketch.vertices.filter((v) => v.suggested).length);
  if (suggested > 0) {
    assert.match(detectToast, /ohne Maße/);
    await page.locator('#skDrop').click();
    await page.waitForFunction(() => window.__baudoku.editor.sketch.vertices.every((v) => !v.suggested));
  } else {
    assert.match(detectToast, /Keine klaren Kanten/);
  }
  await page.locator('[data-kind="top"]').click();
  const pts = [[70, 50], [300, 50], [300, 200], [70, 200]];
  for (const [x, y] of pts) {
    const p = await page.evaluate(([ix, iy]) => window.__baudoku.editor.clientPoint(ix, iy), [x, y]);
    await page.mouse.click(p.x, p.y);
  }
  await page.waitForFunction(() => window.__baudoku.editor.sketch.vertices.length >= 4);
  await page.locator('#skClose').click();
  await page.waitForFunction(() => window.__baudoku.editor.sketch.edges.length >= 4);
  async function setEdge(nth, length, role) {
    await page.locator('#skCtx [data-edge]').nth(nth).click();
    await page.locator('.modal input[name="meters"]').fill(length);
    await page.locator('.modal select[name="role"]').selectOption(role);
    await page.locator('.modal select[name="aufmassId"]').selectOption('');
    await page.locator('.modal button[type="submit"]').click();
    await page.waitForSelector('.modal', { state: 'detached' });
  }
  await setEdge(0, '8,50', 'traufe');
  await setEdge(1, '4,20', 'schraege');
  await page.locator('#skFace').click();
  await page.locator('.modal select[name="shape"]').selectOption('rect');
  await page.locator('.modal select[name="areaMode"]').selectOption('sloped');
  await page.locator('.modal select[name="slopeSource"]').selectOption('edge');
  await page.locator('.modal button[type="submit"]').click();
  await page.waitForFunction(() => (document.querySelector('#skCalc')?.textContent || '').includes('35,70'));
  const calcText = await page.locator('#skCalc').innerText();
  assert.match(calcText, /Dachfläche F1/);
  assert.match(calcText, /a = 8,50 m/);
  assert.match(calcText, /b = 4,20 m, gemessene schräge Dachlänge/);
  assert.match(calcText, /Geneigte Dachfläche/);
  await page.screenshot({ path: join(art, 'baudoku-sketch-mobile.png') });

  await page.locator('#skBack').click();
  await page.locator('button[data-tab="aufmass"]').click();
  await page.waitForSelector('text=35,70');
  assert.equal(await page.locator('input[value="Ortgang bleibt"]').count(), 1);
  await page.screenshot({ path: join(art, 'baudoku-aufmass-calc.png') });
  const traufe = page.locator('.am-row').filter({ has: page.locator('input[value="Traufe a"]') });
  await traufe.locator('[data-k="menge"]').fill('10');
  await traufe.locator('[data-k="menge"]').blur();
  await page.waitForSelector('text=42,00');
  assert.match(await page.locator('#amlist').innerText(), /42,00/);
  await page.locator('button[data-tab="sketches"]').click();
  await page.locator('.card', { hasText: 'Skizze' }).click();
  await page.waitForFunction(() => (document.querySelector('#skCalc')?.textContent || '').includes('42,00'));

  await page.locator('#skBack').click();
  await page.locator('button[data-tab="export"]').click();
  await page.locator('#mkPdf').click();
  const pdfDl = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#pdfOut [data-act="download"]').click(),
  ]).then((x) => x[0]);
  const pdfPath = join(art, 'baudoku-sketch-sample.pdf');
  await pdfDl.saveAs(pdfPath);
  const pdfRaw = readFileSync(pdfPath);
  const text = pdfText(pdfRaw);
  assert.match(text, /Dachfläche F1|Dachflache F1/);
  assert.match(text, /42,00/);
  assert.match(text, /F1/);
  assert.match(text, /Musterdach GmbH/);
  const banned = String.fromCharCode(77, 101, 115, 99, 104, 101, 100, 101);
  assert.equal(text.includes(banned), false);

  const pdfView = await context.newPage();
  await pdfView.goto('file://' + pdfPath);
  await pdfView.waitForTimeout(800);
  await pdfView.screenshot({ path: join(art, 'baudoku-pdf-page.png') });
  await pdfView.close();

  await page.locator('#mkZip').click();
  const zipDl = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#zipOut [data-act="download"]').click(),
  ]).then((x) => x[0]);
  const zipPath = '/tmp/baudoku-backup.zip';
  await zipDl.saveAs(zipPath);
  const zipNote = await page.evaluate(async (buf) => {
    const { Blob } = window;
    const blob = new Blob([Uint8Array.from(buf)]);
    const zip = await window.JSZip.loadAsync(blob);
    const data = JSON.parse(await zip.file('data.json').async('string'));
    return { sketches: data.sketches?.length || 0, files: Object.keys(zip.files).filter((n) => n.startsWith('sketches/')) };
  }, [...readFileSync(zipPath)]);
  assert.ok(zipNote.sketches >= 1);
  assert.ok(zipNote.files.length >= 1);

  await page.locator('.hdr button[aria-label="Zurück"]').click();
  await page.locator('button[aria-label="Einstellungen"]').click();
  await page.locator('#in-import').setInputFiles(zipPath);
  await page.waitForSelector('text=importiert');
  await page.waitForSelector('text=Neubau Keep (Import)');
  await page.getByText('Neubau Keep (Import)').click();
  await page.locator('button[data-tab="sketches"]').click();
  await page.waitForSelector('text=Skizze');
  await page.locator('button[data-tab="aufmass"]').click();
  await page.waitForFunction(() => {
    const t = document.querySelector('#amlist')?.innerText || '';
    const vals = [...document.querySelectorAll('#amlist input')].map((i) => i.value).join(' ');
    return /Dachfläche F1/.test(t + vals);
  });

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
