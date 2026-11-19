import { createRequire } from 'node:module';
const require = createRequire('/tmp/baudoku-test/package.json');
const { chromium } = require('playwright-core');
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const art = '/opt/cursor/artifacts';
mkdirSync(art, { recursive: true });
const port = 8779;
const serveRoot = '/tmp/baudoku-serve-header';
mkdirSync(serveRoot, { recursive: true });
rmSync(join(serveRoot, 'baudoku'), { recursive: true, force: true });
symlinkSync(root, join(serveRoot, 'baudoku'));
const child = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: serveRoot, stdio: 'ignore' });
const base = `http://127.0.0.1:${port}/baudoku/`;
await new Promise((r) => setTimeout(r, 250));

function lin(c) { const x = c / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }
function luminance(rgb) {
  const m = rgb.match(/\d+/g).map(Number);
  return 0.2126 * lin(m[0]) + 0.7152 * lin(m[1]) + 0.0722 * lin(m[2]);
}
function contrast(a, b) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const colors = [
  { id: 'blue', bg: 'rgb(31, 41, 51)', fg: 'rgb(255, 255, 255)', hex: '#1f2933', file: 'baudoku-kopf-blau.png' },
  { id: 'red', bg: 'rgb(170, 28, 28)', fg: 'rgb(255, 255, 255)', hex: '#aa1c1c', file: 'baudoku-kopf-rot.png' },
  { id: 'green', bg: 'rgb(27, 94, 32)', fg: 'rgb(255, 255, 255)', hex: '#1b5e20', file: 'baudoku-kopf-gruen.png' },
  { id: 'yellow', bg: 'rgb(255, 172, 39)', fg: 'rgb(17, 17, 17)', hex: '#ffac27', file: 'baudoku-kopf-gelb.png' },
];

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'de-DE', hasTouch: true })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(base);
  await page.waitForSelector('text=Neues Projekt');
  for (const color of colors) {
    await page.locator('button[aria-label="Einstellungen"]').click();
    await page.waitForSelector('#headColors');
    await page.locator(`#headColors [data-head="${color.id}"]`).click();
    await page.waitForFunction((bg) => getComputedStyle(document.querySelector('.hdr')).backgroundColor === bg, color.bg);
    const paint = await page.evaluate(() => {
      const h = getComputedStyle(document.querySelector('.hdr'));
      return { bg: h.backgroundColor, fg: h.color, theme: document.querySelector('meta[name="theme-color"]').content, pressed: document.querySelector('#headColors [aria-pressed="true"]')?.dataset.head };
    });
    assert.equal(paint.bg, color.bg, color.id);
    assert.equal(paint.fg, color.fg, color.id + ' schrift');
    assert.equal(paint.theme.toLowerCase(), color.hex, color.id + ' theme');
    assert.equal(paint.pressed, color.id);
    assert.ok(contrast(paint.fg, paint.bg) >= 4.5, `${color.id} Kontrast ${contrast(paint.fg, paint.bg)}`);
    await page.locator('.hdr button[aria-label="Zurück"]').click();
    await page.waitForSelector('text=Neues Projekt');
    await page.waitForFunction((bg) => getComputedStyle(document.querySelector('.hdr')).backgroundColor === bg, color.bg);
    await page.screenshot({ path: join(art, color.file) });
    await page.reload();
    await page.waitForSelector('text=Neues Projekt');
    await page.waitForFunction((bg) => getComputedStyle(document.querySelector('.hdr')).backgroundColor === bg, color.bg);
    const kept = await page.evaluate(() => getComputedStyle(document.querySelector('.hdr')).color);
    assert.equal(kept, color.fg, color.id + ' nach Neuladen');
  }
  assert.equal(errors.length, 0, errors.join('\n'));
  await page.close();
} finally {
  await browser.close();
  child.kill();
}

test('header colors completed', () => assert.ok(true));
