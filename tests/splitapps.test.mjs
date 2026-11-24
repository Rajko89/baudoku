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
const port = 8792;
const serveRoot = '/tmp/baudoku-serve-split';
mkdirSync(serveRoot, { recursive: true });
rmSync(join(serveRoot, 'baudoku'), { recursive: true, force: true });
symlinkSync(root, join(serveRoot, 'baudoku'));
const child = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: serveRoot, stdio: 'ignore' });
const base = `http://127.0.0.1:${port}/baudoku/`;
const zwei = base + 'zwei/';
await new Promise((r) => setTimeout(r, 250));

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'de-DE' })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  async function names(dbName) {
    return page.evaluate(async (name) => {
      const rows = await new Promise((resolve, reject) => {
        const req = indexedDB.open(name);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('projects')) { db.close(); resolve([]); return; }
          const q = db.transaction('projects').objectStore('projects').getAll();
          q.onerror = () => reject(q.error);
          q.onsuccess = () => { db.close(); resolve(q.result.map((p) => p.name)); };
        };
      });
      return rows;
    }, dbName);
  }
  await page.goto(base);
  await page.locator('button', { hasText: 'Neues Projekt' }).click();
  await page.locator('input[name="name"]').fill('Nur Haupt');
  await page.locator('#pf button[type="submit"]').click();
  await page.locator('.hdr button[aria-label="Zurück"]').click();
  await page.locator('h1', { hasText: 'Baudoku' }).first().waitFor();
  assert.equal(await page.locator('h1').first().innerText(), 'Baudoku\nProjekte');
  await page.screenshot({ path: join(art, 'baudoku-haupt.png') });
  assert.deepEqual(await names('baudoku'), ['Nur Haupt']);

  await page.goto(zwei);
  await page.locator('h1', { hasText: 'Baudoku 2' }).waitFor();
  assert.equal(await page.locator('body').innerText().then((t) => t.includes('Nur Haupt')), false);
  await page.screenshot({ path: join(art, 'baudoku-2.png') });
  await page.locator('button', { hasText: 'Neues Projekt' }).click();
  await page.locator('input[name="name"]').fill('Nur Zwei');
  await page.locator('#pf button[type="submit"]').click();
  await page.locator('.hdr button[aria-label="Zurück"]').click();
  await page.getByText('Nur Zwei', { exact: true }).waitFor();
  assert.equal(await page.locator('body').innerText().then((t) => t.includes('Nur Haupt')), false);
  assert.deepEqual((await names('baudoku-2')).sort(), ['Nur Zwei']);
  assert.deepEqual(await names('baudoku'), ['Nur Haupt']);

  await page.goto(base);
  await page.getByText('Nur Haupt', { exact: true }).waitFor();
  assert.equal(await page.locator('body').innerText().then((t) => t.includes('Nur Zwei')), false);
  const mainSw = await page.evaluate(async (url) => (await (await fetch(url, { cache: 'no-store' })).text()), base + 'sw.js');
  const zweiSw = await page.evaluate(async (url) => (await (await fetch(url, { cache: 'no-store' })).text()), zwei + 'sw.js');
  assert.match(mainSw, /baudoku-v1\.7\.9/);
  assert.match(mainSw, /\/zwei\//);
  assert.match(zweiSw, /baudoku2-v1\.9\.0/);
  assert.doesNotMatch(zweiSw, /pathname\.includes\('\/zwei\/'\)/);
  assert.equal(errors.length, 0, errors.join('\n'));
  await page.close();
} finally {
  await browser.close();
  child.kill();
}

test('the two apps keep separate data', () => assert.ok(true));
