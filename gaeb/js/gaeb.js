// Port der Regeln aus xlsx_to_gaeb.py. Preise und Namen kommen nur aus der gelesenen Datei.
import { CP850, CP1252 } from './codec.js';

export const OZMASKE = '11PPPP000';
const ERSATZ = {
  '€': 'EUR', '–': '-', '—': '-', '„': '"', '“': '"', '”': '"', '‚': "'", '‘': "'", '’': "'",
  '\u00a0': ' ', '…': '...', '×': 'x', '\t': ' ', '\r': '',
};

export function excelTrim(t) {
  return String(t || '').replace(/^ +| +$/g, '').replace(/ +/g, ' ');
}

export function kurztextAus(text) {
  const n = text || '';
  if (n.length <= 70) return excelTrim(n);
  const l71 = n.slice(0, 71);
  const p = l71.lastIndexOf(' ');
  return excelTrim(p > 0 ? n.slice(0, p) : n.slice(0, 70));
}

function wrapChunks(text, width) {
  const chunks = text.split(/(\s+)/).filter((c) => c !== '');
  chunks.reverse();
  const lines = [];
  while (chunks.length) {
    const cur = [];
    let len = 0;
    if (lines.length && chunks[chunks.length - 1].trim() === '') chunks.pop();
    while (chunks.length) {
      const piece = chunks[chunks.length - 1];
      if (len + piece.length <= width) {
        cur.push(chunks.pop());
        len += piece.length;
      } else break;
    }
    if (chunks.length && chunks[chunks.length - 1].length > width) {
      const left = width - len;
      if (left >= 1) {
        cur.push(chunks[chunks.length - 1].slice(0, left));
        chunks[chunks.length - 1] = chunks[chunks.length - 1].slice(left);
        len += left;
      }
    }
    if (cur.length && cur[cur.length - 1].trim() === '') cur.pop();
    if (cur.length) lines.push(cur.join(''));
    else if (chunks.length && chunks[chunks.length - 1].length > width && width > 0) {
      cur.push(chunks[chunks.length - 1].slice(0, width));
      chunks[chunks.length - 1] = chunks[chunks.length - 1].slice(width);
      lines.push(cur.join(''));
    } else if (chunks.length) break;
  }
  return lines;
}

export function umbrechen(text, breite) {
  const zeilen = [];
  for (const absatz of String(text || '').split('\n')) {
    const a = excelTrim(absatz);
    if (!a) continue;
    zeilen.push(...wrapChunks(a, breite));
  }
  return zeilen;
}

function codecOf(name) {
  return name === 'cp1252' || name === 'ansi' ? CP1252 : CP850;
}

function canEncode(ch, table) {
  return table.encode[ch.codePointAt(0)] !== undefined;
}

export function kodierbar(text, codecName, meldungen, wo) {
  const table = codecOf(codecName);
  let aus = '';
  for (const ch of String(text || '')) {
    if (canEncode(ch, table)) aus += ch;
    else {
      const r = ERSATZ[ch] ?? '?';
      const key = ch + '\0' + r;
      if (meldungen) {
        if (!meldungen[key]) meldungen[key] = [];
        meldungen[key].push(wo);
      }
      aus += r;
    }
  }
  return aus;
}

function encodeText(text, codecName) {
  const table = codecOf(codecName);
  const bytes = [];
  for (const ch of text) {
    const b = table.encode[ch.codePointAt(0)];
    if (b === undefined) throw new Error('Zeichen nicht kodierbar: ' + ch);
    bytes.push(b);
  }
  return Uint8Array.from(bytes);
}

export function decodeBytes(bytes, codecName) {
  const table = codecOf(codecName);
  const list = table.decode;
  let out = '';
  for (const b of bytes) {
    const cp = Array.isArray(list) ? list[b] : list[b];
    out += cp === undefined ? '\uFFFD' : String.fromCodePoint(cp);
  }
  return out;
}

class Satz {
  constructor(za) {
    this.z = Array(74).fill(' ');
    this.setze(1, 2, za);
  }
  setze(von, bis, wert, rechts = false) {
    const laenge = bis - von + 1;
    const raw = String(wert ?? '');
    if (raw.length > laenge) throw new Error(`Feld ${von}-${bis} zu lang: „${raw}“`);
    const padded = rechts ? raw.padStart(laenge, ' ') : raw.padEnd(laenge, ' ');
    for (let i = 0; i < laenge; i++) this.z[von - 1 + i] = padded[i];
    return this;
  }
  zeile(nr) {
    return this.z.join('') + String(nr).padStart(6, '0');
  }
}

function oz9(oz) {
  const [tt, pppp] = String(oz).split('.');
  return (tt + (pppp || '')).padEnd(9, ' ');
}

export function parseDecimal(v) {
  if (typeof v === 'boolean' || v == null || v === '') return null;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null;
    if (Object.is(v, -0)) return '0';
    return String(v);
  }
  const t = String(v).trim().replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return t;
}

export function quantize3(raw) {
  let s = String(raw);
  let neg = false;
  if (s.startsWith('-')) { neg = true; s = s.slice(1); }
  const [ip, fp = ''] = s.split('.');
  const frac = (fp + '000000').slice(0, 6);
  let n = BigInt(ip || '0') * 1000n + BigInt(frac.slice(0, 3) || '0');
  if (frac[3] >= '5') n += 1n;
  const changed = (fp.replace(/0+$/, '') !== String(n % 1000n).padStart(3, '0').replace(/0+$/, '')) && fp.length > 3
    || (fp.length > 3 && frac.slice(3).replace(/0/g, '') !== '');
  const text = `${n / 1000n}.${String(n % 1000n).padStart(3, '0')}`;
  return { neg, scaled: neg ? -n : n, text: (neg ? '-' : '') + text, changed: fp.length > 3 && /[1-9]/.test(frac.slice(3)) };
}

function menge3(raw, wo, hinweise) {
  const q = quantize3(raw);
  if (q.changed) hinweise.push(`${wo}: Menge ${raw} auf 3 Nachkommastellen gerundet (${q.text}).`);
  return q;
}

function padDate(dt) {
  const p = (n) => String(n).padStart(2, '0');
  return {
    dmy2: `${p(dt.d)}.${p(dt.m)}.${String(dt.y).slice(-2)}`,
    dmy4: `${p(dt.d)}.${p(dt.m)}.${dt.y}`,
    hm: `${p(dt.h)}:${p(dt.min)}`,
  };
}

export function schreibeD83(lv, kopf, codecName, leereMenge, einheitAscii, hinweise) {
  const zeichen = {};
  const saetze = [];
  saetze.push(new Satz('00').setze(11, 12, '83').setze(13, 13, 'L').setze(63, 71, OZMASKE).setze(72, 73, '90'));
  const s01 = new Satz('01');
  s01.setze(3, 42, kodierbar(kopf.lvBez || '', codecName, zeichen, 'Satz 01').slice(0, 40));
  s01.setze(43, 50, padDate(kopf.datum).dmy2);
  saetze.push(s01);
  saetze.push(new Satz('02').setze(3, 62, kodierbar(kopf.projekt || '', codecName, zeichen, 'Satz 02').slice(0, 60)));
  saetze.push(new Satz('03').setze(3, 62, kodierbar(kopf.auftraggeber || '', codecName, zeichen, 'Satz 03').slice(0, 60)));
  saetze.push(new Satz('08').setze(3, 8, 'EUR').setze(9, 58, 'Euro'));
  let anz = 0;
  for (const g of lv) {
    saetze.push(new Satz('11').setze(3, 11, g.oz.padEnd(9, ' ')).setze(12, 12, 'N'));
    const titel = umbrechen(kodierbar(g.titel || '', codecName, zeichen, `Titel ${g.oz}`), 40).slice(0, 9);
    for (const t of titel.length ? titel : ['']) saetze.push(new Satz('12').setze(3, 42, t));
    for (const p of g.positionen) {
      anz += 1;
      const s21 = new Satz('21').setze(3, 11, oz9(p.oz)).setze(12, 12, 'N').setze(13, 13, p.bedarf ? 'E' : 'N');
      s21.setze(14, 14, 'N');
      if (p.menge != null) {
        const q = menge3(p.menge, p.oz, hinweise);
        if (q.neg) s21.setze(23, 23, '-');
        const n = q.scaled < 0n ? -q.scaled : q.scaled;
        if (n >= 10n ** 11n) throw new Error(`${p.oz}: Menge passt nicht in GAEB 90.`);
        s21.setze(24, 34, n.toString().padStart(11, '0'));
      } else if (leereMenge === 'null') s21.setze(24, 34, '0'.repeat(11));
      let e = p.einheit || '';
      if (einheitAscii) e = e.replaceAll('²', '2').replaceAll('³', '3');
      e = kodierbar(e, codecName, zeichen, `${p.oz} Einheit`);
      if (e.length > 4) { p._d83EinheitLeer = e; e = ''; }
      s21.setze(35, 38, e);
      saetze.push(s21);
      const kt = umbrechen(kodierbar(p.kurztext || '', codecName, zeichen, p.oz), 70).slice(0, 9);
      for (const t of kt.length ? kt : ['']) saetze.push(new Satz('25').setze(3, 72, t));
      const lt = umbrechen(kodierbar(p.langtext || '', codecName, zeichen, p.oz), 55);
      if (lt.length > 999) throw new Error(`${p.oz}: Langtext hat mehr als 999 Zeilen.`);
      const lang = lt.length ? lt : (kt.slice(0, 1).length ? kt.slice(0, 1) : ['']);
      for (const t of lang) saetze.push(new Satz('26').setze(6, 60, t));
    }
    saetze.push(new Satz('31').setze(3, 11, g.oz.padEnd(9, ' ')));
  }
  saetze.push(new Satz('99').setze(70, 74, String(anz).padStart(5, '0')));
  if (saetze.length > 999999) throw new Error('Mehr als 999.999 Sätze – GAEB 90 kann das nicht.');
  const text = saetze.map((sz, i) => sz.zeile(i + 1)).join('\r\n') + '\r\n';
  return { bytes: encodeText(text, codecName), zeichen, text };
}

function g2k(t) {
  return String(t ?? '').replaceAll('&', '&#38;').replaceAll('[', '&#91;').replaceAll(']', '&#93;');
}

function rtf(text) {
  const teile = [];
  for (const absatz of String(text || '').split('\n')) {
    const a = excelTrim(absatz);
    let o = '';
    for (const ch of a) {
      if ('\\{}'.includes(ch)) o += '\\' + ch;
      else if (ch.codePointAt(0) < 128) o += ch;
      else {
        const b = CP1252.encode[ch.codePointAt(0)];
        o += "\\'" + b.toString(16).padStart(2, '0');
      }
    }
    if (o) teile.push(o);
  }
  return '{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0\\fswiss\\fcharset0 Arial;}}\\f0\\fs20 ' + teile.join('\\par ') + '}';
}

export function schreibeP83(lv, kopf, leereMenge, hinweise = []) {
  const zeichen = {};
  const zeilen = [];
  let stufe = 0;
  const zaehl = { obj: 0, elem: 0 };
  const beg = (n) => { zeilen.push(' '.repeat(stufe) + `#begin[${n}]`); stufe += 1; zaehl.obj += 1; };
  const end = (n) => { stufe -= 1; zeilen.push(' '.repeat(stufe) + `#end[${n}]`); };
  const el = (n, w) => { zeilen.push(' '.repeat(stufe) + `[${n}]${g2k(w)}[end]`); zaehl.elem += 1; };
  const dt = padDate(kopf.jetzt);
  const datum = padDate(kopf.datum);
  beg('GAEB');
  beg('GAEBInfo');
  el('Version', '1.2'); el('VersMon', '3'); el('VersJahr', '2002');
  el('Datum', dt.dmy4); el('Uhrzeit', dt.hm);
  el('ProgSystem', kopf.progSystem || 'GAEB-Umwandler');
  el('ProgName', kopf.progName || 'GAEB-Umwandler');
  el('Zeichensatz', 'ANSI');
  end('GAEBInfo');
  if (kopf.projekt) {
    beg('PrjInfo'); el('Bez', kodierbar(kopf.projekt, 'cp1252', zeichen, 'PrjInfo')); end('PrjInfo');
  }
  beg('Vergabe');
  el('DP', '83');
  beg('VergabeInfo'); el('Wae', 'EUR'); el('WaeBez', 'Euro'); end('VergabeInfo');
  beg('AG');
  if (kopf.auftraggeber) {
    beg('Adresse'); el('Name1', kodierbar(kopf.auftraggeber, 'cp1252', zeichen, 'AG')); end('Adresse');
  }
  end('AG');
  beg('LV');
  beg('LVInfo');
  el('Name', kodierbar(kopf.lvBez || '', 'cp1252', zeichen, 'LVInfo'));
  el('Bez', kodierbar(kopf.lvBez || '', 'cp1252', zeichen, 'LVInfo'));
  el('Datum', datum.dmy4);
  el('KurzLang', '1');
  beg('LVGlied'); el('Typ', 'LVStufe'); el('Bez', 'Titel'); el('Laenge', '2'); end('LVGlied');
  beg('LVGlied'); el('Typ', 'Position'); el('Bez', 'Position'); el('Laenge', '4'); end('LVGlied');
  end('LVInfo');
  for (const g of lv) {
    beg('LVBereich');
    el('OZ', g.oz);
    el('Bez', kodierbar(excelTrim(g.titel || ''), 'cp1252', zeichen, `Titel ${g.oz}`));
    for (const p of g.positionen) {
      beg('Position');
      el('OZ', p.oz.replace('.', ''));
      if (p.menge != null) {
        const q = menge3(p.menge, p.oz, hinweise);
        el('Menge', q.text.replace('.', ','));
      } else if (leereMenge === 'null') el('Menge', '0,000');
      el('ME', kodierbar(p.einheit || '', 'cp1252', zeichen, `${p.oz} Einheit`));
      beg('Beschreibung');
      el('Kurztext', kodierbar(excelTrim(p.kurztext || ''), 'cp1252', zeichen, p.oz));
      el('Langtext', rtf(kodierbar(p.langtext || '', 'cp1252', zeichen, p.oz)));
      end('Beschreibung');
      end('Position');
    }
    end('LVBereich');
  }
  end('LV');
  end('Vergabe');
  stufe -= 1;
  zeilen.push(`#end[GAEB]${zaehl.obj}|${zaehl.elem}`);
  const text = zeilen.join('\r\n') + '\r\n';
  return { bytes: encodeText(text, 'cp1252'), zeichen, text };
}

function norm(t) {
  return String(t || '').replace(/\s+/g, ' ').trim();
}

function zeileAn(prev, inhalt) {
  const t = String(inhalt).trimEnd();
  return prev ? `${prev}\n${t}` : t;
}

function milliAus(roh) {
  const n = BigInt(roh);
  const sign = n < 0n ? '-' : '';
  const a = n < 0n ? -n : n;
  return `${sign}${a / 1000n}.${String(a % 1000n).padStart(3, '0')}`;
}

export function liesD83(bytes, codecName, opt = {}) {
  const fehler = [];
  const phasen = opt.phasen || ['83'];
  const raw = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  const text = decodeBytes(raw, codecName);
  if (!text.includes('\r\n') || text.replaceAll('\r\n', '').includes('\n') || text.replaceAll('\r\n', '').includes('\r')) {
    fehler.push('Zeilenenden nicht durchgehend CRLF');
  }
  const zeilen = text.split('\r\n');
  if (zeilen[zeilen.length - 1] === '') zeilen.pop();
  const lv = [];
  let akt = null, pos = null, anz99 = null, maske = null, phase = null;
  zeilen.forEach((z, idx) => {
    const i = idx + 1;
    if (z.length !== 80) { fehler.push(`Satz ${i}: Länge ${z.length} statt 80`); return; }
    if (z.slice(74, 80) !== String(i).padStart(6, '0')) fehler.push(`Satz ${i}: Satznummer`);
    const za = z.slice(0, 2);
    if (za === '00') {
      phase = z.slice(10, 12);
      maske = z.slice(62, 71);
      if (i === 1 && (z[12] !== 'L' || z.slice(71, 73) !== '90' || !phasen.includes(phase))) fehler.push('Satz 00 fehlerhaft');
    } else if (i === 1) fehler.push('Satz 00 fehlerhaft');
    if (za === '11') { akt = { oz: z.slice(2, 11).trimEnd(), titel: '', positionen: [] }; lv.push(akt); }
    else if (za === '12') akt.titel = zeileAn(akt.titel, z.slice(2, 42));
    else if (za === '21') {
      const m = z.slice(23, 34);
      if (!' -'.includes(z[22])) fehler.push(`Satz ${i}: MENGEMIN`);
      let menge = null;
      if (m.trim() !== '') {
        if (!/^\d+$/.test(m)) fehler.push(`Satz ${i}: Menge nicht numerisch`);
        else menge = (z[22] === '-' ? '-' : '') + milliAus(m).replace(/^-/, '');
      }
      const art = z.slice(11, 14);
      if (art !== 'NNN' && art !== 'NEN') fehler.push(`Satz ${i}: Positionsart ${art}`);
      const o = z.slice(2, 11);
      pos = { oz: o.slice(0, 2) + '.' + o.slice(2, 6), menge, einheit: z.slice(34, 38).trimEnd(), bedarf: art[1] === 'E', kurztext: '', langtext: '' };
      if (z.slice(38, 74).trim() || o.slice(6, 9).trim()) fehler.push(`Satz ${i}: unerwartete Zeichen`);
      if (!akt || o.slice(0, 2) !== akt.oz) fehler.push(`Satz ${i}: OZ nicht in Gruppe`);
      if (akt) akt.positionen.push(pos);
    } else if (za === '25') pos.kurztext = zeileAn(pos.kurztext, z.slice(2, 72));
    else if (za === '26') {
      if (z.slice(2, 5).trim() || z.slice(60, 74).trim()) fehler.push(`Satz ${i}: Satz 26 außerhalb 6-60 belegt`);
      if (!z.slice(5, 60).trim()) fehler.push(`Satz ${i}: leere Langtextzeile`);
      pos.langtext = zeileAn(pos.langtext, z.slice(5, 60));
    } else if (za === '31') {
      if (!akt || z.slice(2, 11).trimEnd() !== akt.oz) fehler.push(`Satz ${i}: Satz 31 passt nicht zur Gruppe`);
    } else if (za === '99') anz99 = Number(z.slice(69, 74));
    else if (!['00', '01', '02', '03', '08'].includes(za)) fehler.push(`Satz ${i}: unbekannte Satzart ${za}`);
  });
  if (maske !== OZMASKE) fehler.push(`OZ-Maske ${maske}`);
  const n = lv.reduce((s, g) => s + g.positionen.length, 0);
  if (anz99 !== n) fehler.push(`Satz 99: ANZTEIL ${anz99} ≠ ${n} Positionen`);
  if (zeilen.length && zeilen[zeilen.length - 1].slice(0, 2) !== '99') fehler.push('letzter Satz ist nicht 99');
  return { lv, fehler, phase };
}

function rtfText(r) {
  if (!r.startsWith('{\\rtf1')) return r;
  let t = r.replace(/\{\\fonttbl[\s\S]*?\}\}/, '');
  t = t.replaceAll('\\par ', '\n');
  t = t.replace(/\\'([0-9a-f]{2})/g, (_, h) => decodeBytes(Uint8Array.from([parseInt(h, 16)]), 'cp1252'));
  t = t.replace(/\\(rtf1|ansicpg1252|ansi|deff0|f0|fs20) ?/g, '');
  t = t.replaceAll('\\{', '{').replaceAll('\\}', '}').replaceAll('\\\\', '\\');
  return t.replace(/[{}]/g, '').trim();
}

export function liesP83(bytes, opt = {}) {
  const fehler = [];
  const phasen = opt.phasen || ['83'];
  const text = decodeBytes(bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes), 'cp1252');
  const roh = text.replaceAll('\r\n', '');
  if (roh.includes('\n') || roh.includes('\r')) fehler.push('Zeilenenden nicht durchgehend CRLF');
  const endz = text.match(/#end\[GAEB\](\d+)\|(\d+)\s*$/);
  if (!endz) fehler.push('Zählung hinter #end[GAEB] fehlt');
  const muster = () => /#begin\[(\w+)\]|#end\[(\w+)\]|\[(\w+)\]([\s\S]*?)\[end\]/g;
  const stapel = [];
  const lv = [];
  let akt = null, pos = null, nobj = 0, nel = 0;
  const kopf = {};
  const rest = text.replace(muster(), '').replace(/\d+\|\d+/g, '');
  if (rest.trim()) fehler.push('Text außerhalb von Schlüsselwörtern');
  for (const mt of text.matchAll(muster())) {
    const [, b, e, k, w0] = mt;
    if (b) {
      stapel.push(b); nobj += 1;
      if (b === 'LVBereich') { akt = { oz: null, titel: '', positionen: [] }; lv.push(akt); }
      else if (b === 'Position') {
        pos = { oz: null, menge: null, einheit: '', bedarf: false, kurztext: '', langtext: '' };
        akt.positionen.push(pos);
      }
    } else if (e) {
      if (!stapel.length || stapel.pop() !== e) fehler.push(`#end[${e}] ohne passendes #begin`);
    } else {
      nel += 1;
      const w = w0.replaceAll('&#91;', '[').replaceAll('&#93;', ']').replaceAll('&#38;', '&');
      const ober = stapel[stapel.length - 1] || '';
      if (ober === 'LVBereich') {
        if (k === 'OZ') akt.oz = w;
        else if (k === 'Bez') akt.titel = w;
      } else if (ober === 'Position') {
        if (k === 'OZ') pos.oz = w.slice(0, 2) + '.' + w.slice(2);
        else if (k === 'Menge') {
          if (!/^-?\d+,\d{3}$/.test(w)) fehler.push(`Menge ${w} nicht im Format 0,000`);
          pos.menge = w.replace(',', '.');
        } else if (k === 'ME') pos.einheit = w;
      } else if (ober === 'Beschreibung') {
        if (k === 'Kurztext') pos.kurztext = w;
        else if (k === 'Langtext') pos.langtext = rtfText(w);
      } else kopf[`${ober}/${k}`] = w;
    }
  }
  if (stapel.length) fehler.push('offene Objekte');
  if (endz && (Number(endz[1]) !== nobj || Number(endz[2]) !== nel)) fehler.push(`Zählung ${endz[1]}|${endz[2]} ≠ ${nobj}|${nel}`);
  const dp = kopf['Vergabe/DP'];
  if (!phasen.includes(dp)) fehler.push(phasen.length === 1 && phasen[0] === '83' ? 'DP ist nicht 83' : `DP ${dp || 'leer'} nicht in ${phasen.join('/')}`);
  return { lv, fehler, kopf, phase: dp };
}

export function zeichensatzFuer(bytes) {
  const raw = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  const kopf = decodeBytes(raw.slice(0, 120), 'cp1252');
  if (kopf.includes('#begin[GAEB]') || kopf.startsWith('#')) return { art: 'P', codec: 'cp1252' };
  const punkte = (codec) => {
    const t = decodeBytes(raw, codec);
    const umlaut = (t.match(/[äöüÄÖÜß]/g) || []).length;
    const kaputt = (t.match(/\uFFFD/g) || []).length;
    return umlaut * 5 - kaputt * 8;
  };
  const oem = punkte('cp850');
  const ansi = punkte('cp1252');
  return { art: 'D', codec: ansi > oem ? 'cp1252' : 'cp850' };
}

function tx(t, codecName) {
  return norm([...String(t || '')].map((c) => (canEncode(c, codecOf(codecName)) ? c : (ERSATZ[c] ?? c))).join(''));
}

export function vergleiche(soll, ist, art, codecName, leereMenge, einheitAscii) {
  const fehler = [];
  if (soll.map((g) => g.oz).join() !== ist.map((g) => g.oz).join()) return [`${art}: Gruppen weichen ab`];
  soll.forEach((gs, gi) => {
    const gi2 = ist[gi];
    if (norm(gs.titel) !== norm(gi2.titel)) fehler.push(`${art} Gruppe ${gs.oz}: Titel`);
    if (gs.positionen.length !== gi2.positionen.length) {
      fehler.push(`${art} Gruppe ${gs.oz}: Anzahl`);
      return;
    }
    gs.positionen.forEach((ps, i) => {
      const pi = gi2.positionen[i];
      const sollM = ps.menge == null ? (leereMenge === 'null' ? '0.000' : null) : quantize3(ps.menge).text;
      let sollE = ps.einheit || '';
      if (art === 'D83') {
        if (einheitAscii) sollE = sollE.replaceAll('²', '2').replaceAll('³', '3');
        sollE = tx(sollE, codecName);
        if (sollE.length > 4) sollE = '';
      }
      const istM = pi.menge == null ? null : quantize3(pi.menge).text;
      const pairs = [
        ['OZ', ps.oz, pi.oz],
        ['Kurztext', tx(ps.kurztext, codecName), norm(pi.kurztext)],
        ['Langtext', tx(ps.langtext, codecName), norm(pi.langtext)],
        ['Menge', sollM, istM],
        ['Einheit', sollE, pi.einheit],
        ['Bedarf', art === 'D83' ? !!ps.bedarf : false, !!pi.bedarf],
      ];
      for (const [feld, a, b] of pairs) if (a !== b) fehler.push(`${art} ${ps.oz}: ${feld} soll ${a} ist ${b}`);
    });
  });
  return fehler;
}

export function pruefeLv(gruppen) {
  const fehler = [];
  const gesehen = new Set();
  for (const g of gruppen) {
    if (!/^\d{2}$/.test(g.oz)) fehler.push(`Titel-OZ „${g.oz}“ passt nicht zur Maske TT.`);
    for (const p of g.positionen) {
      if (!/^\d{2}\.\d{4}$/.test(p.oz)) fehler.push(`OZ „${p.oz}“ passt nicht zur Maske TT.PPPP.`);
      if (gesehen.has(p.oz)) fehler.push(`OZ ${p.oz} doppelt.`);
      gesehen.add(p.oz);
    }
  }
  const ozs = gruppen.map((g) => g.oz);
  if (ozs.join() !== [...ozs].sort().join() || new Set(ozs).size !== ozs.length) fehler.push('Titel-OZ sind nicht aufsteigend oder eindeutig.');
  return fehler;
}

export function zusammenfassung(lv, extra = []) {
  const positionen = lv.flatMap((g) => g.positionen);
  const summe = positionen.reduce((s, p) => s + (p.gp != null ? Number(p.gp) : (p.menge != null && p.ep != null ? Number(p.menge) * Number(p.ep) : 0)), 0);
  return {
    titel: lv.length,
    positionen: positionen.length,
    mitMenge: positionen.filter((p) => p.menge != null && Number(p.menge) > 0).length,
    bedarf: positionen.filter((p) => p.bedarf).length,
    summe,
    warnungen: extra,
  };
}
