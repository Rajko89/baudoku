import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homography, applyH, polyArea, estimateRectangle, planeSummary, realMapper, emptyMeasure, orderQuad } from '../js/geom.js';

function project(X, f, cx, cy) {
  return [cx + f * X[0] / X[2], cy + f * X[1] / X[2]];
}
function rotY(p, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [c * p[0] + s * p[2], p[1], -s * p[0] + c * p[2]];
}
function rotX(p, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [p[0], c * p[1] - s * p[2], s * p[1] + c * p[2]];
}
function pose(p) {
  const r = rotX(rotY(p, 32 * Math.PI / 180), 24 * Math.PI / 180);
  return [r[0], r[1], r[2] + 10];
}

test('Homographie bildet ein bekanntes Rechteck und eine Innenfläche auf den Millimeter genau ab', () => {
  const breite = 4.2, hoehe = 2.5;
  const metric = [[0, 0], [breite, 0], [breite, hoehe], [0, hoehe]];
  const ziel = [[120, 90], [540, 70], [560, 420], [100, 400]];
  const hin = homography(metric, ziel);
  assert.ok(hin);
  const bild = metric.map((p) => applyH(hin, p));
  const zurueck = homography(bild, metric);
  assert.ok(zurueck);
  for (let i = 0; i < 4; i++) {
    const q = applyH(zurueck, bild[i]);
    assert.ok(Math.hypot(q[0] - metric[i][0], q[1] - metric[i][1]) < 1e-6, `Ecke ${i}`);
  }
  const innen = [[0.5, 0.4], [2.1, 0.4], [2.1, 1.6], [0.5, 1.6]];
  const innenBild = innen.map((p) => applyH(hin, p));
  const flaeche = polyArea(innenBild.map((p) => applyH(zurueck, p)));
  const soll = 1.6 * 1.2;
  assert.ok(Math.abs(flaeche - soll) / soll < 1e-6, `Fläche ${flaeche} statt ${soll}`);
});

test('ein Referenzmaß rekonstruiert die zweite Seite einer echten Kameraprojektion', () => {
  const f = 700, cx = 400, cy = 300, w = 800, h = 600;
  const breite = 4.2, hoehe = 2.8;
  const ecken3 = [
    [-breite / 2, -hoehe / 2, 0],
    [breite / 2, -hoehe / 2, 0],
    [breite / 2, hoehe / 2, 0],
    [-breite / 2, hoehe / 2, 0],
  ].map(pose);
  const bild = orderQuad(ecken3.map((p) => project(p, f, cx, cy)));
  const nurBreite = estimateRectangle(bild, { width: breite }, { w, h });
  assert.equal(nurBreite.method, 'vanish');
  const fehlerH = Math.abs(nurBreite.h - hoehe) / hoehe;
  assert.ok(fehlerH < 0.005, `Höhenfehler ${(fehlerH * 100).toFixed(3)} %`);
  const nurHoehe = estimateRectangle(bild, { height: hoehe }, { w, h });
  const fehlerB = Math.abs(nurHoehe.w - breite) / breite;
  assert.ok(fehlerB < 0.005, `Breitenfehler ${(fehlerB * 100).toFixed(3)} %`);
  const fenster = [
    [-0.6, -0.4, 0],
    [0.6, -0.4, 0],
    [0.6, 0.4, 0],
    [-0.6, 0.4, 0],
  ].map((p) => project(pose(p), f, cx, cy));
  const fensterGeordnet = orderQuad(fenster);
  const m = emptyMeasure();
  m.mode = 'persp';
  m.persp = { pts: bild, w: nurBreite.w, h: nurBreite.h, accuracy: 'one' };
  m.items = [
    { id: 'dach', type: 'area', name: 'Dach', pts: bild },
    { id: 'gaube', type: 'area', name: 'Fenster', abzug: true, pts: fensterGeordnet },
    { id: 'traufe', type: 'line', name: 'Traufe', pts: [bild[0], bild[1]] },
  ];
  const sum = planeSummary(m);
  const dachSoll = breite * hoehe;
  const abzugSoll = 1.2 * 0.8;
  assert.ok(Math.abs(sum.areas[0].value - dachSoll) / dachSoll < 0.01, `Dach ${sum.areas[0].value}`);
  assert.ok(Math.abs(sum.deductions[0].value - abzugSoll) / abzugSoll < 0.01, `Abzug ${sum.deductions[0].value}`);
  assert.ok(Math.abs(sum.net - (dachSoll - abzugSoll)) / dachSoll < 0.01, `Netto ${sum.net}`);
  assert.ok(Math.abs(sum.lengths[0].value - breite) / breite < 0.005, `Traufe ${sum.lengths[0].value}`);
  assert.equal(sum.accuracy, 'one');
  assert.ok(realMapper(m));
});

test('alte Perspektivmessung ohne neue Felder bleibt eine Zwei-Maß-Messung', () => {
  const m = emptyMeasure();
  m.mode = 'persp';
  m.persp = { pts: [[0, 0], [100, 0], [100, 50], [0, 50]], w: 4, h: 2 };
  m.items = [{ id: 'a', type: 'area', name: 'Feld', pts: [[0, 0], [100, 0], [100, 50], [0, 50]] }];
  const sum = planeSummary(m);
  assert.equal(sum.accuracy, 'two');
  assert.ok(Math.abs(sum.net - 8) < 1e-6, sum.net);
  assert.equal(estimateRectangle(m.persp.pts, { width: 4, height: 2 }, { w: 100, h: 50 }), null);
});
