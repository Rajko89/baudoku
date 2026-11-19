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
import { stampLines } from '../js/media.js';

const lines = stampLines({ projectName: 'Dach', time: Date.parse('2026-11-19T10:15:00'), timeKind: 'capture', lat: null });
assert.match(lines.map((l) => l.t).join('\n'), /Aufnahme:/);
assert.match(lines.map((l) => l.t).join('\n'), /Ort nicht verfügbar/);
const placed = stampLines({ projectName: 'Dach', time: Date.now(), lat: 51.35, lon: 8.28, acc: 12, address: 'Testweg 1, 59872 Teststadt' }).map((l) => l.t).join('\n');
assert.match(placed, /Ort: Testweg 1/);
const imported = stampLines({ projectName: 'Dach', time: Date.now(), timeKind: 'import', lat: null }).map((l) => l.t).join('\n');
assert.match(imported, /Importzeit/);
assert.match(imported, /Ort nicht verfügbar/);

function png(w, h) {
  const raw = [];
  for (let y = 0; y < h; y++) raw.push(Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 250)]));
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const chunk = (type, data) => {
    const t = Buffer.from(type);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])) >>> 0);
    return Buffer.concat([len, t, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(raw))), chunk('IEND', Buffer.alloc(0))]);
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
    for (const slice of [body, body.subarray(0, Math.max(0, body.length - 1))]) {
      try { out += inflateSync(slice).toString('latin1'); break; } catch { /* next */ }
    }
  }
  return out;
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const art = '/opt/cursor/artifacts';
mkdirSync(art, { recursive: true });
const pngPath = '/tmp/baudoku-white.png';
writeFileSync(pngPath, png(240, 160));
const port = 8776;
const serveRoot = '/tmp/baudoku-serve-stamp';
mkdirSync(serveRoot, { recursive: true });
rmSync(join(serveRoot, 'baudoku'), { recursive: true, force: true });
symlinkSync(root, join(serveRoot, 'baudoku'));
const child = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: serveRoot, stdio: 'ignore' });
const base = `http://127.0.0.1:${port}/baudoku/`;
await new Promise((r) => setTimeout(r, 250));
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

async function band(page) {
  return page.evaluate(async () => {
    const list = await window.__baudoku.db.all('photos');
    const ph = list[list.length - 1];
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(ph.stamped); });
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const top = g.getImageData(Math.floor(c.width / 2), 4, 1, 1).data;
    const bot = g.getImageData(Math.floor(c.width / 2), c.height - 4, 1, 1).data;
    const stripH = Math.max(8, Math.floor(c.height * 0.18));
    const strip = g.getImageData(0, c.height - stripH, c.width, stripH).data;
    let light = 0;
    for (let i = 0; i < strip.length; i += 4) if (strip[i] > 220 && strip[i + 1] > 220 && strip[i + 2] > 220) light++;
    const orig = new Uint8Array(await ph.original.arrayBuffer());
    const stamp = new Uint8Array(await ph.stamped.arrayBuffer());
    return { top: [...top], bot: [...bot], light, lat: ph.lat, timeKind: ph.timeKind, time: ph.time, address: ph.address, same: orig.length === stamp.length && orig.every((b, i) => b === stamp[i]), source: ph.source };
  });
}

try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'de-DE', geolocation: { latitude: 51.35, longitude: 8.28 }, permissions: ['geolocation'] });
  const page = await context.newPage();
  await page.route('**/nominatim.openstreetmap.org/**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ address: { road: 'Testweg', house_number: '1', postcode: '59872', town: 'Teststadt' } }) }));
  await page.goto(base);
  await page.locator('button', { hasText: 'Neues Projekt' }).click();
  await page.locator('input[name="name"]').fill('Stempel');
  await page.locator('#pf button[type="submit"]').click();
  await page.waitForSelector('#bCam');
  await page.locator('#in-camera').setInputFiles(pngPath);
  await page.waitForFunction(() => /gespeichert/.test(document.body.innerText));
  const shot = await band(page);
  assert.ok(shot.top[0] > 200, 'oben nicht hell ' + shot.top);
  assert.ok(shot.bot[0] < 150 && shot.bot[0] < shot.top[0] - 60, 'Stempelband fehlt ' + shot.bot);
  assert.ok(shot.light > 8, 'Stempeltext fehlt ' + shot.light);
  assert.equal(shot.same, false);
  assert.ok(Math.abs(shot.lat - 51.35) < 0.01, shot.lat);
  assert.match(shot.address, /Testweg/);
  assert.equal(shot.timeKind, 'capture');
  await page.locator('.ph').click();
  await page.waitForSelector('.photo-full');
  await page.screenshot({ path: join(art, 'baudoku-stempel.png') });
  await page.locator('.hdr button[aria-label="Zurück"]').click();
  await page.locator('button[data-tab="export"]').click();
  await page.locator('#mkPdf').click();
  const pdf = await Promise.all([page.waitForEvent('download'), page.locator('#pdfOut [data-act="download"]').click()]).then((x) => x[0]);
  const pdfPath = join(art, 'baudoku-stempel.pdf');
  await pdf.saveAs(pdfPath);
  const text = pdfText(readFileSync(pdfPath));
  assert.match(text, /Testweg|51,35|Ort/);

  await page.locator('button[data-tab="photos"]').click();
  await page.waitForSelector('#bGal');
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.locator('#in-gallery').setInputFiles(pngPath);
  let gal = [];
  for (let i = 0; i < 25; i++) {
    gal = await page.evaluate(async () => {
      const list = await window.__baudoku.db.all('photos');
      return { kinds: list.map((p) => p.source + ':' + p.timeKind), n: document.querySelector('#in-gallery')?.files?.length, on: typeof document.querySelector('#in-gallery')?.onchange };
    });
    if (gal.kinds?.some((k) => k.startsWith('gallery'))) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.ok(gal.kinds?.some((k) => k.startsWith('gallery:import') || k.startsWith('gallery:exif')), JSON.stringify({ gal, errors }));
  await context.close();

  const denied = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'de-DE' });
  await denied.addInitScript(() => {
    const error = { code: 1, PERMISSION_DENIED: 1, message: 'denied' };
    navigator.geolocation.getCurrentPosition = (_ok, err) => err(error);
    navigator.geolocation.watchPosition = (_ok, err) => { err(error); return 1; };
  });
  const page2 = await denied.newPage();
  await page2.goto(base);
  await page2.locator('button', { hasText: 'Neues Projekt' }).click();
  await page2.locator('input[name="name"]').fill('Ohne Ort');
  await page2.locator('#pf button[type="submit"]').click();
  await page2.waitForSelector('#bCam');
  await page2.locator('#in-camera').setInputFiles(pngPath);
  await page2.waitForFunction(() => /gespeichert/.test(document.body.innerText));
  const noGps = await band(page2);
  assert.equal(noGps.lat, null);
  assert.ok(noGps.bot[0] < 150 && noGps.light > 8, 'ohne GPS kein Stempel ' + noGps.bot + ' ' + noGps.light);
  assert.equal(noGps.timeKind, 'capture');
  assert.ok(noGps.time > Date.now() - 60000);
  await denied.close();
} finally {
  await browser.close();
  child.kill();
}

test('stamp flow completed', () => assert.ok(true));
