import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyDoc, addLine, setMeasure, toggleRight, setParallel, evaluateCycle, snapTarget, cycleAt, importLegacyStrokes, fmtNum, angleSnap, evaluateFaces, polylabel, pointInPoly, sketchProposals, moveEdge, nodeById } from '../js/plan.js';

function line(doc, x1, y1, x2, y2) { return addLine(doc, { x: x1, y: y1 }, { x: x2, y: y2 }); }
function rect() {
  let d = emptyDoc();
  d = line(d, 0, 0, 1, 0);
  d = line(d, 1, 0, 1, 1);
  d = line(d, 1, 1, 0, 1);
  d = line(d, 0, 1, 0, 0);
  return d;
}
function idsOf(doc) {
  const hit = cycleAt(doc, 0.5, 0.5);
  assert.ok(hit, 'keine Fläche');
  return hit.nodes;
}
function edge(doc, label) { return doc.edges.find((e) => e.label === label); }

test('Rechteck mit vier rechten Winkeln und zwei Seiten', () => {
  let d = rect();
  for (const n of d.nodes) d = toggleRight(d, n.id).doc;
  d = setMeasure(d, edge(d, 'a').id, 8.5, 'm');
  d = setMeasure(d, edge(d, 'b').id, 4.2, 'm');
  const ev = evaluateCycle(d, idsOf(d));
  assert.equal(ev.ok, true);
  assert.ok(Math.abs(ev.area - 35.7) < 0.02, ev.area);
  assert.match(ev.steps.join('\n'), /8,50 m x 4,20 m = 35,70 m²/);
  assert.match(ev.steps.join('\n'), /abgeleitet/);
});

test('gleiche Form ohne rechte Winkel nennt die fehlenden Winkel', () => {
  let d = rect();
  d = setMeasure(d, edge(d, 'a').id, 8.5, 'm');
  d = setMeasure(d, edge(d, 'b').id, 4.2, 'm');
  const ev = evaluateCycle(d, idsOf(d));
  assert.equal(ev.ok, false);
  assert.ok(ev.missing.some((m) => /Winkel bei Punkt/.test(m)));
  assert.equal(ev.area, null);
});

test('Widerspruch gegenüberliegende Seiten', () => {
  let d = rect();
  for (const n of d.nodes) d = toggleRight(d, n.id).doc;
  d = setMeasure(d, edge(d, 'a').id, 8, 'm');
  d = setMeasure(d, edge(d, 'c').id, 9, 'm');
  d = setMeasure(d, edge(d, 'b').id, 4, 'm');
  const ev = evaluateCycle(d, idsOf(d));
  assert.equal(ev.ok, false);
  assert.match(ev.contradictions.join(' '), /verschieden/);
});

test('Dreiecksungleichung und Heron', () => {
  let d = emptyDoc();
  d = line(d, 0, 0, 1, 0);
  d = line(d, 1, 0, 0.2, 0.8);
  d = line(d, 0.2, 0.8, 0, 0);
  d = setMeasure(d, edge(d, 'a').id, 2, 'm');
  d = setMeasure(d, edge(d, 'b').id, 1, 'm');
  d = setMeasure(d, edge(d, 'c').id, 5, 'm');
  const bad = evaluateCycle(d, cycleAt(d, 0.3, 0.2).nodes);
  assert.equal(bad.ok, false);
  assert.match(bad.contradictions.join(' '), /Dreiecksungleichung/);
  let h = emptyDoc();
  h = line(h, 0, 0, 0.3, 0);
  h = line(h, 0.3, 0, 0.3, 0.4);
  h = line(h, 0.3, 0.4, 0, 0);
  h = setMeasure(h, edge(h, 'a').id, 3, 'm');
  h = setMeasure(h, edge(h, 'b').id, 4, 'm');
  h = setMeasure(h, edge(h, 'c').id, 5, 'm');
  const ev = evaluateCycle(h, cycleAt(h, 0.2, 0.1).nodes);
  assert.equal(ev.ok, true);
  assert.ok(Math.abs(ev.area - 6) < 0.02);
});

test('rechtwinkliges Dreieck aus zwei Katheten', () => {
  let d = emptyDoc();
  d = line(d, 0, 0, 0.6, 0);
  d = line(d, 0.6, 0, 0.6, 0.4);
  d = line(d, 0.6, 0.4, 0, 0);
  const corner = d.nodes.find((n) => Math.abs(n.x - 0.6) < 1e-6 && Math.abs(n.y) < 1e-6);
  d = toggleRight(d, corner.id).doc;
  d = setMeasure(d, edge(d, 'a').id, 6, 'm');
  d = setMeasure(d, edge(d, 'b').id, 4, 'm');
  const ev = evaluateCycle(d, cycleAt(d, 0.5, 0.1).nodes);
  assert.equal(ev.ok, true);
  assert.ok(Math.abs(ev.area - 12) < 0.05, ev.area);
});

test('L-Form mit Maßkette und Teilflächen', () => {
  let d = emptyDoc();
  const pts = [[0, 0], [0.8, 0], [0.8, 0.3], [0.5, 0.3], [0.5, 0.5], [0, 0.5]];
  for (let i = 0; i < pts.length; i++) d = line(d, pts[i][0], pts[i][1], pts[(i + 1) % pts.length][0], pts[(i + 1) % pts.length][1]);
  for (const n of d.nodes) d = toggleRight(d, n.id).doc;
  for (const [k, v] of Object.entries({ a: 8, b: 3, c: 3, d: 2, e: 5 })) d = setMeasure(d, edge(d, k).id, v, 'm');
  const ev = evaluateCycle(d, cycleAt(d, 0.2, 0.1).nodes);
  assert.equal(ev.ok, true, JSON.stringify(ev.missing) + JSON.stringify(ev.contradictions));
  assert.ok(Math.abs(ev.area - 34) < 0.05, ev.area);
  assert.ok(ev.parts.length >= 2);
  assert.match(ev.steps.join('\n'), /abgeleitet/);
  assert.match(ev.steps.join('\n'), /F1/);
  assert.match(ev.steps.join('\n'), /F2/);
});

test('fehlende Strecke wird benannt', () => {
  let d = rect();
  for (const n of d.nodes) d = toggleRight(d, n.id).doc;
  d = setMeasure(d, edge(d, 'a').id, 8, 'm');
  const ev = evaluateCycle(d, idsOf(d));
  assert.equal(ev.ok, false);
  assert.match(ev.missing.join(' '), /Strecke b fehlt/);
});

test('Einrasten an Endpunkt und Kreuzung', () => {
  let d = emptyDoc();
  d = line(d, 0.2, 0.2, 0.8, 0.8);
  d = line(d, 0.2, 0.8, 0.8, 0.2);
  assert.equal(snapTarget(d, 0.21, 0.19, 0.05).kind, 'node');
  const cross = snapTarget(d, 0.52, 0.5, 0.05);
  assert.equal(cross.kind, 'cross');
  assert.ok(Math.abs(cross.x - 0.5) < 0.02);
  assert.equal(snapTarget(d, 0.5, 0.1, 0.02), null);
});

test('alte Striche und Kommaformat', () => {
  assert.equal(fmtNum(8.5), '8,50');
  const doc = importLegacyStrokes([{ tool: 'line', points: [[0.1, 0.1], [0.4, 0.1]] }, { tool: 'pen', points: [[0, 0], [0.2, 0.2], [0.1, 0.3]] }]);
  assert.equal(doc.edges.length, 1);
  assert.equal(doc.strokes.length, 1);
});

test('Winkelfang setzt einen rechten Winkel, knapp daneben nicht', () => {
  let d = emptyDoc();
  d = line(d, 0, 0, 1, 0);
  const start = d.nodes.find((n) => n.x === 1);
  const ang = Math.PI / 2 + 5 * Math.PI / 180;
  const raw = { x: 1 + Math.cos(ang) * 0.4, y: Math.sin(ang) * 0.4 };
  const snap = angleSnap(d, { x: 1, y: 0, nodeId: start.id }, raw.x, raw.y);
  assert.ok(snap);
  assert.ok(Math.abs(snap.x - 1) < 0.01, snap.x);
  assert.equal(snap.right.edgeId, edge(d, 'a').id);
  d = addLine(d, { x: 1, y: 0, nodeId: start.id }, { x: snap.x, y: snap.y }, { rights: [snap.right] });
  assert.equal(d.rights.length, 1);
  const far = Math.PI / 2 + 20 * Math.PI / 180;
  assert.equal(angleSnap(d, { x: 1, y: 0, nodeId: start.id }, 1 + Math.cos(far) * 0.4, Math.sin(far) * 0.4), null);
});

test('Freie Linie bleibt ohne rechten Winkel und ohne Fläche', () => {
  let d = emptyDoc();
  const pts = [[0, 0], [1, 0], [1, 1], [0, 1]];
  for (let i = 0; i < 4; i++) d = addLine(d, { x: pts[i][0], y: pts[i][1] }, { x: pts[(i + 1) % 4][0], y: pts[(i + 1) % 4][1] }, { free: true });
  assert.equal(d.rights.length, 0);
  assert.ok(d.edges.every((e) => e.free));
  d = setMeasure(d, edge(d, 'a').id, 8, 'm');
  d = setMeasure(d, edge(d, 'b').id, 4, 'm');
  const faces = evaluateFaces(d);
  assert.equal(faces.length, 1);
  assert.equal(faces[0].ok, false);
  assert.match(faces[0].text, /Freie Linie/);
});

test('Zentimeter werden zu Quadratmetern, Label liegt in der L-Form', () => {
  let d = rect();
  for (const n of d.nodes) d = toggleRight(d, n.id).doc;
  d = setMeasure(d, edge(d, 'a').id, 850, 'cm');
  d = setMeasure(d, edge(d, 'b').id, 420, 'cm');
  const ev = evaluateCycle(d, idsOf(d));
  assert.equal(ev.ok, true);
  assert.ok(Math.abs(ev.area - 35.7) < 0.02, ev.area);
  const L = [[0, 0], [0.8, 0], [0.8, 0.3], [0.5, 0.3], [0.5, 0.5], [0, 0.5]];
  const pole = polylabel(L.map(([x, y]) => ({ x, y })));
  assert.equal(pointInPoly(L.map(([x, y]) => ({ x, y })), pole.x, pole.y), true);
  assert.ok(pole.x < 0.5 && pole.y < 0.3, JSON.stringify(pole));
});

test('zwei Flächen und fehlendes Maß in den Vorschlägen', () => {
  let d = rect();
  for (const n of d.nodes) d = toggleRight(d, n.id).doc;
  d = setMeasure(d, edge(d, 'a').id, 2, 'm');
  d = setMeasure(d, edge(d, 'b').id, 3, 'm');
  d = addLine(d, { x: 1.2, y: 0 }, { x: 2, y: 0 });
  d = addLine(d, { x: 2, y: 0 }, { x: 2, y: 1 });
  d = addLine(d, { x: 2, y: 1 }, { x: 1.2, y: 1 });
  d = addLine(d, { x: 1.2, y: 1 }, { x: 1.2, y: 0 });
  const faces = evaluateFaces(d);
  assert.equal(faces.length, 2);
  assert.ok(faces.some((f) => f.ok && Math.abs(f.ev.area - 6) < 0.05));
  assert.ok(faces.some((f) => !f.ok && /Maße fehlen|fehlt/.test(f.text + f.ev.steps.join(' '))));
  const prop = sketchProposals(d);
  assert.ok(prop.sides.some((s) => s.bez === 'Seite A' && s.take && s.value === 2));
  assert.ok(prop.sides.some((s) => s.missing && !s.take));
  assert.equal(prop.areas.filter((a) => a.take).length, 1);
  const moved = moveEdge(d, edge(d, 'a').id, 0, 0.05);
  const a = moved.edges.find((e) => e.label === 'a');
  assert.ok(Math.abs(nodeById(moved, a.a).y - 0.05) < 1e-6);
});

test('Trapez nur mit festgelegter Parallelität', () => {
  let d = rect();
  d = setMeasure(d, edge(d, 'a').id, 8, 'm');
  d = setMeasure(d, edge(d, 'c').id, 4, 'm');
  d = setMeasure(d, edge(d, 'b').id, 3, 'm');
  assert.equal(evaluateCycle(d, idsOf(d)).ok, false);
  d = setParallel(d, edge(d, 'a').id, edge(d, 'c').id);
  d = toggleRight(d, d.nodes[1].id).doc;
  const ev = evaluateCycle(d, idsOf(d));
  assert.equal(ev.ok, true, JSON.stringify(ev));
  assert.ok(Math.abs(ev.area - 18) < 0.05, ev.area);
});
