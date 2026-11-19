import { createRequire } from 'node:module';
const require = createRequire('/tmp/baudoku-test/package.json');
const { chromium } = require('playwright-core');
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, symlinkSync, readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const art = '/opt/cursor/artifacts';
mkdirSync(art, { recursive: true });
const port = 8780;
const serveRoot = '/tmp/baudoku-serve-pdfcolor';
mkdirSync(serveRoot, { recursive: true });
rmSync(join(serveRoot, 'baudoku'), { recursive: true, force: true });
symlinkSync(root, join(serveRoot, 'baudoku'));
const child = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: serveRoot, stdio: 'ignore' });
const base = `http://127.0.0.1:${port}/baudoku/`;
await new Promise((r) => setTimeout(r, 250));

function pdfStreams(buf) {
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
  return out;
}
function decodePng(buf) {
  const data = Buffer.from(buf);
  let i = 8;
  const chunks = [];
  while (i < data.length) {
    const n = data.readUInt32BE(i);
    chunks.push([data.subarray(i + 4, i + 8).toString(), data.subarray(i + 8, i + 8 + n)]);
    i += 12 + n;
  }
  const ihdr = chunks[0][1];
  const w = ihdr.readUInt32BE(0), h = ihdr.readUInt32BE(4), color = ihdr[9];
  const bpp = color === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(chunks.filter((c) => c[0] === 'IDAT').map((c) => c[1])));
  const stride = w * bpp;
  let prev = Buffer.alloc(stride);
  let pos = 0;
  const rows = [];
  const paeth = (a, b, c) => {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < h; y++) {
    const f = raw[pos++];
    const row = Buffer.from(raw.subarray(pos, pos + stride));
    pos += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? row[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      if (f === 1) row[x] = (row[x] + a) & 255;
      else if (f === 2) row[x] = (row[x] + b) & 255;
      else if (f === 3) row[x] = (row[x] + ((a + b) >> 1)) & 255;
      else if (f === 4) row[x] = (row[x] + paeth(a, b, c)) & 255;
    }
    prev = row;
    rows.push(row);
  }
  return { w, h, bpp, rows };
}
function px(img, x, y) {
  const row = img.rows[y];
  const i = x * img.bpp;
  return [row[i], row[i + 1], row[i + 2]];
}
function near(a, b, tol = 18) { return Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol; }

const colors = [
  { id: 'blue', rgb: [31, 41, 51], fg: [255, 255, 255], lightText: true },
  { id: 'red', rgb: [170, 28, 28], fg: [255, 255, 255], lightText: true },
  { id: 'green', rgb: [27, 94, 32], fg: [255, 255, 255], lightText: true },
  { id: 'yellow', rgb: [255, 172, 39], fg: [17, 17, 17], lightText: false },
];

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const pages = [];
try {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'de-DE', acceptDownloads: true, hasTouch: true })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(base);
  await page.locator('button', { hasText: 'Neues Projekt' }).click();
  await page.locator('input[name="name"]').fill('Farbbericht');
  await page.locator('#pf button[type="submit"]').click();
  await page.locator('button[data-tab="aufmass"]').click();
  await page.locator('#amAdd').click();
  await page.locator('[data-k="bez"]').fill('Traufe');
  await page.locator('[data-k="bez"]').blur();
  await page.waitForFunction(() => document.querySelector('[data-k="bez"]')?.value === 'Traufe');

  for (const color of colors) {
    await page.locator('.hdr button[aria-label="Zurück"]').click();
    await page.locator('button[aria-label="Einstellungen"]').click();
    await page.locator(`#headColors [data-head="${color.id}"]`).click();
    await page.waitForFunction((id) => document.documentElement.dataset.header === id, color.id);
    await page.locator('.hdr button[aria-label="Zurück"]').click();
    await page.getByText('Farbbericht', { exact: true }).click();
    await page.locator('button[data-tab="export"]').click();
    for (const id of ['#oPh', '#oNo', '#oMi', '#oSk', '#oSheet']) {
      if (await page.locator(id).isChecked()) await page.locator(id).uncheck();
    }
    await page.locator('#mkPdf').click();
    const pdf = await Promise.all([page.waitForEvent('download'), page.locator('#pdfOut [data-act="download"]').click()]).then((x) => x[0]);
    const pdfPath = join(art, `baudoku-pdf-${color.id}.pdf`);
    await pdf.saveAs(pdfPath);
    const ops = pdfStreams(readFileSync(pdfPath));
    const part = (n) => {
      const v = n / 255;
      const forms = new Set([v.toFixed(2), v.toFixed(3)].map((s) => s.replace(/0+$/, '').replace(/\.$/, '')));
      return '(?:' + [...forms].map((s) => s.replace(/\./g, '\\.')).join('|') + ')\\.?(?!\\d)';
    };
    const fills = ops.match(new RegExp(color.rgb.map(part).join('\\s+') + '\\s+rg', 'g')) || [];
    assert.ok(fills.length >= 2, `${color.id} Farbbalken ${fills.length}`);
    if (color.lightText) assert.match(ops, /1\.\s*g/, color.id + ' ohne weiße Schrift');
    else assert.doesNotMatch(ops, /1\.\s*g/, color.id + ' noch weiße Schrift');
    const prefix = join(art, `baudoku-pdf-${color.id}`);
    execFileSync('pdftoppm', ['-png', '-r', '100', '-f', '1', '-l', '1', pdfPath, prefix]);
    const img = decodePng(readFileSync(prefix + '-1.png'));
    const sample = px(img, Math.round(img.w / 2), 28);
    assert.ok(near(sample, color.rgb), `${color.id} Kopf ${sample} statt ${color.rgb}`);
    let light = 0, dark = 0;
    for (let y = 100; y < 165; y++) {
      for (let x = 40; x < img.w - 40; x += 2) {
        const p = px(img, x, y);
        if (near(p, color.rgb, 28)) continue;
        const lum = 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
        if (lum > 180) light++;
        else if (lum < 90) dark++;
      }
    }
    if (color.lightText) assert.ok(light > 30 && light > dark, `${color.id} Schrift nicht hell ${light}/${dark}`);
    else assert.ok(dark > 30 && dark > light, `${color.id} Schrift nicht dunkel ${light}/${dark}`);
    pages.push(prefix + '-1.png');
  }
  assert.equal(errors.length, 0, errors.join('\n'));
  execFileSync('ffmpeg', ['-y', '-i', pages[0], '-i', pages[1], '-i', pages[2], '-i', pages[3], '-filter_complex', 'xstack=inputs=4:layout=0_0|w0_0|0_h0|w0_h0', '-update', '1', join(art, 'baudoku-pdf-farben.png')]);
  await page.close();
} finally {
  await browser.close();
  child.kill();
}

test('pdf header colors completed', () => assert.ok(true));
