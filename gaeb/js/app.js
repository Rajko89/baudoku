import { leseMappe, schreibeXlsx } from './excel.js';
import {
  schreibeD83, schreibeP83, liesD83, liesP83, vergleiche, zeichensatzFuer, zusammenfassung,
} from './gaeb.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(key) { try { return localStorage.getItem(key) || ''; } catch { return ''; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* privates Fenster */ } },
};

function teile(date) {
  return { y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate(), h: date.getHours(), min: date.getMinutes() };
}

function euro(n) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n);
}

function basisname(name) {
  const roh = String(name || 'gaeb').replace(/\.[^.]+$/, '');
  const sauber = roh.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '');
  return sauber || 'gaeb';
}

function dateiLesen(file) {
  return file.arrayBuffer().then((buf) => new Uint8Array(buf));
}

function zeichenHinweis(zeichen, datei) {
  return Object.entries(zeichen).map(([key, wo]) => {
    const [ch, r] = key.split('\0');
    return `${datei}: Zeichen „${ch || '?'}“ fehlt im Zeichensatz und wurde zu „${r}“ (${wo.length}×, z. B. ${wo[0]}).`;
  });
}

function kopfBauen(pd) {
  const jetzt = teile(new Date());
  const datum = pd && pd.angebotsdatum instanceof Date ? teile(pd.angebotsdatum) : jetzt;
  const feld = (id, sonst) => {
    const v = $(id).value.trim();
    return v || (typeof sonst === 'string' ? sonst : '');
  };
  return {
    lvBez: feld('lv-bez', pd && pd.bauvorhaben),
    projekt: feld('projekt', pd && pd.bauvorhaben),
    auftraggeber: feld('ag', pd && pd.kunde),
    datum, jetzt,
    progSystem: 'GAEB-Umwandler',
    progName: 'GAEB-Umwandler',
  };
}

function zeile(tag, text, klasse) {
  const el = document.createElement(tag);
  if (klasse) el.className = klasse;
  el.textContent = text;
  return el;
}

function tabelle(lv) {
  const wrap = document.createElement('div');
  const table = document.createElement('table');
  const head = document.createElement('tr');
  for (const [text, num] of [['OZ', false], ['Text', false], ['Menge', true], ['Einheit', false], ['Art', false]]) {
    const th = zeile('th', text);
    if (num) th.className = 'num';
    head.append(th);
  }
  table.append(head);
  const zeilen = [];
  for (const g of lv) {
    zeilen.push({ oz: g.oz, text: g.titel || '', menge: '', einheit: '', art: 'Titel' });
    for (const p of g.positionen) {
      zeilen.push({
        oz: p.oz, text: p.kurztext || '', menge: p.menge == null ? '' : String(p.menge).replace('.', ','),
        einheit: p.einheit || '', art: p.bedarf ? 'Bedarf' : 'Position',
      });
    }
  }
  for (const z of zeilen.slice(0, 12)) {
    const tr = document.createElement('tr');
    tr.append(zeile('td', z.oz), zeile('td', z.text));
    const menge = zeile('td', z.menge);
    menge.className = 'num';
    tr.append(menge, zeile('td', z.einheit), zeile('td', z.art));
    table.append(tr);
  }
  wrap.append(table);
  if (zeilen.length > 12) wrap.append(zeile('p', `Weitere ${zeilen.length - 12} Zeilen stehen in der Datei.`, 'hint'));
  return wrap;
}

function downloadKnopf(bytes, name, mime, label) {
  const a = document.createElement('a');
  const blob = new Blob([bytes], { type: mime });
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.textContent = label;
  return a;
}

function zeichne(titel, lv, extra) {
  const box = $('preview');
  box.hidden = false;
  box.replaceChildren();
  box.append(zeile('h2', titel));
  const info = zusammenfassung(lv, []);
  const stats = document.createElement('div');
  stats.className = 'stats';
  stats.append(
    zeile('span', `${info.titel} Titel`),
    zeile('span', `${info.positionen} Positionen`),
    zeile('span', `${info.bedarf} Bedarf`),
    zeile('span', `${info.mitMenge} mit Menge`),
  );
  if (extra.summe != null) stats.append(zeile('span', `Summe GP ${euro(extra.summe)}`));
  box.append(stats);
  if (extra.verwendet) box.append(zeile('p', extra.verwendet, 'hint'));
  for (const e of extra.einheiten || []) {
    box.append(zeile('p', `Einheit umgeschlüsselt: ${e.von} → ${e.nach || 'leer'} (${e.n}×)`, 'hint'));
  }
  for (const f of extra.fehler || []) box.append(zeile('p', f, 'bad'));
  for (const h of extra.hinweise || []) box.append(zeile('p', h, 'warn'));
  if (extra.ok) box.append(zeile('p', extra.ok, 'ok'));
  for (const r of extra.reparse || []) box.append(zeile('p', r, 'bad'));
  const downloadsZeigen = extra.downloads && extra.downloads.length && (extra.downloadImmer || !(extra.fehler || []).length);
  if (downloadsZeigen) {
    const row = document.createElement('div');
    row.className = 'downloads';
    row.id = 'downloads';
    for (const d of extra.downloads) row.append(downloadKnopf(d.bytes, d.name, d.mime, d.label));
    box.append(row);
  }
  if (lv.length) box.append(tabelle(lv));
  box.scrollIntoView({ block: 'nearest' });
}

function optionen() {
  return {
    quelle: document.querySelector('input[name="quelle"]:checked').value,
    leere: document.querySelector('input[name="leere"]:checked').value,
    ascii: $('ascii').checked,
    ansi: $('ansi').checked,
  };
}

function speichern() {
  store.set('gaeb-lv', $('lv-bez').value);
  store.set('gaeb-projekt', $('projekt').value);
  store.set('gaeb-ag', $('ag').value);
  store.set('gaeb-quelle', optionen().quelle);
  store.set('gaeb-leere', optionen().leere);
  store.set('gaeb-ascii', optionen().ascii ? '1' : '0');
  store.set('gaeb-ansi', optionen().ansi ? '1' : '0');
}

function laden() {
  $('lv-bez').value = store.get('gaeb-lv');
  $('projekt').value = store.get('gaeb-projekt');
  $('ag').value = store.get('gaeb-ag');
  const quelle = store.get('gaeb-quelle');
  if (quelle) document.querySelector(`input[name="quelle"][value="${quelle}"]`).checked = true;
  const leere = store.get('gaeb-leere');
  if (leere) document.querySelector(`input[name="leere"][value="${leere}"]`).checked = true;
  if (store.get('gaeb-ascii') === '0') $('ascii').checked = false;
  if (store.get('gaeb-ansi') === '1') $('ansi').checked = true;
}

let excelDatei = null;
let gaebDatei = null;

function ablegen(zone, input, datei) {
  zone.classList.add('over');
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('over');
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    const dt = new DataTransfer();
    dt.items.add(f);
    input.files = dt.files;
    input.dispatchEvent(new Event('change'));
  });
}

$('tab-excel').addEventListener('click', () => waehle('excel'));
$('tab-gaeb').addEventListener('click', () => waehle('gaeb'));

function waehle(welche) {
  const excel = welche === 'excel';
  $('panel-excel').hidden = !excel;
  $('panel-gaeb').hidden = excel;
  $('tab-excel').classList.toggle('on', excel);
  $('tab-gaeb').classList.toggle('on', !excel);
  $('tab-excel').setAttribute('aria-selected', String(excel));
  $('tab-gaeb').setAttribute('aria-selected', String(!excel));
  $('preview').hidden = true;
}

$('excel-file').addEventListener('change', () => {
  excelDatei = $('excel-file').files[0] || null;
  $('excel-name').textContent = excelDatei ? excelDatei.name : 'Noch keine Datei';
});
$('gaeb-file').addEventListener('change', () => {
  gaebDatei = $('gaeb-file').files[0] || null;
  $('gaeb-name').textContent = gaebDatei ? gaebDatei.name : 'Noch keine Datei';
});
for (const id of ['lv-bez', 'projekt', 'ag', 'ascii', 'ansi']) $(id).addEventListener('change', speichern);
for (const el of document.querySelectorAll('input[name="quelle"], input[name="leere"]')) el.addEventListener('change', speichern);

$('excel-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!excelDatei) { zeichne('Keine Datei', [], { fehler: ['Bitte eine Excel-Mappe auswählen.'] }); return; }
  if (!globalThis.XLSX) { zeichne('Lesefehler', [], { fehler: ['Die Excel-Bibliothek ist nicht geladen.'] }); return; }
  speichern();
  const opt = optionen();
  const bytes = await dateiLesen(excelDatei);
  let gelesen;
  try { gelesen = leseMappe(XLSX, bytes, { quelle: opt.quelle }); }
  catch (err) { zeichne('Lesefehler', [], { fehler: [String(err.message || err)] }); return; }
  const pd = gelesen.projektdaten || {};
  const kopf = kopfBauen(pd);
  const name = basisname(excelDatei.name);
  const extra = {
    fehler: gelesen.fehler,
    hinweise: [...gelesen.hinweise],
    einheiten: (gelesen.einheiten || []).filter((x) => x.von !== x.nach),
    summe: gelesen.summe,
    verwendet: `Verwendet: LV „${kopf.lvBez || '—'}“, Projekt „${kopf.projekt || '—'}“, Auftraggeber „${kopf.auftraggeber || '—'}“, Quelle ${gelesen.quelle === 'alle' ? 'Kalkulation' : 'GAEB-Export'}.`,
    downloads: [],
  };
  $('map-hint').textContent = pd.bauvorhaben || pd.kunde
    ? `In der Mappe: Bauvorhaben „${pd.bauvorhaben || '—'}“, Kunde „${pd.kunde || '—'}“.`
    : '';
  if (!gelesen.fehler.length && gelesen.lv.length) {
    const hin = [];
    const d83 = schreibeD83(gelesen.lv, kopf, 'cp850', opt.leere, opt.ascii, hin);
    const p83 = schreibeP83(gelesen.lv, kopf, opt.leere, hin);
    extra.hinweise.push(...hin, ...zeichenHinweis(d83.zeichen, 'D83'), ...zeichenHinweis(p83.zeichen, 'P83'));
    const zurueckD = liesD83(d83.bytes, 'cp850');
    const zurueckP = liesP83(p83.bytes);
    const reparse = [
      ...zurueckD.fehler.map((x) => `D83: ${x}`),
      ...zurueckP.fehler.map((x) => `P83: ${x}`),
      ...vergleiche(gelesen.lv, zurueckD.lv, 'D83', 'cp850', opt.leere, opt.ascii),
      ...vergleiche(gelesen.lv, zurueckP.lv, 'P83', 'cp1252', opt.leere, false),
    ];
    extra.reparse = reparse;
    extra.ok = reparse.length ? 'Rücklese-Prüfung: Fehler' : 'Rücklese-Prüfung: OK';
    extra.downloads.push(
      { bytes: d83.bytes, name: `${name}.D83`, mime: 'application/octet-stream', label: 'D83 herunterladen (Codepage 850)' },
      { bytes: p83.bytes, name: `${name}.P83`, mime: 'application/octet-stream', label: 'P83 herunterladen' },
    );
    if (opt.ansi) {
      const ansi = schreibeD83(gelesen.lv, kopf, 'cp1252', opt.leere, opt.ascii, []);
      extra.hinweise.push(...zeichenHinweis(ansi.zeichen, 'D83 ANSI'));
      extra.downloads.push({ bytes: ansi.bytes, name: `${name}_ANSI.D83`, mime: 'application/octet-stream', label: 'D83 herunterladen (ANSI)' });
    }
  }
  zeichne('Prüfansicht', gelesen.lv, extra);
});

$('gaeb-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!gaebDatei) { zeichne('Keine Datei', [], { fehler: ['Bitte eine GAEB-Datei auswählen.'] }); return; }
  if (!globalThis.XLSX) { zeichne('Lesefehler', [], { fehler: ['Die Excel-Bibliothek ist nicht geladen.'] }); return; }
  const bytes = await dateiLesen(gaebDatei);
  const art = zeichensatzFuer(bytes);
  const name = basisname(gaebDatei.name);
  let gelesen;
  const hinweise = [];
  const leseOpt = { phasen: ['81', '83', '84'], tolerant: true };
  if (art.art === 'P') gelesen = liesP83(bytes, leseOpt);
  else {
    gelesen = liesD83(bytes, art.codec, leseOpt);
    hinweise.push(`Zeichensatz: ${art.codec === 'cp850' ? 'Codepage 850' : 'Windows-1252'}.`);
  }
  hinweise.push(...(gelesen.hinweise || []));
  if (gelesen.phase && gelesen.phase !== '83') hinweise.push(`Phase ${gelesen.phase}: gelesen mit dem Satzbild der Phase 83.`);
  const xlsx = schreibeXlsx(XLSX, gelesen.lv);
  const nochmal = leseMappe(XLSX, xlsx, { quelle: 'export' });
  const reparse = nochmal.fehler.filter((x) => !x.startsWith('GAEB-Export enthält'));
  zeichne('GAEB nach Excel', gelesen.lv, {
    fehler: gelesen.fehler,
    hinweise,
    summe: nochmal.summe,
    reparse,
    ok: gelesen.fehler.length || reparse.length ? 'Prüfung: bitte die Meldungen lesen' : 'Prüfung: OK',
    downloadImmer: true,
    downloads: gelesen.lv.length ? [{
      bytes: xlsx, name: `${name}.xlsx`,
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      label: 'Excel herunterladen',
    }] : [],
  });
});

ablegen($('excel-drop'), $('excel-file'));
ablegen($('gaeb-drop'), $('gaeb-file'));
laden();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {});
}
