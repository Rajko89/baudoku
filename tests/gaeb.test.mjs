import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { leseMappe, schreibeXlsx } from '../gaeb/js/excel.js';
import {
  schreibeD83, schreibeP83,   liesD83, liesP83, vergleiche, zeichensatzFuer, kurztextAus, pruefeLv,
} from '../gaeb/js/gaeb.js';

const root = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(root, '../gaeb/js/gaeb.js'));
const XLSX = require(join(root, '../gaeb/vendor/xlsx.full.min.js'));
const fixture = JSON.parse(readFileSync(join(root, 'fixtures/gaeb-mini.json'), 'utf8'));
const kopf = {
  lvBez: fixture.lvBez, projekt: fixture.projekt, auftraggeber: fixture.auftraggeber,
  datum: { y: 2026, m: 11, d: 21, h: 9, min: 5 }, jetzt: { y: 2026, m: 11, d: 21, h: 9, min: 5 },
};

function gleich(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function mappe() {
  const exportRows = [[
    'OZ', 'Kurztext', 'Langtext', 'Menge', 'Einheit', 'EP', 'GP', 'Positionsart', 'Status Export',
    '', '', '', '', 'Hilfe Text bereinigt',
  ]];
  for (const g of fixture.gruppen) {
    exportRows.push([g.oz, g.titel, '', '', '', '', '', 'Abschnitt']);
    for (const p of g.positionen) {
      const kurz = p.oz === '01.0030' ? p.kurztext.slice(0, 70) : p.kurztext;
      exportRows.push([
        p.oz, kurz, p.langtext, p.menge == null ? '' : Number(p.menge), p.einheit,
        p.ep == null ? '' : Number(p.ep), p.gp == null ? '' : Number(p.gp),
        p.bedarf ? 'Bedarf (nur EP)' : 'Normal', '', '', '', '', '', p.kurztext,
      ]);
    }
  }
  const kalk = [[], [], [], []];
  const zeile = (nr, text, menge, einheit, ep, gruppe) => {
    const r = Array(48).fill('');
    r[0] = nr; r[1] = text; r[3] = menge; r[4] = einheit; r[22] = ep ? 'Ja' : ''; r[23] = ep || '';
    r[24] = gruppe; r[26] = 1;
    return r;
  };
  kalk.push(zeile('1.1', 'Dielung aus Nadelholz liefern und verlegen', 12.5, 'qm', '', '01 Zimmerarbeiten'));
  kalk.push(zeile('1.2', 'Zulage für eine Aussparung', 2, 'Stck', '3', '01 Zimmerarbeiten'));
  kalk.push(zeile('1.3', 'Eimerweise aufräumen und entsorgen', '', 'Eimer', '', '01 Zimmerarbeiten'));
  const wb = XLSX.utils.book_new();
  const exportBlatt = XLSX.utils.aoa_to_sheet(exportRows);
  exportBlatt.O2 = { t: 's', v: 'Stck' };
  exportBlatt.P2 = { t: 's', v: 'St' };
  exportBlatt.O3 = { t: 's', v: 'qm' };
  exportBlatt.P3 = { t: 's', v: 'm²' };
  exportBlatt.R2 = { t: 's', v: '01' };
  exportBlatt.S2 = { t: 's', v: '01' };
  exportBlatt['!ref'] = 'A1:S8';
  XLSX.utils.book_append_sheet(wb, exportBlatt, 'GAEB-Export');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(kalk), 'Kalkulation');
  const proj = XLSX.utils.aoa_to_sheet([
    ['Bauvorhaben', 'Hofstrasse 2'],
    ['Kunde (Name / Firma)', 'Amt Musterstadt'],
  ]);
  XLSX.utils.book_append_sheet(wb, proj, 'Projektdaten');
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
}

test('Kurztext wird am letzten Leerzeichen innerhalb von 71 Zeichen gekürzt', () => {
  const lang = `${'Wort '.repeat(20)}Ende`;
  const kurz = kurztextAus(lang);
  assert.ok(kurz.length <= 70);
  assert.equal(kurz.endsWith(' '), false);
  assert.ok(lang.startsWith(kurz));
});

test('Synthetische Mappe: Export, Bedarf, Rücklesen und Roundtrip', () => {
  const gelesen = leseMappe(XLSX, mappe(), { quelle: 'export' });
  assert.deepEqual(gelesen.fehler, []);
  assert.equal(gelesen.lv[0].positionen[1].bedarf, true);
  assert.equal(gelesen.lv[0].positionen[1].menge, null);
  assert.ok(gelesen.hinweise.some((h) => h.includes('ohne Menge')));
  assert.ok(gelesen.hinweise.some((h) => h.includes('gekürzt')));
  const d83 = schreibeD83(gelesen.lv, kopf, 'cp850', 'null', true, []);
  const p83 = schreibeP83(gelesen.lv, kopf, 'null', []);
  assert.equal(zeichensatzFuer(d83.bytes).codec, 'cp850');
  assert.equal(zeichensatzFuer(p83.bytes).art, 'P');
  const rd = liesD83(d83.bytes, 'cp850');
  const rp = liesP83(p83.bytes);
  assert.deepEqual(rd.fehler, []);
  assert.deepEqual(rp.fehler, []);
  assert.deepEqual(vergleiche(gelesen.lv, rd.lv, 'D83', 'cp850', 'null', true), []);
  assert.deepEqual(vergleiche(gelesen.lv, rp.lv, 'P83', 'cp1252', 'null', false), []);
  assert.equal(rd.lv[0].positionen[1].bedarf, true);
  assert.equal(rd.lv[0].positionen[1].einheit, 'St');
  for (const art of ['D83', 'P83']) {
    const erste = art === 'D83' ? d83 : p83;
    const parsed = art === 'D83' ? rd.lv : rp.lv;
    const xlsx = schreibeXlsx(XLSX, parsed);
    const wieder = leseMappe(XLSX, xlsx, { quelle: 'export' });
    assert.deepEqual(wieder.fehler, []);
    const zweite = art === 'D83'
      ? schreibeD83(wieder.lv, kopf, 'cp850', 'null', true, [])
      : schreibeP83(wieder.lv, kopf, 'null', []);
    assert.equal(gleich(erste.bytes, zweite.bytes), true, art);
  }
});

test('Quelle alle schlüsselt Einheiten um und setzt OZ', () => {
  const gelesen = leseMappe(XLSX, mappe(), { quelle: 'alle' });
  assert.deepEqual(gelesen.fehler, []);
  assert.equal(gelesen.lv[0].oz, '01');
  assert.deepEqual(gelesen.lv[0].positionen.map((p) => p.oz), ['01.0010', '01.0020', '01.0030']);
  assert.equal(gelesen.lv[0].positionen[0].einheit, 'm²');
  assert.equal(gelesen.lv[0].positionen[1].bedarf, true);
  assert.equal(gelesen.lv[0].positionen[1].menge, null);
  assert.equal(gelesen.lv[0].positionen[2].einheit, 'Eimer');
  assert.ok(gelesen.hinweise.some((h) => h.includes('Eimer')));
  assert.ok(gelesen.einheiten.some((e) => e.von === 'qm' && e.nach === 'm²'));
});

test('Doppelte OZ und Formel ohne Wert', () => {
  const doppelt = leseMappe(XLSX, mappe(), { quelle: 'export' });
  doppelt.lv[0].positionen.push({ ...doppelt.lv[0].positionen[0] });
  assert.ok(pruefeLv(doppelt.lv).some((f) => f.includes('doppelt')));
  const original = XLSX.read.bind(XLSX);
  XLSX.read = (data, opts) => {
    const wb = original(data, opts);
    wb.Sheets['GAEB-Export'].D3 = { t: 'n', f: 'D2*2' };
    return wb;
  };
  try {
    const ohne = leseMappe(XLSX, mappe(), { quelle: 'export' });
    assert.ok(ohne.hinweise.some((h) => h.includes('Mappe einmal in Excel öffnen und speichern')));
    assert.equal(ohne.lv[0].positionen[0].menge, null);
  } finally {
    XLSX.read = original;
  }
});

test('Phase 81 und 84 werden gelesen, der Schreiber bleibt bei 83', () => {
  const gelesen = leseMappe(XLSX, mappe(), { quelle: 'export' });
  const p83 = schreibeP83(gelesen.lv, kopf, 'null', []);
  const text = Buffer.from(p83.bytes).toString('latin1').replace('[DP]83[end]', '[DP]81[end]');
  const bytes = Uint8Array.from(Buffer.from(text, 'latin1'));
  assert.ok(liesP83(bytes).fehler.some((f) => f.includes('DP')));
  const locker = liesP83(bytes, { phasen: ['81', '83', '84'] });
  assert.equal(locker.phase, '81');
  assert.equal(locker.lv[0].positionen.length, 3);
  const d83 = schreibeD83(gelesen.lv, kopf, 'cp850', 'null', true, []);
  const roh = Buffer.from(d83.bytes);
  const stelle = roh.indexOf(Buffer.from('83L'));
  roh[stelle] = 0x38; roh[stelle + 1] = 0x34;
  assert.ok(liesD83(roh, 'cp850').fehler.length);
  const d84 = liesD83(roh, 'cp850', { phasen: ['81', '83', '84'] });
  assert.equal(d84.phase, '84');
  assert.equal(d84.fehler.length, 0);
});

function nurCrlf(bytes) {
  const rest = Buffer.from(bytes).toString('latin1').replaceAll('\r\n', '');
  assert.equal(rest.includes('\n') || rest.includes('\r'), false);
}

test('Mehrzeilige Langtexte mit Umlauten bleiben erhalten und die Datei hat nur CRLF', () => {
  const lang = 'Dämmung an der Straße liefern.\nFuge mit ß und Größe schließen.';
  const zeilen = [[
    'OZ', 'Kurztext', 'Langtext', 'Menge', 'Einheit', 'EP', 'GP', 'Positionsart',
  ], ['03', 'Ausbau', '', '', '', '', '', 'Abschnitt'], [
    '03.0010', 'Dämmung an der Straße', lang, 4.5, 'm²', 12, 54, 'Normal',
  ], [
    '03.0020', 'Hinweis\r\nmit Umbruch', 'nur Kurztext hat den Umbruch', 1, 'St', '', '', 'Normal',
  ]];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(zeilen), 'GAEB-Export');
  const datei = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
  const gelesen = leseMappe(XLSX, datei, { quelle: 'export' });
  assert.deepEqual(gelesen.fehler, []);
  assert.equal(gelesen.lv[0].positionen[0].langtext, lang);
  for (const art of ['D83', 'P83']) {
    const erste = art === 'D83'
      ? schreibeD83(gelesen.lv, kopf, 'cp850', 'null', true, [])
      : schreibeP83(gelesen.lv, kopf, 'null', []);
    nurCrlf(erste.bytes);
    const streng = art === 'D83' ? liesD83(erste.bytes, 'cp850') : liesP83(erste.bytes);
    assert.deepEqual(streng.fehler, [], art);
    assert.ok(streng.lv[0].positionen[0].langtext.includes('Dämmung'));
    assert.ok(streng.lv[0].positionen[0].langtext.includes('Straße'));
    assert.ok(streng.lv[0].positionen[0].langtext.includes('ß'));
    const xlsx = schreibeXlsx(XLSX, streng.lv);
    const wieder = leseMappe(XLSX, xlsx, { quelle: 'export' });
    assert.deepEqual(wieder.fehler, []);
    assert.match(wieder.lv[0].positionen[0].langtext, /Dämmung an der Straße liefern\.\nFuge/);
    const zweite = art === 'D83'
      ? schreibeD83(wieder.lv, kopf, 'cp850', 'null', true, [])
      : schreibeP83(wieder.lv, kopf, 'null', []);
    assert.equal(gleich(erste.bytes, zweite.bytes), true, art);
    const alsLf = Uint8Array.from(Buffer.from(Buffer.from(erste.bytes).toString('latin1').replaceAll('\r\n', '\n'), 'latin1'));
    const tolerant = art === 'D83'
      ? liesD83(alsLf, 'cp850', { tolerant: true })
      : liesP83(alsLf, { tolerant: true });
    assert.deepEqual(tolerant.fehler, [], `${art} LF`);
    assert.ok(tolerant.hinweise.some((h) => h.includes('LF')));
    assert.equal(tolerant.lv[0].positionen.length, 2);
  }
  const mitCr = schreibeP83([{
    oz: '03', titel: 'Ausbau', positionen: [{
      oz: '03.0010', kurztext: 'Dämmung', langtext: 'Größe\r\nund Straße', menge: '1', einheit: 'm²', bedarf: false,
    }],
  }], kopf, 'null', []);
  nurCrlf(mitCr.bytes);
  assert.deepEqual(liesP83(mitCr.bytes).fehler, []);
  assert.match(liesP83(mitCr.bytes).lv[0].positionen[0].langtext, /Größe\nund Straße/);
});

test('App nennt sich selbst und hat einen eigenen Cache', () => {
  const app = readFileSync(join(root, '../gaeb/js/app.js'), 'utf8');
  assert.match(app, /GAEB-Umwandler/);
  assert.doesNotMatch(app, /xlsx_to_gaeb/);
  assert.match(readFileSync(join(root, '../gaeb/sw.js'), 'utf8'), /gaeb-v1\.0\.1/);
  assert.equal(readdirSync(join(root, '../gaeb')).includes('index.html'), true);
});
