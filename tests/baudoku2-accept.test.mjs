import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { emptyDoc, addLine, setMeasure, toggleRight, setEdgeAssignment, setFaceAssignment, addPiece, setPieceAssignment, evaluateFaces } from '../zwei/js/plan.js';
import {
  SEEDS, mergeSeed, dimensionCaption, quantitiesFromDocs, syncServiceRows, blankOffer, refreshOffer,
  includeSuggested, totals, fmtEUR, patchItem, adoptCatalog, finalizeOffer, reviseOffer, moveItem,
  setManualQty, effectiveQty, uncheckedTestPrices,
} from '../zwei/js/catalog.js';

function lineDoc(len, assign) {
  let d = emptyDoc();
  d = addLine(d, { x: 0, y: 0 }, { x: 1, y: 0 });
  d = setMeasure(d, d.edges[0].id, len, 'm');
  if (assign) d = setEdgeAssignment(d, d.edges[0].id, assign);
  return d;
}
function addMeasured(doc, len, assign) {
  const y = 0.2 + doc.edges.length * 0.1;
  let d = addLine(doc, { x: 0, y }, { x: 1, y });
  const e = d.edges[d.edges.length - 1];
  d = setMeasure(d, e.id, len, 'm');
  if (assign) d = setEdgeAssignment(d, e.id, assign);
  return d;
}
function faceDoc(w, h, services, areaKind = 'slope') {
  let d = emptyDoc();
  d = addLine(d, { x: 0, y: 0 }, { x: 1, y: 0 });
  d = addLine(d, { x: 1, y: 0 }, { x: 1, y: 1 });
  d = addLine(d, { x: 1, y: 1 }, { x: 0, y: 1 });
  d = addLine(d, { x: 0, y: 1 }, { x: 0, y: 0 });
  for (const n of d.nodes) d = toggleRight(d, n.id).doc;
  d = setMeasure(d, d.edges.find((e) => e.label === 'a').id, w, 'm');
  d = setMeasure(d, d.edges.find((e) => e.label === 'b').id, h, 'm');
  const face = evaluateFaces(d)[0];
  assert.ok(face?.ok, JSON.stringify(face));
  d = setFaceAssignment(d, face.sig, { name: 'Dachfläche', services, areaKind });
  return d;
}
function quote(doc) {
  const q = quantitiesFromDocs([{ id: 's1', title: 'Dach', doc }], SEEDS);
  const refreshed = refreshOffer(blankOffer('p1'), q.groups, SEEDS);
  return { q, offer: includeSuggested(refreshed.offer), changes: refreshed.changes };
}

test('A eine Linie, eine Leistung', () => {
  const d = lineDoc(10, { name: 'Blende', services: [{ catalogId: 'cat-seed-01' }, { catalogId: 'cat-seed-01' }], labelMode: 'short' });
  assert.equal(dimensionCaption(d.edges[0], SEEDS), 'Blende montieren · 10,00 m');
  const { q, offer } = quote(d);
  assert.equal(q.groups.length, 1);
  assert.equal(q.groups[0].total, 10);
  assert.equal(q.groups[0].entries.length, 1);
  assert.match(q.groups[0].formula, /Blende/);
  assert.equal(fmtEUR(totals(offer).net), '680,00 EUR');
});

test('B zwei Linien derselben Leistung', () => {
  let d = lineDoc(10, { name: 'Blende', services: [{ catalogId: 'cat-seed-01' }] });
  d = addMeasured(d, 5, { name: 'Ortgang', services: [{ catalogId: 'cat-seed-01' }] });
  const { q, offer } = quote(d);
  assert.equal(q.groups.length, 1);
  assert.equal(q.groups[0].total, 15);
  assert.equal(q.groups[0].entries.length, 2);
  assert.match(q.groups[0].formula, /10,00 m/);
  assert.match(q.groups[0].formula, /5,00 m/);
  assert.equal(fmtEUR(totals(offer).net), '1.020,00 EUR');
});

test('C Maßänderung aktualisiert Menge, Preis und Hinweis', () => {
  let d = lineDoc(10, { name: 'Blende', services: [{ catalogId: 'cat-seed-01' }] });
  d = addMeasured(d, 5, { services: [{ catalogId: 'cat-seed-01' }] });
  const first = quote(d);
  const edge = d.edges.find((e) => e.measure.value === 5);
  d = setMeasure(d, edge.id, 6, 'm');
  const q = quantitiesFromDocs([{ id: 's1', title: 'Dach', doc: d }], SEEDS);
  const again = refreshOffer(first.offer, q.groups, SEEDS);
  assert.equal(q.groups[0].total, 16);
  assert.equal(fmtEUR(totals(again.offer).net), '1.088,00 EUR');
  assert.ok(again.changes.some((c) => /15,00 m/.test(c) && /16,00 m/.test(c)), again.changes.join(' | '));
});

test('D Fläche mit nachvollziehbarer Berechnung', () => {
  const d = faceDoc(10, 5, [{ catalogId: 'cat-seed-04' }], 'slope');
  const { q, offer } = quote(d);
  const g = q.groups.find((x) => x.catalogId === 'cat-seed-04');
  assert.equal(g.total, 50);
  assert.equal(g.unit, 'm²');
  assert.match(g.formula, /geneigte Dachfläche/);
  assert.match(g.formula, /50,00 m²/);
  assert.equal(fmtEUR(totals(offer).net), '1.600,00 EUR');
});

test('E Stückobjekte', () => {
  let d = emptyDoc();
  d = addPiece(d, 0.2, 0.3, 'Lüfter 1');
  d = addPiece(d, 0.6, 0.4, 'Lüfter 2');
  d = setPieceAssignment(d, d.pieces[0].id, { services: [{ catalogId: 'cat-seed-09' }] });
  d = setPieceAssignment(d, d.pieces[1].id, { services: [{ catalogId: 'cat-seed-09' }] });
  const { q, offer } = quote(d);
  assert.equal(q.groups[0].total, 2);
  assert.equal(q.groups[0].unit, 'Stück');
  assert.equal(q.groups[0].entries.length, 2);
  assert.equal(fmtEUR(totals(offer).net), '230,00 EUR');
});

test('F unpassende Einheit verlangt ein ergänzendes Maß', () => {
  const d = lineDoc(10, { services: [{ catalogId: 'cat-seed-04' }] });
  const q = quantitiesFromDocs([{ id: 's', title: 'Dach', doc: d }], SEEDS);
  assert.equal(q.groups.length, 0);
  assert.equal(q.gaps[0].reason, 'width');
  assert.ok(!q.groups.some((g) => g.total === 10));
  const withWidth = setEdgeAssignment(d, d.edges[0].id, { widthM: 0.2 });
  const q2 = quantitiesFromDocs([{ id: 's', title: 'Dach', doc: withWidth }], SEEDS);
  assert.equal(q2.groups[0].unit, 'm²');
  assert.equal(q2.groups[0].total, 2);
  assert.match(q2.groups[0].formula, /10,00 m × 0,20 m = 2,00 m²/);
});

test('G mehrere Leistungen, keine Verdoppelung innerhalb einer Leistung', () => {
  const d = faceDoc(10, 5, [{ catalogId: 'cat-seed-04' }, { catalogId: 'cat-seed-05' }, { catalogId: 'cat-seed-04' }]);
  const q = quantitiesFromDocs([{ id: 's', title: 'Dach', doc: d }], SEEDS);
  assert.equal(q.groups.length, 2);
  for (const g of q.groups) {
    assert.equal(g.total, 50);
    assert.equal(g.entries.length, 1);
  }
});

test('H Katalogänderung hält die Verknüpfung und schützt Entwürfe und Finales', () => {
  const d = lineDoc(10, { services: [{ catalogId: 'cat-seed-01' }] });
  const first = quote(d);
  const item = first.offer.items[0];
  assert.equal(item.catalogId, 'cat-seed-01');
  const renamed = SEEDS.map((c) => c.id === 'cat-seed-01' ? { ...c, short: 'Blende neu', price: 80, text: 'Neuer Text' } : c);
  const kept = refreshOffer(first.offer, quantitiesFromDocs([{ id: 's1', title: 'Dach', doc: d }], renamed).groups, renamed);
  assert.equal(kept.offer.items.length, 1);
  assert.equal(kept.offer.items[0].catalogId, 'cat-seed-01');
  assert.equal(kept.offer.items[0].price, 68);
  assert.match(kept.offer.items[0].text, /Aluminiumblech/);
  const adopted = adoptCatalog(kept.offer, item.id, renamed);
  assert.equal(adopted.items[0].price, 80);
  assert.equal(adopted.items[0].short, 'Blende neu');
  const custom = patchItem(adopted, item.id, { price: 70 });
  const after = refreshOffer(custom, quantitiesFromDocs([{ id: 's1', title: 'Dach', doc: d }], renamed).groups, renamed);
  assert.equal(after.offer.items[0].price, 70);
  const final = finalizeOffer(first.offer);
  const later = refreshOffer(final, quantitiesFromDocs([{ id: 's1', title: 'Dach', doc: addMeasured(d, 9, { services: [{ catalogId: 'cat-seed-01' }] }) }], renamed).groups, renamed);
  assert.equal(later.offer.snapshot.net, final.snapshot.net);
  assert.equal(later.offer.snapshot.items[0].price, 68);
  assert.equal(later.changes.length, 0);
  const edited = mergeSeed(SEEDS.map((c) => c.id === 'cat-seed-01' ? { ...c, price: 70 } : c));
  assert.equal(edited.length, 10);
  assert.equal(edited.find((c) => c.id === 'cat-seed-01').price, 70);
});

test('I erneutes Laden erzeugt die zehn Positionen nicht noch einmal', () => {
  const once = mergeSeed([]);
  assert.equal(once.length, 10);
  const changed = once.map((c) => c.id === 'cat-seed-03' ? { ...c, price: 61, text: 'geändert' } : c);
  const twice = mergeSeed(changed);
  assert.equal(twice.length, 10);
  assert.equal(twice.find((c) => c.id === 'cat-seed-03').price, 61);
  assert.equal(twice.find((c) => c.id === 'cat-seed-03').text, 'geändert');
  const d = lineDoc(10, { name: 'Blende', services: [{ catalogId: 'cat-seed-01' }], labelMode: 'part' });
  const a = quantitiesFromDocs([{ id: 's', title: 'Dach', doc: d }], twice);
  const b = quantitiesFromDocs([{ id: 's', title: 'Dach', doc: JSON.parse(JSON.stringify(d)) }], twice);
  assert.equal(b.groups[0].total, a.groups[0].total);
  assert.equal(dimensionCaption(d.edges[0], twice), 'Blende · 10,00 m');
});

test('J die Haupt-App bleibt auf v1.7.7', () => {
  const mainSw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const zweiSw = readFileSync(new URL('../zwei/sw.js', import.meta.url), 'utf8');
  const mainApp = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.match(mainSw, /baudoku-v1\.7\.7/);
  assert.doesNotMatch(mainSw, /v1\.8\.0/);
  assert.doesNotMatch(mainApp, /cat-seed-01/);
  assert.doesNotMatch(mainApp, /Leistungskatalog/);
  assert.match(zweiSw, /baudoku2-v1\.8\.0/);
  assert.doesNotMatch(zweiSw, /baudoku-v1\.7\.7/);
});

test('K finalisierter Stand bleibt, die Überarbeitung ist neu', () => {
  const d = lineDoc(10, { services: [{ catalogId: 'cat-seed-01' }] });
  const final = finalizeOffer(quote(d).offer);
  const more = addMeasured(d, 5, { services: [{ catalogId: 'cat-seed-01' }] });
  const catalog = SEEDS.map((c) => c.id === 'cat-seed-01' ? { ...c, price: 99 } : c);
  const stuck = refreshOffer(final, quantitiesFromDocs([{ id: 's1', title: 'Dach', doc: more }], catalog).groups, catalog);
  assert.equal(stuck.offer.snapshot.net, 680);
  assert.equal(stuck.offer.snapshot.items[0].qty, 10);
  assert.equal(stuck.changes.length, 0);
  const rev = reviseOffer(final);
  assert.equal(rev.status, 'draft');
  assert.equal(rev.snapshot, null);
  assert.notEqual(rev.id, final.id);
  assert.equal(final.status, 'final');
  const moved = refreshOffer(rev, quantitiesFromDocs([{ id: 's1', title: 'Dach', doc: more }], catalog).groups, catalog);
  assert.equal(moved.offer.items[0].linkedQty, 15);
  assert.equal(moved.offer.items[0].price, 68);
  assert.equal(moved.offer.items[0].catalogId, final.snapshot.items[0].catalogId);
  const shifted = moveItem(moved.offer, moved.offer.items[0].id, 0);
  assert.equal(shifted.items[0].catalogId, 'cat-seed-01');
});

test('L Nettosumme, 19 Prozent und Brutto', () => {
  const d = lineDoc(15, { services: [{ catalogId: 'cat-seed-01' }] });
  const face = faceDoc(10, 5, [{ catalogId: 'cat-seed-04' }]);
  let pieces = emptyDoc();
  pieces = addPiece(pieces, 0.2, 0.2, 'Lüfter 1');
  pieces = addPiece(pieces, 0.4, 0.2, 'Lüfter 2');
  pieces = setPieceAssignment(pieces, pieces.pieces[0].id, { services: [{ catalogId: 'cat-seed-09' }] });
  pieces = setPieceAssignment(pieces, pieces.pieces[1].id, { services: [{ catalogId: 'cat-seed-09' }] });
  const q = quantitiesFromDocs([
    { id: 'l', title: 'Linien', doc: d },
    { id: 'f', title: 'Fläche', doc: face },
    { id: 'p', title: 'Stück', doc: pieces },
  ], SEEDS);
  const offer = includeSuggested(refreshOffer(blankOffer('p'), q.groups, SEEDS).offer);
  const sum = totals(offer);
  assert.equal(fmtEUR(sum.net), '2.850,00 EUR');
  assert.equal(sum.rate, 19);
  assert.equal(fmtEUR(sum.vat), '541,50 EUR');
  assert.equal(fmtEUR(sum.gross), '3.391,50 EUR');
  const manual = setManualQty(offer, offer.items[0].id, 1);
  assert.notEqual(effectiveQty(manual.items[0]), manual.items[0].linkedQty);
  assert.ok(uncheckedTestPrices(offer).length >= 3);
});

test('bestehende manuelle Aufmaßzeilen bleiben, gleiche Leistung wird nicht doppelt angelegt', () => {
  const d = lineDoc(10, { services: [{ catalogId: 'cat-seed-01' }] });
  const q = quantitiesFromDocs([{ id: 's', title: 'Dach', doc: d }], SEEDS);
  const manual = [{ id: 'old', bez: 'Seite A', menge: 3, einheit: 'm', pos: '01' }];
  const once = syncServiceRows(manual, q.groups);
  const twice = syncServiceRows(once, q.groups);
  assert.equal(twice.filter((r) => r.catalogId === 'cat-seed-01').length, 1);
  assert.equal(twice.find((r) => r.id === 'old').menge, 3);
  const none = syncServiceRows(twice, []);
  assert.equal(none.find((r) => r.catalogId === 'cat-seed-01').entfallen, true);
  assert.equal(none.find((r) => r.catalogId === 'cat-seed-01').menge, 0);
  assert.equal(none.find((r) => r.id === 'old').menge, 3);
});
