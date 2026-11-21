import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyDoc, addLine, setMeasure, setEdgeName, edgeTitle, namedMeasure, splitEdgeAt, sketchProposals, partSummary, toggleRight, evaluateFaces } from '../js/plan.js';

function line(doc, x1, y1, x2, y2) { return addLine(doc, { x: x1, y: y1 }, { x: x2, y: y2 }); }
function rect() {
  let d = emptyDoc();
  d = line(d, 0, 0, 1, 0);
  d = line(d, 1, 0, 1, 1);
  d = line(d, 1, 1, 0, 1);
  d = line(d, 0, 1, 0, 0);
  return d;
}
function edge(doc, label) { return doc.edges.find((e) => e.label === label); }

test('Name setzen und entfernen, Buchstabe bleibt', () => {
  let d = rect();
  const id = edge(d, 'a').id;
  d = setEdgeName(d, id, '  Dachrinne  ');
  assert.equal(edge(d, 'a').name, 'Dachrinne');
  assert.equal(edge(d, 'a').label, 'a');
  assert.equal(edgeTitle(edge(d, 'a')), 'Dachrinne (a)');
  d = setMeasure(d, id, 8.5, 'm');
  assert.equal(namedMeasure(edge(d, 'a')), 'Dachrinne 8,50 m');
  assert.equal(edgeTitle(edge(d, 'a')), '');
  const before = JSON.parse(JSON.stringify(d));
  d = setEdgeName(d, id, '');
  assert.equal(edge(d, 'a').name, undefined);
  assert.equal(edge(d, 'a').label, 'a');
  assert.equal(edgeTitle(edge(d, 'a')), 'a');
  assert.equal(namedMeasure(edge(d, 'a')), '');
  assert.equal(edge(d, 'a').measure.value, 8.5);
  assert.equal(before.edges.find((e) => e.label === 'a').label, 'a');
});

test('Name in Aus Skizzen, alte Skizze bleibt Seite A', () => {
  let d = rect();
  d = setMeasure(d, edge(d, 'a').id, 8.5, 'm');
  assert.equal(sketchProposals(d).sides.find((s) => s.id === edge(d, 'a').id).bez, 'Seite A');
  d = setEdgeName(d, edge(d, 'a').id, 'Attika');
  const row = sketchProposals(d).sides.find((s) => s.id === edge(d, 'a').id);
  assert.equal(row.bez, 'Attika');
  assert.equal(row.value, 8.5);
  assert.equal(row.unit, 'm');
  assert.equal(row.take, true);
});

test('Teilstrecken behalten den Namen und bleiben a1/a2', () => {
  let d = rect();
  for (const n of d.nodes) d = toggleRight(d, n.id).doc;
  d = setMeasure(d, edge(d, 'a').id, 8.5, 'm');
  d = setMeasure(d, edge(d, 'b').id, 4.2, 'm');
  d = setEdgeName(d, edge(d, 'a').id, 'Blende');
  d = splitEdgeAt(d, edge(d, 'a').id, 0.5);
  assert.equal(edge(d, 'a1').name, 'Blende');
  assert.equal(edge(d, 'a2').name, 'Blende');
  assert.equal(edge(d, 'a1').label, 'a1');
  assert.equal(namedMeasure(edge(d, 'a1')), 'Blende 4,25 m');
  const prop = sketchProposals(d);
  assert.equal(prop.sides.filter((s) => s.bez === 'Blende' && s.take).length, 2);
  assert.ok(!prop.sides.some((s) => s.bez === 'Seite A1'));
  d = setEdgeName(d, edge(d, 'a2').id, 'Ortgang');
  assert.equal(sketchProposals(d).sides.find((s) => s.id === edge(d, 'a2').id).bez, 'Ortgang');
  const faces = evaluateFaces(d);
  assert.equal(faces.length, 1);
  assert.equal(faces[0].ok, true);
  assert.ok(Math.abs(faces[0].ev.area - 35.7) < 0.05, faces[0].text);
});

test('Summe gleicher Namen mit Rechenweg, Großschreibung und Einheiten', () => {
  const rows = [
    { bez: 'Blende', menge: 8.5, einheit: 'm' },
    { bez: ' Dachrinne ', menge: 3, einheit: 'm' },
    { bez: 'blende', menge: 4.2, einheit: 'm' },
    { bez: '  BLENDE ', menge: 8.5, einheit: 'm' },
    { bez: 'Blende', menge: 4.2, einheit: 'm' },
    { bez: 'Attika', menge: 4.2, einheit: 'm' },
    { bez: 'Seite A', menge: 3, einheit: 'm' },
    { bez: 'a', menge: 1, einheit: 'm' },
    { bez: 'a', menge: 2, einheit: 'm' },
    { bez: 'Fläche F1', menge: 35.7, einheit: 'm²' },
    { bez: 'Fläche F1', menge: 10, einheit: 'm²' },
    { bez: 'Blende', menge: 2, einheit: 'cm' },
    { bez: 'Blende', menge: 3, einheit: 'cm' },
  ];
  const before = JSON.stringify(rows);
  const sums = partSummary(rows);
  assert.equal(JSON.stringify(rows), before);
  const blende = sums.find((s) => s.name === 'Blende' && s.unit === 'm');
  assert.ok(blende);
  assert.equal(blende.text, 'Blende: 8,50 m + 4,20 m + 8,50 m + 4,20 m = 25,40 m');
  assert.equal(sums.filter((s) => s.unit === 'm²').length, 0);
  assert.equal(sums.filter((s) => s.name === 'Seite A' || s.name === 'a').length, 0);
  assert.equal(sums.find((s) => s.name === 'Attika'), undefined);
  assert.equal(sums.find((s) => s.unit === 'cm').text, 'Blende: 2,00 cm + 3,00 cm = 5,00 cm');
});
