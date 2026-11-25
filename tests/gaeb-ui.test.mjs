import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { leseMappe } from '../gaeb/js/excel.js';
import { schreibeD83 } from '../gaeb/js/gaeb.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'gaeb/js/gaeb.js'));
const XLSX = require(join(root, 'gaeb/vendor/xlsx.full.min.js'));
const { chromium } = require('/tmp/baudoku-test/node_modules/playwright-core');
const art = '/opt/cursor/artifacts';
mkdirSync(art, { recursive: true });

const rows = [[
  'OZ', 'Kurztext', 'Langtext', 'Menge', 'Einheit', 'EP', 'GP', 'Positionsart', 'Status Export',
  '', '', '', '', 'Hilfe Text bereinigt',
], [
  '02', 'Malerarbeiten', '', '', '', '', '', 'Abschnitt',
], [
  '02.0010',
  'Wandflächen grundieren, zwischen- und schlussbeschichten, Farbton nach Wahl',
  'Wandflächen grundieren, zwischen- und schlussbeschichten, Farbton nach Wahl der Bauleitung.',
  '', 'm²', 8, '', 'Normal', '', '', '', '', '',
  'Wandflächen grundieren, zwischen- und schlussbeschichten, Farbton nach Wahl der Bauleitung.',
], [
  '02.0020', 'Zulage Ecke', 'Zulage für eine Innenecke.', '', 'St', 4, '', 'Bedarf (nur EP)',
]];
const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet(rows);
ws['!ref'] = 'A1:N4';
XLSX.utils.book_append_sheet(wb, ws, 'GAEB-Export');
const xlsxPfad = '/tmp/gaeb-ui-probe.xlsx';
writeFileSync(xlsxPfad, Buffer.from(XLSX.write(wb, { type: 'array', bookType: 'xlsx' })));
const gelesen = leseMappe(XLSX, new Uint8Array(readFileSync(xlsxPfad)), { quelle: 'export' });
assert.equal(gelesen.fehler.length, 0, gelesen.fehler.join('\n'));
const kopf = {
  lvBez: 'Probe', projekt: 'Haus', auftraggeber: 'Bauherr',
  datum: { y: 2026, m: 11, d: 21, h: 8, min: 0 }, jetzt: { y: 2026, m: 11, d: 21, h: 8, min: 0 },
};
const d83Pfad = '/tmp/gaeb-ui-probe.D83';
writeFileSync(d83Pfad, Buffer.from(schreibeD83(gelesen.lv, kopf, 'cp850', 'null', true, []).bytes));

const port = 8796;
const serveRoot = '/tmp/baudoku-serve-gaeb';
mkdirSync(serveRoot, { recursive: true });
rmSync(join(serveRoot, 'baudoku'), { recursive: true, force: true });
symlinkSync(root, join(serveRoot, 'baudoku'));
const child = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: serveRoot, stdio: 'ignore' });
const base = `http://127.0.0.1:${port}/baudoku/gaeb/`;
await new Promise((r) => setTimeout(r, 300));

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: 'de-DE' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(base);
  await page.getByRole('heading', { name: 'GAEB-Umwandler' }).waitFor();
  await page.screenshot({ path: join(art, 'gaeb-start-1280.png') });
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.screenshot({ path: join(art, 'gaeb-start-820.png') });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.locator('#excel-file').setInputFiles(xlsxPfad);
  await page.getByRole('button', { name: 'Prüfen und erzeugen' }).click();
  await page.getByText('Rücklese-Prüfung: OK').waitFor();
  await page.getByText('Kurztext zu lang und gekürzt').waitFor();
  await page.getByText('ohne Menge').waitFor();
  await page.screenshot({ path: join(art, 'gaeb-pruefung.png') });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'P83 herunterladen' }).click(),
  ]);
  const gespeichert = readFileSync(await download.path());
  const ohneCrlf = gespeichert.toString('latin1').replaceAll('\r\n', '');
  assert.equal(ohneCrlf.includes('\n') || ohneCrlf.includes('\r'), false);
  assert.ok(gespeichert.includes(Buffer.from('\r\n')));
  const lfPfad = '/tmp/gaeb-ui-lf.P83';
  writeFileSync(lfPfad, gespeichert.toString('latin1').replaceAll('\r\n', '\n'), 'latin1');
  await page.getByRole('tab', { name: 'GAEB → Excel' }).click();
  await page.locator('#gaeb-file').setInputFiles(lfPfad);
  await page.getByRole('button', { name: 'Nach Excel' }).click();
  await page.getByText('Prüfung: OK').waitFor();
  await page.getByText('Zeilenenden sind LF').waitFor();
  assert.equal(await page.locator('#preview .bad').count(), 0);
  const knopf = page.getByRole('link', { name: 'Excel herunterladen' });
  await knopf.waitFor();
  const kasten = await knopf.boundingBox();
  assert.ok(kasten && kasten.width > 180 && kasten.height >= 44);
  await page.screenshot({ path: join(art, 'gaeb-import-lf.png') });
  await page.locator('#gaeb-file').setInputFiles(d83Pfad);
  await page.getByRole('button', { name: 'Nach Excel' }).click();
  await page.getByText('Zeichensatz: Codepage 850').waitFor();
  await page.screenshot({ path: join(art, 'gaeb-nach-excel.png') });
  const sw = await page.evaluate(async (url) => (await (await fetch(url, { cache: 'no-store' })).text()), `${base}sw.js`);
  const haupt = await page.evaluate(async (url) => (await (await fetch(url, { cache: 'no-store' })).text()), `http://127.0.0.1:${port}/baudoku/sw.js`);
  const zwei = await page.evaluate(async (url) => (await (await fetch(url, { cache: 'no-store' })).text()), `http://127.0.0.1:${port}/baudoku/zwei/sw.js`);
  assert.match(sw, /gaeb-v1\.0\.1/);
  assert.match(haupt, /baudoku-v1\.7\.10/);
  assert.match(haupt, /\/gaeb\//);
  assert.match(zwei, /unregister/);
  assert.match(zwei, /baudoku2-/);
  assert.doesNotMatch(zwei, /caches\.delete\(k\)/);
  assert.equal(errors.length, 0, errors.join('\n'));
  await page.close();
} finally {
  await browser.close();
  child.kill();
}
