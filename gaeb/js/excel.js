// Liest und schreibt das Blatt „GAEB-Export“. Regeln wie in xlsx_to_gaeb.py.
import { excelTrim, kurztextAus, pruefeLv } from './gaeb.js';

function textAus(v) {
  if (v && typeof v === 'object' && Array.isArray(v.richText)) return v.richText.map((t) => t.t || '').join('');
  return v;
}

function s(v) {
  v = textAus(v);
  if (v == null) return '';
  if (typeof v === 'number' && Number.isFinite(v)) {
    if (Object.is(v, -0)) return '0';
    if (Number.isInteger(v)) return String(v);
    return String(v);
  }
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const p = (n) => String(n).padStart(2, '0');
    return `${p(v.getDate())}.${p(v.getMonth() + 1)}.${v.getFullYear()}`;
  }
  return String(v).trim();
}

function zahl(v) {
  if (typeof v === 'boolean' || v == null || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) {
    if (Object.is(v, -0)) return '0';
    return String(v);
  }
  return null;
}

function nichtPositiv(raw) {
  const t = String(raw);
  const neg = t.startsWith('-');
  const digits = t.replace('-', '').replace('.', '').replace(/^0+/, '');
  if (!digits) return true;
  return neg;
}

function zelle(ws, XLSX, r, c) {
  if (!ws) return null;
  return ws[XLSX.utils.encode_cell({ r: r - 1, c: c - 1 })] || null;
}

function wert(cell, fehlend) {
  if (!cell) return null;
  const formel = cell.f != null && String(cell.f) !== '';
  const hat = cell.v !== undefined && cell.v !== null;
  if (formel && !hat) {
    fehlend.push(String(cell.f));
    return null;
  }
  return textAus(cell.v ?? null);
}

function maxZeile(ws, XLSX) {
  if (!ws || !ws['!ref']) return 0;
  return XLSX.utils.decode_range(ws['!ref']).e.r + 1;
}

function projektdaten(wb, XLSX, fehlend) {
  const ws = wb.Sheets.Projektdaten;
  const werte = {};
  if (ws) {
    for (let r = 1; r <= maxZeile(ws, XLSX); r++) {
      const label = s(wert(zelle(ws, XLSX, r, 1), fehlend));
      if (label && !(label in werte)) werte[label] = wert(zelle(ws, XLSX, r, 2), fehlend);
    }
  }
  const get = (label) => {
    const v = werte[label];
    return v instanceof Date ? v : s(v);
  };
  return {
    bauvorhaben: get('Bauvorhaben'),
    kunde: get('Kunde (Name / Firma)'),
    angebotsnummer: get('Angebotsnummer'),
    angebotsdatum: get('Angebotsdatum'),
  };
}

function tabellen(ws, XLSX, fehlend) {
  const einh = {};
  const titel = {};
  for (let r = 2; r <= 40; r++) {
    const o = s(wert(zelle(ws, XLSX, r, 15), fehlend));
    if (o && !(o in einh)) einh[o] = s(wert(zelle(ws, XLSX, r, 16), fehlend));
  }
  for (let r = 2; r <= 12; r++) {
    const g = s(wert(zelle(ws, XLSX, r, 18), fehlend));
    if (g && !(g in titel)) titel[g] = s(wert(zelle(ws, XLSX, r, 19), fehlend));
  }
  return { einh, titel };
}

function gaebEinheit(roh, einh) {
  const t = (roh || '').trim();
  if (!t) return { einheit: '', unbekannt: false };
  if (Object.prototype.hasOwnProperty.call(einh, t) && einh[t]) return { einheit: einh[t], unbekannt: false };
  if (Object.prototype.hasOwnProperty.call(einh, t)) return { einheit: t, unbekannt: false };
  return { einheit: t, unbekannt: true };
}

function lvAusExport(wb, XLSX, hinweise, fehlend, fehler) {
  const ws = wb.Sheets['GAEB-Export'];
  const kalk = wb.Sheets.Kalkulation;
  const gruppen = [];
  let akt = null;
  for (let r = 2; r <= maxZeile(ws, XLSX); r++) {
    const a = s(wert(zelle(ws, XLSX, r, 1), fehlend));
    const b = wert(zelle(ws, XLSX, r, 2), fehlend);
    const c = wert(zelle(ws, XLSX, r, 3), fehlend);
    const d = wert(zelle(ws, XLSX, r, 4), fehlend);
    const e = wert(zelle(ws, XLSX, r, 5), fehlend);
    const ep = wert(zelle(ws, XLSX, r, 6), fehlend);
    const gp = wert(zelle(ws, XLSX, r, 7), fehlend);
    const h = s(wert(zelle(ws, XLSX, r, 8), fehlend));
    const voll = s(wert(zelle(ws, XLSX, r, 14), fehlend));
    if (!a) continue;
    if (h === 'Abschnitt') {
      akt = { oz: a, titel: s(b), positionen: [] };
      gruppen.push(akt);
      continue;
    }
    if (!akt || !a.startsWith(`${akt.oz}.`)) {
      fehler.push(`GAEB-Export Zeile ${r}: Position ${a} steht nicht unter ihrer Gruppe.`);
    }
    const m = zahl(d);
    if (d != null && d !== '' && m == null) hinweise.push(`${a}: Menge „${d}“ ist keine Zahl – ohne Menge übernommen.`);
    const kz = kalk ? wert(zelle(ws, XLSX, r, 12), fehlend) : null;
    const kalkNr = kalk && typeof kz === 'number' ? s(wert(zelle(kalk, XLSX, Math.trunc(kz), 1), fehlend)) : '';
    let kurz = s(b);
    const lang = typeof c === 'string' ? c.trim() : s(c);
    const zuLang = kurz.length > 70 || (voll && excelTrim(voll).length > kurz.length);
    if (kurz.length > 70) kurz = kurztextAus(kurz);
    const pos = {
      kalkNr, oz: a, kurztext: kurz, langtext: lang, menge: m, einheit: s(e),
      bedarf: h === 'Bedarf (nur EP)', ep: zahl(ep), gp: zahl(gp), herkunft: `GAEB-Export Zeile ${r}`,
    };
    if (zuLang) pos.gekuerzt = true;
    if (akt) akt.positionen.push(pos);
    else {
      akt = { oz: a.slice(0, 2), titel: '', positionen: [pos] };
      gruppen.push(akt);
    }
  }
  return gruppen;
}

function lvAusKalkulation(wb, XLSX, hinweise, fehlend) {
  const k = wb.Sheets.Kalkulation;
  const exportBlatt = wb.Sheets['GAEB-Export'];
  const { einh, titel } = tabellen(exportBlatt, XLSX, fehlend);
  const gruppen = [];
  const nachName = new Map();
  const genutzt = new Map();
  if (!k) return { lv: [], einheiten: [] };
  for (let r = 5; r <= maxZeile(k, XLSX); r++) {
    const a = s(wert(zelle(k, XLSX, r, 1), fehlend));
    if (!a || !a.includes('.')) continue;
    const y = s(wert(zelle(k, XLSX, r, 25), fehlend));
    if (!nachName.has(y)) {
      const tt = y.slice(0, 2);
      const oz = Object.prototype.hasOwnProperty.call(titel, tt) ? titel[tt] : tt;
      const g = { oz, titel: excelTrim(y.slice(3, 103)), positionen: [] };
      nachName.set(y, g);
      gruppen.push(g);
    }
    const g = nachName.get(y);
    let b = wert(zelle(k, XLSX, r, 2), fehlend) ?? '';
    b = typeof b === 'string' ? b : s(b);
    const epJa = s(wert(zelle(k, XLSX, r, 23), fehlend)) === 'Ja' && s(wert(zelle(k, XLSX, r, 24), fehlend)) !== '';
    const d = wert(zelle(k, XLSX, r, 4), fehlend);
    let m = epJa ? null : zahl(d);
    if (d != null && d !== '' && zahl(d) == null) hinweise.push(`${a}: Menge „${d}“ (Aufmaß nicht auswertbar) – ohne Menge übernommen.`);
    if (m != null && nichtPositiv(m)) m = null;
    const av = s(wert(zelle(k, XLSX, r, 48), fehlend));
    let lang = b.trim();
    if (epJa) lang = `Einheitspreis ohne Gesamtbetrag (nur EP).\n${lang}`;
    if (av) lang += `\n${av}`;
    const rohE = s(wert(zelle(k, XLSX, r, 5), fehlend));
    const eh = gaebEinheit(rohE, einh);
    if (rohE) {
      const key = `${rohE}\0${eh.einheit}`;
      genutzt.set(key, (genutzt.get(key) || 0) + 1);
    }
    const bereinigt = excelTrim(b.replaceAll('\n', ' '));
    const kurz = kurztextAus(bereinigt);
    g.positionen.push({
      oz: null, kurztext: kurz, langtext: lang, menge: m, einheit: eh.einheit, bedarf: epJa,
      kalkNr: a, gekuerzt: kurz.length < bereinigt.length, unbekanntEinheit: eh.unbekannt, rohEinheit: rohE,
      herkunft: `Kalkulation Zeile ${r} (${a})`,
    });
  }
  for (const g of gruppen) {
    g.positionen.forEach((p, i) => { p.oz = `${g.oz}.${String((i + 1) * 10).padStart(4, '0')}`; });
  }
  const einheiten = [...genutzt.entries()].map(([key, n]) => {
    const [von, nach] = key.split('\0');
    return { von, nach, n };
  });
  return { lv: gruppen, einheiten };
}

function angebotAnzahl(wb, XLSX, fehlend) {
  const k = wb.Sheets.Kalkulation;
  if (!k) return 0;
  let n = 0;
  for (let r = 5; r <= maxZeile(k, XLSX); r++) {
    const v = wert(zelle(k, XLSX, r, 27), fehlend);
    if (typeof v === 'number') n += 1;
  }
  return n;
}

function sammle(lv, hinweise, einheiten) {
  const positionen = lv.flatMap((g) => g.positionen);
  const leer = positionen.filter((p) => p.menge == null);
  if (leer.length === 1) hinweise.push(`${leer[0].oz}: leere Menge.`);
  else if (leer.length) hinweise.push(`${leer.length} Positionen ohne Menge (z. B. ${leer.slice(0, 5).map((p) => p.oz).join(', ')}).`);
  const gek = positionen.filter((p) => p.gekuerzt);
  if (gek.length === 1) hinweise.push(`${gek[0].oz}: Kurztext zu lang und gekürzt.`);
  else if (gek.length) hinweise.push(`${gek.length} Kurztexte zu lang und gekürzt (z. B. ${gek.slice(0, 5).map((p) => p.oz).join(', ')}).`);
  const unb = positionen.filter((p) => p.unbekanntEinheit);
  const unbArten = [...new Set(unb.map((p) => p.rohEinheit))];
  if (unbArten.length) hinweise.push(`Unbekannte Einheit, Original übernommen: ${unbArten.join(', ')}.`);
  const ohneE = positionen.filter((p) => !p.einheit);
  if (ohneE.length) hinweise.push(`${ohneE.length} Positionen ohne Einheit.`);
  const langE = [...new Set(positionen.filter((p) => (p.einheit || '').length > 4).map((p) => p.einheit))];
  if (langE.length) hinweise.push(`Einheit länger als 4 Zeichen, in der D83 leer: ${langE.join(', ')}.`);
  const summe = positionen.reduce((s0, p) => s0 + (p.gp != null ? Number(p.gp) : 0), 0);
  const hatGp = positionen.some((p) => p.gp != null);
  return { einheiten, summe: hatGp ? summe : null };
}

export function leseMappe(XLSX, data, optionen = {}) {
  const wb = XLSX.read(data, { type: 'array', cellDates: true, cellFormula: true });
  const hinweise = [];
  const fehlend = [];
  const fehler = [];
  if (!wb.Sheets['GAEB-Export']) fehler.push('Blatt „GAEB-Export“ fehlt.');
  const quelleWahl = optionen.quelle || 'auto';
  const lvExport = wb.Sheets['GAEB-Export'] ? lvAusExport(wb, XLSX, quelleWahl === 'alle' ? [] : hinweise, fehlend, fehler) : [];
  const nExport = lvExport.reduce((s0, g) => s0 + g.positionen.length, 0);
  let quelle = quelleWahl;
  if (quelle === 'auto') quelle = nExport ? 'export' : 'alle';
  let lv = [];
  let einheiten = [];
  if (quelle === 'export') {
    if (!nExport) fehler.push('Blatt GAEB-Export ist leer (keine Position). Quelle „alle Positionen“ liest die Kalkulation.');
    const soll = wb.Sheets.Kalkulation ? angebotAnzahl(wb, XLSX, fehlend) : nExport;
    if (nExport && soll !== nExport) {
      fehler.push(`GAEB-Export enthält ${nExport} Positionen, die Kalkulation aber ${soll} Angebotszeilen (das Angebot fasst max. 300).`);
    }
    lv = lvExport;
  } else {
    const gelesen = lvAusKalkulation(wb, XLSX, hinweise, fehlend);
    lv = gelesen.lv;
    einheiten = gelesen.einheiten;
  }
  if (fehlend.length) {
    hinweise.unshift(`Formeln ohne gespeicherten Wert (${fehlend.length}). Mappe einmal in Excel öffnen und speichern.`);
  }
  fehler.push(...pruefeLv(lv));
  const extra = sammle(lv, hinweise, einheiten);
  return {
    lv, fehler, hinweise, quelle, einheiten: extra.einheiten, summe: extra.summe,
    projektdaten: projektdaten(wb, XLSX, []),
  };
}

export function schreibeXlsx(XLSX, lv) {
  const rows = [['OZ', 'Kurztext', 'Langtext', 'Menge', 'Einheit', 'EP', 'GP', 'Positionsart', 'Status Export']];
  for (const g of lv) {
    rows.push([g.oz, g.titel || '', '', '', '', '', '', 'Abschnitt', '']);
    for (const p of g.positionen) {
      let menge = '';
      if (p.menge != null && p.menge !== '') {
        const n = Number(String(p.menge).replace(',', '.'));
        menge = Number.isFinite(n) ? n : String(p.menge);
      }
      rows.push([
        p.oz, p.kurztext || '', p.langtext || '', menge, p.einheit || '',
        p.ep != null ? Number(p.ep) : '', p.gp != null ? Number(p.gp) : '',
        p.bedarf ? 'Bedarf (nur EP)' : 'Normal', '',
      ]);
    }
  }
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [12, 42, 64, 12, 14, 12, 12, 20, 16].map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'GAEB-Export');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
}
