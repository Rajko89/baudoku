import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyDoc, addDim, patchDim, setScaleFromDim, suggestMeters, addMarker, patchMarker, addShape, fitSymbols, angleSnap, addStroke, deleteStroke, addLine } from '../js/plan.js';

test('Maßkette, Maßstab und ca. ändern alte Maße nicht', () => {
  const vorher = emptyDoc();
  let d = addDim(vorher, 0, 0, 0.5, 0, 2, 'm', false);
  assert.equal(vorher.dims, undefined);
  assert.equal(d.dims[0].approx, false);
  assert.equal(d.edges.length, 0);
  d = setScaleFromDim(d, d.dims[0].id);
  const vorschlag = suggestMeters(d, 0, 0, 1, 0);
  assert.ok(Math.abs(vorschlag - 4) < 1e-6);
  d = addDim(d, 0, 0, 1, 0, vorschlag, 'm', true);
  assert.equal(d.dims[1].approx, true);
  const ungefaehr = addDim(emptyDoc(), 0, 0, 1, 0, 3, 'm', true);
  assert.equal(setScaleFromDim(ungefaehr, ungefaehr.dims[0].id).scale, undefined);
  d = patchDim(d, d.dims[0].id, { value: 2.5 });
  assert.equal(d.dims[0].value, 2.5);
  assert.equal(d.dims[1].value, vorschlag);
});

test('Marker zählen hoch und alte Zeichnung bleibt ladbar', () => {
  const alt = addLine(emptyDoc(), { x: 0, y: 0 }, { x: 1, y: 0 });
  delete alt.dims;
  delete alt.markers;
  let d = addMarker(alt, 0.2, 0.3, '');
  d = addMarker(d, 0.6, 0.4, 'Riss');
  assert.equal(alt.markers, undefined);
  assert.equal(d.edges.length, 1);
  assert.deepEqual(d.markers.map((m) => m.n), [1, 2]);
  d = patchMarker(d, d.markers[0].id, { note: 'Traufe' });
  assert.equal(d.markers[0].note, 'Traufe');
  assert.equal(d.markers[1].note, 'Riss');
});

test('Symbolarten bleiben erhalten und werden nicht zum Viereck', () => {
  const d = addShape(emptyDoc(), { kind: 'damage', x: 0.4, y: 0.4, d: 0.08, color: '#e03131' });
  assert.equal(d.shapes[0].kind, 'damage');
  assert.equal(d.shapes[0].symbol, true);
  const fitted = fitSymbols(d, 1000, 1400);
  assert.equal(fitted.shapes[0].kind, 'damage');
  assert.equal(fitted.shapes[0].d, 0.08);
  for (const kind of ['leak', 'water', 'gutter', 'penetration', 'mark']) {
    const s = addShape(emptyDoc(), { kind, x: 0.5, y: 0.5, d: 0.07 });
    assert.equal(s.shapes[0].kind, kind);
  }
});

test('45° nur mit Einschalten, gerade und 90° bleiben', () => {
  const start = { x: 0, y: 0 };
  const schraeg = 40 * Math.PI / 180;
  assert.equal(angleSnap(emptyDoc(), start, Math.cos(schraeg), Math.sin(schraeg)), null);
  const diag = angleSnap(emptyDoc(), start, Math.cos(schraeg), Math.sin(schraeg), undefined, { diagonals: true });
  assert.ok(Math.abs(Math.atan2(diag.y, diag.x) - Math.PI / 4) < 0.02);
  const gerade = angleSnap(emptyDoc(), start, 1, 0.05);
  assert.ok(gerade);
  assert.ok(Math.abs(gerade.y) < 0.02);
});

test('ein Strich lässt sich löschen, der andere bleibt', () => {
  let d = addStroke(emptyDoc(), [[0, 0], [0.2, 0.2]], { color: '#111111' });
  const weg = d.strokes[0].id;
  d = addStroke(d, [[0.2, 0], [0.4, 0.3]], { color: '#e03131' });
  d = deleteStroke(d, weg);
  assert.equal(d.strokes.length, 1);
  assert.equal(d.strokes[0].color, '#e03131');
});
