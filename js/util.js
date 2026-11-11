// Allgemeine Hilfsfunktionen: Formatierung (deutsch), Escape, Dialoge, Toast
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2));
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const p2 = n => String(n).padStart(2, '0');

export function fmtNum(n, d = 2) {
  if (n === null || n === undefined || !isFinite(n)) return '–';
  return Number(n).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
}
export function fmtDate(ts) {
  if (ts === null || ts === undefined || ts === '') return '';
  let d;
  if (typeof ts === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ts)) { const [y, m, dd] = ts.split('-'); return `${dd}.${m}.${y}`; }
  d = new Date(ts); if (isNaN(d)) return '';
  return `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()}`;
}
export function fmtTime(ts, sec = false) { const d = new Date(ts); return `${p2(d.getHours())}:${p2(d.getMinutes())}${sec ? ':' + p2(d.getSeconds()) : ''}`; }
export function fmtDateTime(ts, sec = false) { return `${fmtDate(ts)} ${fmtTime(ts, sec)}`; }
export function isoDate(ts = Date.now()) { const d = new Date(ts); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; }
export function fmtCoord(lat, lon, d = 5) {
  if (lat == null || lon == null) return '';
  return `${fmtNum(Math.abs(lat), d)}° ${lat >= 0 ? 'N' : 'S'} / ${fmtNum(Math.abs(lon), d)}° ${lon >= 0 ? 'O' : 'W'}`;
}
export function fmtBytes(b) { if (!b) return '0 MB'; return fmtNum(b / 1048576, 1) + ' MB'; }

/** Zahl parsen: akzeptiert "12,5", "1.234,5", "12.5" und einfache Rechenausdrücke "12,5*3+2" */
export function parseNum(s) {
  if (typeof s === 'number') return s;
  s = String(s ?? '').trim(); if (!s) return NaN;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '');
  s = s.replace(/,/g, '.').replace(/[x×]/gi, '*').replace(/÷/g, '/').replace(/\s+/g, '');
  if (!/^[-+*/().\d]+$/.test(s)) return NaN;
  // kleiner rekursiver Parser (kein eval)
  let i = 0;
  const peek = () => s[i];
  const num = () => { let st = i; while (i < s.length && /[\d.]/.test(s[i])) i++; if (st === i) throw 0; return parseFloat(s.slice(st, i)); };
  const factor = () => { if (peek() === '-') { i++; return -factor(); } if (peek() === '+') { i++; return factor(); } if (peek() === '(') { i++; const v = expr(); if (s[i++] !== ')') throw 0; return v; } return num(); };
  const term = () => { let v = factor(); while (peek() === '*' || peek() === '/') { const o = s[i++]; const r = factor(); v = o === '*' ? v * r : v / r; } return v; };
  const expr = () => { let v = term(); while (peek() === '+' || peek() === '-') { const o = s[i++]; const r = term(); v = o === '+' ? v + r : v - r; } return v; };
  try { const v = expr(); if (i !== s.length) return NaN; return v; } catch { return NaN; }
}
export function safeName(s) { return String(s || 'Projekt').normalize('NFKD').replace(/[äÄ]/g, 'ae').replace(/[öÖ]/g, 'oe').replace(/[üÜ]/g, 'ue').replace(/ß/g, 'ss').replace(/[^\w\-]+/g, '_').replace(/_+/g, '_').slice(0, 60); }

let toastT;
export function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms);
}

/** Modal-Dialog. fields: [{name,label,type,value,inputmode,placeholder,options}] buttons: [{label,value,cls}] */
export function modal({ title = '', html = '', fields = [], buttons = [{ label: 'Abbrechen', value: null }, { label: 'OK', value: 'ok', cls: 'primary' }], onOpen } = {}) {
  return new Promise(resolve => {
    const root = $('#modal-root');
    const wrap = document.createElement('div'); wrap.className = 'modal';
    wrap.innerHTML = `<form class="sheet" novalidate>${title ? `<h2>${esc(title)}</h2>` : ''}${html}
      ${fields.map(f => `<label class="f">${esc(f.label)}${f.type === 'textarea'
        ? `<textarea name="${f.name}" placeholder="${esc(f.placeholder || '')}">${esc(f.value ?? '')}</textarea>`
        : f.type === 'select' ? `<select name="${f.name}">${f.options.map(o => `<option value="${esc(o.value)}" ${o.value == f.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`
        : `<input name="${f.name}" type="${f.type || 'text'}" inputmode="${f.inputmode || ''}" value="${esc(f.value ?? '')}" placeholder="${esc(f.placeholder || '')}" autocomplete="off">`}</label>`).join('')}
      <div class="row" style="margin-top:6px">${buttons.map((b, i) => `<button type="${b.value === 'ok' ? 'submit' : 'button'}" class="btn ${b.cls || ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}</div></form>`;
    root.appendChild(wrap);
    const form = wrap.querySelector('form');
    const close = (v) => { wrap.remove(); resolve(v); };
    const collect = () => { const o = {}; fields.forEach(f => o[f.name] = form.elements[f.name].value); return o; };
    form.addEventListener('submit', e => { e.preventDefault(); const b = buttons.find(b => b.value === 'ok'); close(fields.length ? collect() : b.value); });
    wrap.querySelectorAll('button[data-i]').forEach(btn => btn.addEventListener('click', e => {
      const b = buttons[+btn.dataset.i]; if (b.value === 'ok') return; e.preventDefault();
      close(b.value === null ? null : (fields.length && b.collect ? { ...collect(), _btn: b.value } : b.value));
    }));
    const opened = Date.now();
    wrap.addEventListener('click', e => { if (e.target === wrap && Date.now() - opened > 600) close(null); });
    const first = form.querySelector('input,textarea'); if (first) setTimeout(() => { first.focus(); first.select?.(); }, 50);
    onOpen && onOpen(form);
  });
}
export const confirmDlg = (title, text, okLabel = 'Löschen', cls = 'danger') =>
  modal({ title, html: `<p>${esc(text)}</p>`, buttons: [{ label: 'Abbrechen', value: null }, { label: okLabel, value: 'ok', cls }] }).then(v => v === 'ok');

export function blobUrl(blob) { return blob ? URL.createObjectURL(blob) : ''; }
export async function loadImg(blob) {
  const url = URL.createObjectURL(blob); const img = new Image(); img.decoding = 'async'; img.src = url;
  try { await img.decode(); } catch (e) { await new Promise((r, j) => { img.onload = r; img.onerror = j; }); }
  img._url = url; return img;
}
export function canvasToBlob(c, type = 'image/jpeg', q = 0.88) { return new Promise(r => c.toBlob(r, type, q)); }
export function downloadBlob(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}

function fileTypeFor(blob, name) {
  if (blob && blob.type) return blob.type;
  if (/\.pdf$/i.test(name)) return 'application/pdf';
  if (/\.zip$/i.test(name)) return 'application/zip';
  return 'application/octet-stream';
}

/** Datei fürs Teilen-Menü. type bleibt der echte MIME-Typ, damit Drive/Mail/WhatsApp die Datei erkennen. */
export function fileForShare(blob, name) {
  return new File([blob], name, { type: fileTypeFor(blob, name), lastModified: Date.now() });
}

/** true, wenn dieses Gerät die Datei über das System-Teilen-Menü verschicken kann. */
export function canShareFile(file) {
  try {
    return typeof navigator.share === 'function'
      && typeof navigator.canShare === 'function'
      && navigator.canShare({ files: [file] });
  } catch (e) { return false; }
}

/**
 * Teilen über die Web Share API (navigator.share mit Datei), sonst normaler Download.
 * Rückgabe: 'shared' | 'download' | 'abort' (Nutzer hat das Menü geschlossen).
 */
export async function shareOrDownload(blob, name, title) {
  const file = fileForShare(blob, name);
  if (canShareFile(file)) {
    try {
      await navigator.share({ files: [file], title: title || name });
      return 'shared';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'abort';
    }
  }
  downloadBlob(blob, name);
  return 'download';
}
