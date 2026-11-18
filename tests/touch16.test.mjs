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
const port = 8775;
const serveRoot = '/tmp/baudoku-serve-16';
mkdirSync(serveRoot, { recursive: true });
rmSync(join(serveRoot, 'baudoku'), { recursive: true, force: true });
symlinkSync(root, join(serveRoot, 'baudoku'));
const child = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: serveRoot, stdio: 'ignore' });
const base = `http://127.0.0.1:${port}/baudoku/`;
await new Promise((r) => setTimeout(r, 250));

function inside(poly, x, y) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const yi = poly[i][1], yj = poly[j][1], xi = poly[i][0], xj = poly[j][0];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-12) + xi)) c = !c;
  }
  return c;
}

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errors = [];
try {
  async function scenario(viewport, tag) {
    const context = await browser.newContext({ viewport, locale: 'de-DE', acceptDownloads: true });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(tag + ' ' + e));
    const shot = (name) => tag === 'phone' ? page.screenshot({ path: join(art, name) }) : Promise.resolve();
    await page.goto(base);
    await page.waitForSelector('text=Neues Projekt');
    await page.locator('button', { hasText: 'Neues Projekt' }).click();
    await page.locator('input[name="name"]').fill('Prüfung ' + tag);
    await page.locator('#pf button[type="submit"]').click();
    await page.locator('button[data-tab="sketches"]').click();
    const pid = await page.evaluate(() => location.hash.split('/')[2].split('?')[0]);

    async function sheet(title) {
      if (await page.locator('#drawBack').count()) await page.locator('#drawBack').click();
      await page.locator('button[data-tab="sketches"]').click();
      await page.locator('#newSheet').click();
      await page.locator('.modal input[name="title"]').fill(title);
      await page.locator('.modal button[type="submit"]').click();
      await page.waitForFunction(() => window.__baudoku.draw && document.querySelector('#drawCanvas')?.getBoundingClientRect().height > 80);
    }
    const at = (nx, ny) => page.evaluate(([x, y]) => window.__baudoku.draw.clientPoint(x, y), [nx, ny]);
    const gesture = async (pts) => {
      const c = page.locator('#drawCanvas');
      const fire = (type, p) => c.dispatchEvent(type, { clientX: p.x, clientY: p.y, pointerId: 1, pointerType: 'touch', bubbles: true, button: 0, buttons: type === 'pointerup' ? 0 : 1 });
      await fire('pointerdown', pts[0]);
      for (const p of pts.slice(1)) await fire('pointermove', p);
      await fire('pointerup', pts[pts.length - 1]);
    };
    const dragOpen = async (pts) => {
      const c = page.locator('#drawCanvas');
      await c.dispatchEvent('pointerdown', { clientX: pts[0].x, clientY: pts[0].y, pointerId: 1, pointerType: 'touch', bubbles: true, button: 0, buttons: 1 });
      for (const p of pts.slice(1)) await c.dispatchEvent('pointermove', { clientX: p.x, clientY: p.y, pointerId: 1, pointerType: 'touch', bubbles: true, button: 0, buttons: 1 });
    };
    async function measure(nx, ny, value, unit = 'm') {
      await page.locator('#draw-measure').click();
      await gesture([await at(nx, ny)]);
      await page.waitForSelector('#drawInput');
      assert.equal(await page.locator('#drawInput').getAttribute('inputmode'), 'decimal');
      await page.locator('#drawInput').fill(value);
      await page.locator('#drawUnit').selectOption(unit);
      await page.locator('#drawForm button[type="submit"]').click();
      await page.waitForFunction(() => document.querySelector('#drawForm').hidden);
    }
    async function poly(pts, tool) {
      await page.locator(tool).click();
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        await gesture([await at(a[0], a[1]), await at(b[0], b[1])]);
      }
    }

    await sheet('Winkelfang');
    await page.locator('#draw-line').click();
    await gesture([await at(0.2, 0.35), await at(0.5, 0.62), await at(0.78, 0.39)]);
    const flat = await page.evaluate(() => {
      const e = window.__baudoku.draw;
      return e.edges();
    });
    assert.equal(flat, 1);
    const ySnap = await page.evaluate(() => {
      const doc = window.__baudoku.draw.nodes();
      return doc;
    });
    void ySnap;
    const ends = await page.evaluate(() => window.__baudoku.draw.edgeEnds());
    assert.ok(Math.abs(ends[0].y1 - ends[0].y2) < 0.02, JSON.stringify(ends));
    const start = ends[0];
    const from = await at(start.x2, start.y2);
    const raw = await at(start.x2 + 0.05, start.y2 + 0.4);
    await dragOpen([from, raw]);
    await page.waitForSelector('#snapMark:not([hidden])');
    await shot('baudoku-winkelfang.png');
    await page.locator('#drawCanvas').dispatchEvent('pointerup', { clientX: raw.x, clientY: raw.y, pointerId: 1, pointerType: 'touch', bubbles: true, button: 0, buttons: 0 });
    await page.waitForFunction(() => window.__baudoku.draw.rights() >= 1);
    const joined = await page.evaluate(() => window.__baudoku.draw.edgeEnds());
    assert.ok(Math.abs(joined[1].x1 - joined[1].x2) < 0.02, JSON.stringify(joined));

    await sheet('Frei');
    const box = [[0.22, 0.28], [0.75, 0.28], [0.75, 0.62], [0.22, 0.62]];
    await poly(box, '#draw-free');
    await page.waitForFunction(() => window.__baudoku.draw.edges() === 4 && window.__baudoku.draw.rights() === 0);
    await measure(0.48, 0.28, '8,50');
    await measure(0.75, 0.45, '4,20');
    await page.waitForFunction(() => (window.__baudoku.draw.faces()[0]?.text || '').includes('Freie Linie'));
    await shot('baudoku-freie-linie.png');

    await sheet('Stift');
    await page.locator('#draw-pen').click();
    await page.locator('#penBar [data-c="#e03131"]').click();
    await page.locator('#penBar [data-w="0.022"]').click();
    await shot('baudoku-stift.png');
    await gesture([await at(0.3, 0.4), await at(0.5, 0.55), await at(0.7, 0.42)]);
    const ink = await page.evaluate(() => window.__baudoku.draw.strokes().find((s) => s.tool === 'pen'));
    assert.equal(ink.color, '#e03131');
    assert.ok(Math.abs(ink.width - 0.022) < 1e-6);

    await sheet('Text');
    await page.locator('#draw-text').click();
    await gesture([await at(0.4, 0.3)]);
    await page.waitForFunction(() => document.activeElement?.id === 'drawInput');
    await page.locator('#drawInput').fill('Schornstein');
    await page.locator('#drawForm button[type="submit"]').click();
    await page.waitForFunction(() => document.querySelector('#drawForm').hidden);
    await page.locator('#draw-line').click();
    const before = await page.evaluate(() => window.__baudoku.draw.edges());
    const a = await at(0.4, 0.3), b = await at(0.62, 0.36);
    await gesture([a, b]);
    const after = await page.evaluate(() => ({ edges: window.__baudoku.draw.edges(), text: window.__baudoku.draw.texts()[0] }));
    assert.equal(after.edges, before);
    assert.ok(after.text.x > 0.55, JSON.stringify(after.text));
    assert.equal(after.text.text, 'Schornstein');

    await sheet('Rechteck');
    await poly(box, '#draw-line');
    await page.waitForFunction(() => window.__baudoku.draw.rights() >= 4 && (window.__baudoku.draw.faces()[0]?.text || '').includes('Maße fehlen'));
    await shot('baudoku-masse-fehlen.png');
    await measure(0.48, 0.28, '8,50');
    await measure(0.75, 0.45, '4,20');
    await page.waitForFunction(() => (window.__baudoku.draw.faces()[0]?.text || '').includes('35,70'));
    const face = await page.evaluate(() => window.__baudoku.draw.faces()[0]);
    assert.ok(face.x > 0.22 && face.x < 0.75 && face.y > 0.28 && face.y < 0.62, JSON.stringify(face));
    await shot('baudoku-flaeche-auto.png');
    await measure(0.75, 0.45, '5');
    await page.waitForFunction(() => (window.__baudoku.draw.faces()[0]?.text || '').includes('42,50'));
    const y0 = await page.evaluate(() => window.__baudoku.draw.edgeEnds().find((e) => Math.abs(e.y1 - 0.62) < 0.05 || Math.abs(e.y2 - 0.62) < 0.05));
    await page.locator('#draw-area').click();
    await gesture([await at(0.75, 0.62), await at(0.75, 0.72)]);
    const y1 = await page.evaluate(() => Math.max(...window.__baudoku.draw.edgeEnds().flatMap((e) => [e.y1, e.y2])));
    assert.ok(y1 > 0.66, 'Linie nicht verschoben ' + y1);
    assert.match(await page.evaluate(() => window.__baudoku.draw.faces()[0].text), /42,50|m²/);
    void y0;
    await page.locator('#draw-undo').click();
    await page.waitForFunction(() => Math.max(...window.__baudoku.draw.edgeEnds().flatMap((e) => [e.y1, e.y2])) < 0.66);
    await page.reload();
    await page.waitForFunction(() => (window.__baudoku.draw?.faces()[0]?.text || '').includes('42,50'));
    await page.locator('#draw-line').click();
    await gesture([await at(0.15, 0.85), await at(0.4, 0.9)]);

    await sheet('Zwei');
    await poly([[0.12, 0.16], [0.42, 0.16], [0.42, 0.4], [0.12, 0.4]], '#draw-line');
    await measure(0.27, 0.16, '3');
    await measure(0.42, 0.28, '2');
    await poly([[0.55, 0.5], [0.88, 0.5], [0.88, 0.78], [0.55, 0.78]], '#draw-line');
    await measure(0.7, 0.5, '4');
    await measure(0.88, 0.64, '2');
    await page.waitForFunction(() => window.__baudoku.draw.faces().filter((f) => /m²/.test(f.text)).length >= 2);
    const two = await page.evaluate(() => window.__baudoku.draw.faces().map((f) => f.text));
    assert.ok(two.some((t) => t.includes('6,00')));
    assert.ok(two.some((t) => t.includes('8,00')));
    await shot('baudoku-zwei-flaechen.png');

    await sheet('L-Form');
    const L = [[0.15, 0.2], [0.8, 0.2], [0.8, 0.42], [0.5, 0.42], [0.5, 0.68], [0.15, 0.68]];
    await poly(L, '#draw-line');
    await page.waitForFunction(() => window.__baudoku.draw.edges() === 6 && window.__baudoku.draw.rights() >= 6);
    const mids = [[0.47, 0.2, '8'], [0.8, 0.31, '3'], [0.65, 0.42, '3'], [0.5, 0.55, '2'], [0.32, 0.68, '5']];
    for (const [x, y, v] of mids) await measure(x, y, v);
    await page.waitForFunction(() => (window.__baudoku.draw.faces()[0]?.text || '').includes('34,00'));
    const lf = await page.evaluate(() => window.__baudoku.draw.faces()[0]);
    assert.equal(inside(L, lf.x, lf.y), true, JSON.stringify(lf));
    assert.ok(!(lf.x > 0.5 && lf.y > 0.42), 'Label in der Aussparung ' + JSON.stringify(lf));
    await shot('baudoku-lform-innen.png');

    await sheet('Zentimeter');
    await poly([[0.2, 0.3], [0.7, 0.3], [0.7, 0.6], [0.2, 0.6]], '#draw-line');
    await measure(0.45, 0.3, '100', 'cm');
    await measure(0.7, 0.45, '50', 'cm');
    await page.waitForFunction(() => (window.__baudoku.draw.faces()[0]?.text || '').includes('0,50'));

    if (tag === 'phone') {
      await sheet('Trapez');
      const trap = [[0.2, 0.3], [0.8, 0.3], [0.62, 0.68], [0.2, 0.68]];
      await poly(trap, '#draw-line');
      await page.waitForFunction(() => window.__baudoku.draw.edges() === 4 && window.__baudoku.draw.rights() >= 1);
      await measure(0.5, 0.3, '8');
      await measure(0.41, 0.68, '5');
      await measure(0.2, 0.49, '3');
      await page.locator('#draw-measure').click();
      await gesture([await at(0.5, 0.3)]);
      await page.locator('#btn-parallel').click();
      await gesture([await at(0.41, 0.68)]);
      await page.waitForFunction(() => {
        const msg = document.querySelector('#drawMsg')?.textContent || '';
        const face = window.__baudoku.draw.faces()[0]?.text || '';
        return face.includes('19,50') && /Trapez/.test(msg) && /Formel/.test(msg) && /19,50/.test(msg);
      });
      await page.screenshot({ path: join(art, 'baudoku-trapez.png') });
      if (!await page.locator('#drawForm').isHidden()) await page.locator('#drawForm button[type="submit"]').click();
      await page.evaluate(async (id) => {
        await window.__baudoku.db.put('aufmass', { id: 'am-keep', projectId: id, order: 1, pos: '01', bez: 'Ortgang bleibt', menge: 3, expr: '3', einheit: 'm' });
        await window.__baudoku.db.put('sheets', {
          id: 'sh-v15', projectId: id, title: 'Bestand v1.5', width: 1000, height: 1400, created: 1, updated: 1,
          strokes: [{ tool: 'pen', color: '#e8590c', width: 0.012, points: [[0.05, 0.05], [0.1, 0.12], [0.08, 0.2]] }],
          doc: {
            next: 20, chains: [], parallels: [], texts: [], faceOffsets: [],
            nodes: [{ id: 'n1', x: 0.2, y: 0.25 }, { id: 'n2', x: 0.7, y: 0.25 }, { id: 'n3', x: 0.7, y: 0.6 }, { id: 'n4', x: 0.2, y: 0.6 }],
            edges: [
              { id: 'e1', a: 'n1', b: 'n2', label: 'a', measure: { value: 8, unit: 'm', source: 'user' } },
              { id: 'e2', a: 'n2', b: 'n3', label: 'b', measure: { value: 3, unit: 'm', source: 'user' } },
              { id: 'e3', a: 'n3', b: 'n4', label: 'c', measure: null },
              { id: 'e4', a: 'n4', b: 'n1', label: 'd', measure: null },
            ],
            strokes: [{ id: 's1', points: [[0.05, 0.05], [0.1, 0.12], [0.08, 0.2]], color: '#e8590c', width: 0.012 }],
            rights: [{ id: 'r1', node: 'n1', e1: 'e4', e2: 'e1' }, { id: 'r2', node: 'n2', e1: 'e1', e2: 'e2' }, { id: 'r3', node: 'n3', e1: 'e2', e2: 'e3' }, { id: 'r4', node: 'n4', e1: 'e3', e2: 'e4' }],
            seq: [{ type: 'stroke', id: 's1' }, { type: 'edge', id: 'e1' }, { type: 'edge', id: 'e2' }, { type: 'edge', id: 'e3' }, { type: 'edge', id: 'e4' }],
          },
        });
        await window.__baudoku.db.put('sketches', {
          id: 'sk-old', projectId: id, title: 'Alte Fläche', created: 1, updated: 1, imgW: 1000, imgH: 1000, faces: [{ id: 'f1', label: 'F1', vertexIds: ['v1', 'v2', 'v3', 'v4'] }], viewKind: 'projection',
          vertices: [{ id: 'v1', x: 100, y: 100 }, { id: 'v2', x: 500, y: 100 }, { id: 'v3', x: 500, y: 400 }, { id: 'v4', x: 100, y: 400 }],
          edges: [
            { id: 'oe1', v1: 'v1', v2: 'v2', label: 'a', lengthM: 6 },
            { id: 'oe2', v1: 'v2', v2: 'v3', label: 'b', lengthM: 4 },
            { id: 'oe3', v1: 'v3', v2: 'v4', label: 'c', lengthM: 6 },
            { id: 'oe4', v1: 'v4', v2: 'v1', label: 'd', lengthM: 4 },
          ],
        });
      }, pid);
      await page.locator('#drawBack').click();
      await page.getByText('Bestand v1.5', { exact: true }).click();
      await page.waitForFunction(() => (window.__baudoku.draw?.faces()[0]?.text || '').includes('24,00'));
      const oldInk = await page.evaluate(() => window.__baudoku.draw.strokes().find((s) => s.tool === 'pen'));
      assert.equal(oldInk.color, '#e8590c');
      await page.locator('#drawBack').click();
      await page.getByText('Alte Fläche', { exact: true }).click();
      await page.waitForFunction(() => window.__baudoku.draw && window.__baudoku.draw.edges() === 4);
      const kept = await page.evaluate(async () => {
        const sk = await window.__baudoku.db.get('sketches', 'sk-old');
        return sk.vertices.length === 4 && sk.edges[0].lengthM === 6 && sk.faces[0].label === 'F1';
      });
      if (!kept) throw new Error('alte Flächenskizze verändert');
      await page.locator('#drawBack').click();
      await page.locator('button[data-tab="aufmass"]').click();
      await page.waitForSelector('input[value="Ortgang bleibt"]');
      await page.locator('#amSketch').click();
      await page.locator('.sk-src', { hasText: 'Rechteck' }).click();
      await page.waitForSelector('#skPrev');
      await page.waitForSelector('text=Maß fehlt');
      const blocked = await page.locator('.sk-row.missing input[data-take]:disabled').count();
      assert.ok(blocked >= 1);
      await page.waitForSelector('text=Fläche');
      await shot('baudoku-aufmass-skizzen.png');
      await page.locator('#skTake').click();
      await page.waitForSelector('input[value="Ortgang bleibt"]');
      await page.waitForSelector('input[value="Fläche F1"]');
      const menge = await page.locator('.am-row', { has: page.locator('input[value="Fläche F1"]') }).locator('[data-k="menge"]').inputValue();
      assert.match(menge, /42,5/);
    }
    await context.close();
  }

  await scenario({ width: 390, height: 844 }, 'phone');
  await scenario({ width: 820, height: 1180 }, 'tablet');
  assert.deepEqual(errors, [], errors.join('\n'));
} finally {
  await browser.close();
  child.kill();
}

test('touch v1.6 completed', () => { assert.equal(errors.length, 0); });
