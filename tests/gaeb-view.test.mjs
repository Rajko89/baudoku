import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { schreibeP83 } from '../gaeb/js/gaeb.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'gaeb/js/gaeb.js'));
const { chromium } = require('/tmp/baudoku-test/node_modules/playwright-core');
const art = '/opt/cursor/artifacts';
mkdirSync(art, { recursive: true });
const kopf = {
  lvBez: 'Probe Dach', projekt: 'Haus am Hang', auftraggeber: 'Bauherr Beispiel',
  datum: { y: 2026, m: 11, d: 21, h: 9, min: 0 }, jetzt: { y: 2026, m: 11, d: 21, h: 9, min: 0 },
};
const lv = [{
  oz: '03', titel: 'Zimmerarbeiten', positionen: [{
    oz: '03.0010', kurztext: 'Dielung aus Eiche', langtext: 'Dielung aus Eiche liefern.\nStöße schleifen.',
    menge: '12.5', einheit: 'm²', bedarf: false,
  }],
}];
const probe = '/tmp/gaeb-view-probe.P83';
writeFileSync(probe, Buffer.from(schreibeP83(lv, kopf, 'null', []).bytes));

const port = 8802;
const serveRoot = '/tmp/baudoku-serve-view';
mkdirSync(serveRoot, { recursive: true });
rmSync(join(serveRoot, 'baudoku'), { recursive: true, force: true });
symlinkSync(root, join(serveRoot, 'baudoku'));
const child = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: serveRoot, stdio: 'ignore' });
const base = `http://127.0.0.1:${port}/baudoku/gaeb/`;
await new Promise((r) => setTimeout(r, 300));
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  for (const [tag, viewport, datei, oz, shot] of [
    ['phone', { width: 390, height: 844 }, probe, '03.0010', 'gaeb-viewer-390.png'],
    ['tablet', { width: 820, height: 1180 }, probe, '03.0010', 'gaeb-viewer-820.png'],
  ]) {
    const page = await browser.newPage({ viewport, locale: 'de-DE', hasTouch: true });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(base);
    await page.getByRole('tab', { name: 'Ansehen' }).click();
    await page.locator('#view-file').setInputFiles(datei);
    await page.getByRole('button', { name: 'Anzeigen' }).click();
    await page.getByText(oz, { exact: true }).waitFor();
    await page.getByRole('button', { name: 'PDF herunterladen' }).waitFor();
    if (tag === 'phone') {
      await page.getByText('Langtext', { exact: true }).click();
      await page.getByText('Stöße schleifen.').waitFor();
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: 'PDF herunterladen' }).click(),
      ]);
      const pdf = readFileSync(await download.path());
      assert.equal(pdf.subarray(0, 5).toString(), '%PDF-', tag);
    }
    await page.screenshot({ path: join(art, shot) });
    assert.equal(errors.length, 0, tag + ' ' + errors.join('\n'));
    await page.close();
  }
} finally {
  await browser.close();
  child.kill();
}
