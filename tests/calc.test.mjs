import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  computeFace, formatCalcText, sumSelected, reliableScale, resolveEdgeLength, scaledEdgeLength, fmtM,
} from '../js/sketch-calc.js';
import { detectOutline } from '../js/detect.js';

const id = (s) => s;
function edge(label, x1, y1, x2, y2, extra = {}) {
  return { id: label, label, v1: label + '1', v2: label + '2', role: extra.role || '', lengthM: extra.lengthM ?? null, aufmassId: extra.aufmassId || null, ...extra, id: extra.id || label };
}
function sketch(partial) {
  const edges = partial.edges || [];
  const vertices = [];
  edges.forEach((e) => {
    if (!vertices.some((v) => v.id === e.v1)) vertices.push({ id: e.v1, x: e._a[0], y: e._a[1] });
    if (!vertices.some((v) => v.id === e.v2)) vertices.push({ id: e.v2, x: e._b[0], y: e._b[1] });
  });
  return { viewKind: 'unknown', scale: { mode: 'none' }, vertices, faces: [], ...partial, edges: edges.map(({ _a, _b, ...e }) => e) };
}
function E(label, a, b, extra) {
  return { ...edge(label, ...a, ...b, extra), _a: a, _b: b, v1: label + 'a', v2: label + 'b' };
}

test('rectangle slope length 8.50 x 4.20', () => {
  const sk = sketch({
    edges: [E('a', [0, 0], [100, 0], { lengthM: 8.5, role: 'traufe' }), E('b', [100, 0], [100, 40], { lengthM: 4.2, role: 'schraege' })],
  });
  const face = { id: 'f1', label: 'F1', shape: 'rect', areaMode: 'sloped', slopeSource: 'edge', edgeA: 'a', edgeB: 'b', isDeduction: false };
  const calc = computeFace(sk, face, new Map());
  assert.equal(calc.ok, true);
  assert.equal(calc.result, 35.7);
  assert.equal(calc.areaKind, 'sloped');
  const text = formatCalcText({ pos: '01', name: 'Dachfläche F1', calc });
  assert.match(text, /Position 01 – Dachfläche F1, Rechteck/);
  assert.match(text, /a = 8,50 m/);
  assert.match(text, /b = 4,20 m, gemessene schräge Dachlänge/);
  assert.match(text, /Formel: A = a x b/);
  assert.match(text, /8,50 m x 4,20 m = 35,70 m²/);
});

test('rectangle projection vs pitch', () => {
  const sk = sketch({
    edges: [E('a', [0, 0], [10, 0], { lengthM: 8.5 }), E('b', [10, 0], [10, 4], { lengthM: 4.2 })],
  });
  const proj = computeFace(sk, { label: 'F1', shape: 'rect', areaMode: 'projection', edgeA: 'a', edgeB: 'b' }, new Map());
  assert.equal(proj.ok, true);
  assert.equal(proj.areaKind, 'projection');
  assert.equal(proj.result, 35.7);
  const sloped = computeFace(sk, { label: 'F1', shape: 'rect', areaMode: 'sloped', slopeSource: 'pitch', pitchDeg: 45, edgeA: 'a', edgeB: 'b' }, new Map());
  assert.equal(sloped.ok, true);
  assert.equal(sloped.areaKind, 'sloped');
  assert.equal(sloped.result, 50.49);
  const missing = computeFace(sk, { label: 'F1', shape: 'rect', areaMode: 'sloped', slopeSource: 'pitch', edgeA: 'a', edgeB: 'b' }, new Map());
  assert.equal(missing.ok, false);
  assert.match(missing.missing[0], /Dachneigung/);
});

test('triangle base-height and heron, trapezoid height prompt', () => {
  const tri = sketch({ edges: [E('a', [0, 0], [6, 0], { lengthM: 6, role: 'traufe' }), E('h', [3, 0], [3, 4], { lengthM: 4, role: 'hoehe' })] });
  const t = computeFace(tri, { label: 'F2', shape: 'tri', areaMode: 'projection', baseEdgeId: 'a', heightEdgeId: 'h' }, new Map());
  assert.equal(t.ok, true);
  assert.equal(t.result, 12);
  const her = sketch({
    edges: [E('a', [0, 0], [3, 0], { lengthM: 3 }), E('b', [3, 0], [3, 4], { lengthM: 4 }), E('c', [3, 4], [0, 0], { lengthM: 5 })],
  });
  const h = computeFace(her, { label: 'F2', shape: 'tri', areaMode: 'projection', edgeIds: ['a', 'b', 'c'] }, new Map());
  assert.equal(h.ok, true);
  assert.equal(h.result, 6);
  const trap = sketch({ edges: [E('a', [0, 0], [8, 0], { lengthM: 8 }), E('c', [1, 3], [6, 3], { lengthM: 5 })] });
  const miss = computeFace(trap, { label: 'F3', shape: 'trap', areaMode: 'projection', baseEdgeId: 'a', baseEdgeId2: 'c', heightEdgeId: 'h' }, new Map());
  assert.equal(miss.ok, false);
  assert.match(miss.missing[0], /Höhe/);
  const trapOk = sketch({ edges: [E('a', [0, 0], [8, 0], { lengthM: 8 }), E('c', [1, 3], [6, 3], { lengthM: 5 }), E('h', [0, 0], [0, 3], { lengthM: 3, role: 'hoehe' })] });
  const ok = computeFace(trapOk, { label: 'F3', shape: 'trap', areaMode: 'projection', baseEdgeId: 'a', baseEdgeId2: 'c', heightEdgeId: 'h' }, new Map());
  assert.equal(ok.result, 19.5);
});

test('polygon without scale asks, with top-view scale uses shoelace', () => {
  const bare = sketch({
    viewKind: 'unknown',
    edges: [E('a', [0, 0], [10, 0]), E('b', [10, 0], [10, 10]), E('c', [10, 10], [0, 10]), E('d', [0, 10], [0, 0])],
    vertices: [{ id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 100, y: 0 }, { id: 'p3', x: 100, y: 50 }, { id: 'p4', x: 0, y: 50 }],
  });
  const miss = computeFace(bare, { label: 'F4', shape: 'poly', areaMode: 'projection', vertexIds: ['p1', 'p2', 'p3', 'p4'] }, new Map());
  assert.equal(miss.ok, false);
  assert.match(miss.missing[0], /Höhe|Diagonale|zerlegen/);
  const scaled = {
    viewKind: 'top',
    scale: { mode: 'ref', refEdgeId: 'a', refLengthM: 10 },
    edges: [{ id: 'a', label: 'a', v1: 'p1', v2: 'p2', lengthM: 10, role: '' }],
    vertices: [{ id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 100, y: 0 }, { id: 'p3', x: 100, y: 40 }, { id: 'p4', x: 0, y: 40 }],
    faces: [],
  };
  assert.equal(reliableScale(scaled), 'ref');
  const poly = computeFace(scaled, { label: 'F4', shape: 'poly', areaMode: 'projection', vertexIds: ['p1', 'p2', 'p3', 'p4'] }, new Map());
  assert.equal(poly.ok, true);
  assert.equal(poly.areaKind, 'projection');
  assert.equal(poly.result, 40);
  const persp = sketch({ viewKind: 'perspective', edges: [E('a', [0, 0], [100, 0])], vertices: [] });
  assert.equal(reliableScale(persp), null);
  assert.equal(scaledEdgeLength(persp, persp.edges[0]), null);
});

test('composite and deduction, selected sum refuses mixed units', () => {
  const sk = sketch({
    edges: [
      E('a', [0, 0], [1, 0], { lengthM: 10 }), E('b', [1, 0], [1, 1], { lengthM: 4 }),
      E('c', [0, 0], [6, 0], { lengthM: 6 }), E('h', [0, 0], [0, 4], { lengthM: 4, role: 'hoehe' }),
      E('d', [0, 0], [2, 0], { lengthM: 2 }), E('e', [2, 0], [2, 1], { lengthM: 1 }),
    ],
    faces: [],
  });
  const f1 = { id: 'f1', label: 'F1', shape: 'rect', areaMode: 'projection', edgeA: 'a', edgeB: 'b' };
  const f2 = { id: 'f2', label: 'F2', shape: 'tri', areaMode: 'projection', baseEdgeId: 'c', heightEdgeId: 'h' };
  const f3 = { id: 'f3', label: 'F3', shape: 'rect', areaMode: 'projection', edgeA: 'd', edgeB: 'e', isDeduction: true };
  sk.faces = [f1, f2, f3];
  const comp = computeFace(sk, { id: 'f4', label: 'F4', isComposite: true, shape: 'poly', partFaceIds: ['f1', 'f2', 'f3'], areaMode: 'projection' }, new Map());
  assert.equal(comp.ok, true);
  assert.equal(comp.result, 50);
  assert.equal(comp.parts.length, 2);
  assert.equal(comp.deductions.length, 1);
  const text = formatCalcText({ pos: '04', name: 'Dachfläche F4', calc: comp });
  assert.match(text, /Teilflächen:/);
  assert.match(text, /Abzüge:/);
  assert.match(text, /50,00 m²/);
  const bad = sumSelected([{ einheit: 'm', menge: 8, pos: '01' }, { einheit: 'm²', menge: 10, pos: '02', calc: { ok: true, result: 10, areaKind: 'projection', isDeduction: false } }]);
  assert.equal(bad.ok, false);
  assert.match(bad.missing[0], /nicht mischen/);
  const good = sumSelected([
    { einheit: 'm²', menge: 40, pos: '01', bez: 'Dachfläche F1', calc: { ok: true, result: 40, areaKind: 'projection', isDeduction: false, shapeLabel: 'Rechteck', areaKindLabel: 'Grundriss-/Projektionsfläche', edges: [], formula: 'A = a x b', substitution: '40,00 m²', parts: [], deductions: [] } },
    { einheit: 'm²', menge: 12, pos: '02', bez: 'Dachfläche F2', calc: { ok: true, result: 12, areaKind: 'projection', isDeduction: false, shapeLabel: 'Dreieck', areaKindLabel: 'Grundriss-/Projektionsfläche', edges: [], formula: 'A = a x h / 2', substitution: '12,00 m²', parts: [], deductions: [] } },
  ]);
  assert.equal(good.ok, true);
  assert.equal(good.result, 52);
});

test('linked aufmass length wins over a stale manual length', () => {
  const sk = sketch({ edges: [E('a', [0, 0], [10, 0], { lengthM: 8.5, aufmassId: 'row' })] });
  const map = new Map([['row', { id: 'row', menge: 10, einheit: 'm', pos: '01', bez: 'Traufe' }]]);
  const len = resolveEdgeLength(sk, sk.edges[0], map);
  assert.equal(len.m, 10);
  assert.equal(len.source, 'aufmass');
  assert.equal(fmtM(10), '10,00');
});

test('detector finds rectangle corners and invents no lengths', () => {
  const w = 220, h = 150;
  const rgba = new Uint8ClampedArray(w * h * 4);
  rgba.fill(255);
  const set = (x, y) => { const i = (y * w + x) * 4; rgba[i] = rgba[i + 1] = rgba[i + 2] = 0; rgba[i + 3] = 255; };
  for (let x = 30; x <= 180; x++) for (let t = 0; t < 3; t++) { set(x, 28 + t); set(x, 118 + t); }
  for (let y = 28; y <= 120; y++) for (let t = 0; t < 3; t++) { set(30 + t, y); set(178 + t, y); }
  const found = detectOutline(rgba, w, h);
  assert.ok(found.vertices.length >= 4, 'vertices ' + found.vertices.length);
  const corners = [[30, 28], [180, 28], [180, 120], [30, 120]];
  for (const [x, y] of corners) {
    assert.ok(found.vertices.some((v) => Math.hypot(v.x - x, v.y - y) < 12), `missing corner ${x},${y} in ${JSON.stringify(found.vertices)}`);
  }
  assert.equal(JSON.stringify(found).includes('"m"'), false);
  assert.ok(found.edges.length >= 4);
});

test('repo contains no hardcoded company preset', () => {
  const root = new URL('..', import.meta.url).pathname;
  const skip = new Set(['.git', 'node_modules', 'vendor']);
  const hits = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (skip.has(name)) continue;
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (st.size < 2_000_000) {
        const text = readFileSync(p);
        const needle = Buffer.from([77, 101, 115, 99, 104, 101, 100, 101]);
        if (text.includes(needle)) hits.push(p);
      }
    }
  };
  walk(root);
  assert.deepEqual(hits, []);
});
