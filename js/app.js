// Baudoku – Hauptanwendung (Views, Router)
import * as db from './db.js';
import { $, $$, esc, uid, fmtDate, fmtDateTime, fmtNum, fmtCoord, fmtBytes, isoDate, parseNum, toast, modal, confirmDlg, loadImg, canvasToBlob, downloadBlob, shareOrDownload, safeName, HEADER_COLORS } from './util.js';
import { startGeo, stopGeo, getFix, onGeo, geoState, reverseGeocode, processImage, liveCamera } from './media.js';
import { readExif } from './exif.js';
import { emptyMeasure, measureValue } from './geom.js';
import { mountEditor, rectify, fmtVal } from './measure.js';
import { buildPdf } from './pdf.js';
import { exportZip, importFile } from './backup.js';
import { resyncProjectSketches } from './sketch.js';
import { mountDraw } from './draw.js';
import { sketchProposals, importLegacyStrokes, importLegacySketch } from './plan.js';
import { sumSelected, formatCalcText } from './sketch-calc.js';

const APP_VERSION = 'baudoku-v1.7.5';
const APP = $('#app');
const DEFAULTS = { firma: '', bearbeiter: '', geocode: true, stampFirma: true, pdfStamped: true, header: 'blue' };
function applyHeader(id) {
  const key = HEADER_COLORS[id] ? id : 'blue';
  document.documentElement.dataset.header = key;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', HEADER_COLORS[key].bg);
}
const UNITS = ['m²', 'm', 'Stk', 'lfm', 'psch', 'h', 'm³', 'kg'];
let cleanup = [];
const urls = []; const url = b => { if (!b) return ''; const u = URL.createObjectURL(b); urls.push(u); return u; };
async function settings() { return { ...DEFAULTS, ...(await db.getSetting('app', {})) }; }
window.__baudoku = { db };

/* ---------- Router ---------- */
function parseHash() { const h = location.hash.slice(1) || '/'; const [p, q] = h.split('?'); return { parts: p.split('/').filter(Boolean), q: new URLSearchParams(q || '') }; }
export const go = h => { if (location.hash === h) route(); else location.hash = h; };
async function route() {
  cleanup.forEach(f => { try { f(); } catch (e) { } }); cleanup = [];
  while (urls.length) URL.revokeObjectURL(urls.pop());
  $('#modal-root').innerHTML = '';
  const { parts, q } = parseHash();
  try {
    if (!parts.length) return await viewList();
    if (parts[0] === 'new') return await viewEditProject(null);
    if (parts[0] === 'settings') return await viewSettings();
    if (parts[0] === 'p' && parts[2] === 'edit') return await viewEditProject(parts[1]);
    if (parts[0] === 'p') return await viewProject(parts[1], q.get('tab') || 'photos', q);
    if (parts[0] === 'photo') return await viewPhoto(parts[1]);
    if (parts[0] === 'measure') return await viewMeasure(parts[1]);
    if (parts[0] === 'sketch') return await viewSketch(parts[1]);
    if (parts[0] === 'draw') return await viewDraw(parts[1]);
    if (parts[0] === 'sheet') return await viewSheet(parts[1]);
    go('#/');
  } catch (e) { console.error(e); APP.innerHTML = `<main><div class="card">Fehler: ${esc(e.message)}</div><a class="btn" href="#/">Zur Übersicht</a></main>`; }
}
window.addEventListener('hashchange', route);
const header = (title, { back, sub, right = '' } = {}) => `<header class="hdr">${back ? `<button class="ib" data-nav="${esc(back)}" aria-label="Zurück">←</button>` : '<span style="width:8px"></span>'}<h1>${esc(title)}${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</h1>${right}</header>`;
APP.addEventListener('click', e => {
  const del = e.target.closest('[data-del-project]');
  if (del) { e.preventDefault(); e.stopPropagation(); deleteProjectFlow(del.dataset.delProject); return; }
  const draw = e.target.closest('[data-draw]');
  if (draw) { e.preventDefault(); e.stopPropagation(); go('#/draw/' + draw.dataset.draw); return; }
  const delSheet = e.target.closest('[data-del-sheet]');
  if (delSheet) { e.preventDefault(); e.stopPropagation(); deleteSheetFlow(delSheet.dataset.delSheet); return; }
  const n = e.target.closest('[data-nav]'); if (n) { e.preventDefault(); go(n.dataset.nav); }
});

/* ---------- Projektliste ---------- */
async function viewList() {
  const projects = (await db.all('projects')).sort((a, b) => (b.updated || 0) - (a.updated || 0));
  const photos = await db.all('photos'); const notes = await db.all('notes');
  const cnt = {}; photos.forEach(p => { (cnt[p.projectId] ||= { p: 0, n: 0, th: null, t: 0 }).p++; if (p.created > cnt[p.projectId].t) { cnt[p.projectId].t = p.created; cnt[p.projectId].th = p; } });
  notes.forEach(n => (cnt[n.projectId] ||= { p: 0, n: 0 }).n++);
  APP.innerHTML = header('Baudoku', { sub: 'Projekte', right: `<button class="ib" data-nav="#/settings" aria-label="Einstellungen">⚙</button>` }) +
    `<main><div class="search"><input class="inp" id="q" type="search" placeholder="Projekt, Kunde, Adresse, BV-Nr. suchen" autocomplete="off"></div>
    <div class="plist" id="plist"></div></main><button class="btn primary fab" data-nav="#/new">＋ Neues Projekt</button>`;
  const render = () => {
    const q = $('#q').value.trim().toLowerCase();
    const list = projects.filter(p => !q || [p.name, p.kunde, p.adresse, p.bvnr, p.notiz].join(' ').toLowerCase().includes(q));
    $('#plist').innerHTML = list.length ? list.map(p => {
      const c = cnt[p.id] || { p: 0, n: 0 }; const cover = photos.find(x => x.id === p.coverPhotoId) || c.th;
      return `<div class="card" data-nav="#/p/${p.id}"><div class="th" style="${cover ? `background-image:url(${url(cover.thumb)})` : ''}">${cover ? '' : '🏠'}</div>
        <div class="meta"><div class="t">${esc(p.name)}</div><div class="small">${esc([p.kunde, p.adresse].filter(Boolean).join(' · ') || '–')}</div>
        <div class="small">${p.bvnr ? 'BV ' + esc(p.bvnr) + ' · ' : ''}${fmtDate(p.datum)} · 📷 ${c.p} · 📝 ${c.n}</div></div>
        <button type="button" class="btn danger del" data-del-project="${esc(p.id)}" aria-label="Projekt ${esc(p.name)} löschen">Löschen</button></div>`;
    }).join('') : `<div class="empty">${projects.length ? 'Keine Treffer.' : 'Noch keine Projekte.<br>Tippe auf „Neues Projekt“.'}</div>`;
  };
  $('#q').addEventListener('input', render); render();
}

/* ---------- Projekt anlegen / bearbeiten ---------- */
async function viewEditProject(id) {
  const p = id ? await db.get('projects', id) : { id: uid(), name: '', kunde: '', adresse: '', bvnr: '', datum: isoDate(), notiz: '', created: Date.now() };
  if (!p) return go('#/');
  APP.innerHTML = header(id ? 'Projekt bearbeiten' : 'Neues Projekt', { back: id ? `#/p/${id}` : '#/' }) + `<main><form id="pf" class="card" novalidate>
    <label class="f">Projektname *<input name="name" required value="${esc(p.name)}" placeholder="z. B. Neueindeckung EFH Müller"></label>
    <label class="f">Kunde<input name="kunde" value="${esc(p.kunde)}" autocomplete="off"></label>
    <label class="f">Adresse<input name="adresse" value="${esc(p.adresse)}" placeholder="Straße Nr., PLZ Ort"></label>
    <button type="button" class="btn sm" id="locAddr" style="margin:-4px 0 12px">📍 Adresse vom aktuellen Standort</button>
    <div class="grid2"><label class="f">Bauvorhaben-Nr.<input name="bvnr" value="${esc(p.bvnr)}"></label>
    <label class="f">Datum<input name="datum" type="date" value="${esc(p.datum)}"></label></div>
    <label class="f">Notiz<textarea name="notiz">${esc(p.notiz)}</textarea></label>
    <button class="btn primary block" type="submit">Speichern</button>
    ${id ? '<button type="button" class="btn danger block" id="delP" style="margin-top:10px">Projekt löschen</button>' : ''}</form></main>`;
  const f = $('#pf');
  $('#locAddr').onclick = async () => { toast('Standort wird ermittelt …'); const fx = await getFix(30000); if (!fx) return toast('Kein GPS-Standort verfügbar'); const a = await reverseGeocode(fx.lat, fx.lon); f.adresse.value = a || fmtCoord(fx.lat, fx.lon); };
  f.addEventListener('submit', async e => {
    e.preventDefault(); if (!f.name.value.trim()) { f.name.focus(); return toast('Bitte Projektname eingeben'); }
    ['name', 'kunde', 'adresse', 'bvnr', 'datum', 'notiz'].forEach(k => p[k] = f[k].value.trim());
    p.updated = Date.now(); await db.put('projects', p); toast('Projekt gespeichert'); go(`#/p/${p.id}`);
  });
  if (id) $('#delP').onclick = () => deleteProjectFlow(id);
}
async function deleteProjectFlow(id) {
  const p = await db.get('projects', id); if (!p) return;
  const choice = await modal({
    title: 'Projekt löschen?',
    html: `<p><b>${esc(p.name)}</b> wird mit allen Fotos, Notizen, Aufmaßpositionen, Skizzen, Ausgangsbildern und Rechenwegen gelöscht. Andere Projekte bleiben unverändert.</p><p>Vor dem Löschen ein ZIP-Backup erstellen?</p>`,
    buttons: [{ label: 'Abbrechen', value: null }, { label: 'Backup (ZIP)', value: 'backup' }, { label: 'Endgültig löschen', value: 'delete', cls: 'danger' }],
  });
  if (choice === 'backup') {
    toast('Backup wird erstellt …');
    const blob = await exportZip([id]);
    await shareOrDownload(blob, `Baudoku_Backup_${safeName(p.name)}_${isoDate()}.zip`, `Backup ${p.name}`);
    toast('Backup erstellt. Das Projekt ist noch da.');
    return;
  }
  if (choice !== 'delete') return;
  await db.deleteProject(id);
  toast('Projekt gelöscht');
  go('#/');
}
const touchProject = async pid => { const p = await db.get('projects', pid); if (p) { p.updated = Date.now(); await db.put('projects', p); } };

/* ---------- Foto hinzufügen ---------- */
async function addPhoto(pid, blob, source) {
  const project = await db.get('projects', pid); const s = await settings();
  let time = Date.now(), lat = null, lon = null, acc = null, timeKind = 'capture';
  const ex = source === 'rectified' ? null : await readExif(blob);
  if (source === 'gallery') {
    if (ex?.time) { time = ex.time; timeKind = 'exif'; }
    else { time = blob.lastModified || Date.now(); timeKind = 'import'; }
    if (ex?.lat != null) { lat = ex.lat; lon = ex.lon; acc = ex.acc ?? null; }
  } else if (source !== 'rectified') {
    if (ex?.time) time = ex.time;
    const f = await getFix(180000);
    if (f) { lat = f.lat; lon = f.lon; acc = f.acc; }
    else if (ex?.lat != null) { lat = ex.lat; lon = ex.lon; acc = ex.acc ?? null; }
  }
  const address = lat != null && s.geocode ? await reverseGeocode(lat, lon) : '';
  const original = new Blob([blob], { type: blob.type || 'image/jpeg' });
  const meta = { projectName: project.name, firma: s.stampFirma ? s.firma : '', time, lat, lon, acc, address, source, timeKind };
  const r = await processImage(original, meta);
  const rec = { id: uid(), projectId: pid, created: Date.now(), time, timeKind, lat, lon, acc, address, source, caption: '', original, stamped: r.stamped, thumb: r.thumb, width: r.width, height: r.height, measure: emptyMeasure() };
  await db.put('photos', rec); await touchProject(pid);
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => { });
  if ((source === 'camera' || source === 'live') && lat == null) toast('Foto mit Datum gespeichert. Ort nicht verfügbar – Standort für diese Seite erlauben.');
  return rec;
}
async function addFiles(pid, files, source) {
  let n = 0;
  for (const f of files) {
    if (!f.type.startsWith('image/') && !/\.(jpe?g|png|webp|heic)$/i.test(f.name || '')) continue;
    toast(`Foto ${++n}/${files.length} wird verarbeitet …`, 10000);
    try { await addPhoto(pid, f, source); } catch (e) { console.error(e); toast('Bild konnte nicht gelesen werden (Format?)'); return; }
  }
  if (n) toast(n > 1 ? `${n} Fotos gespeichert` : 'Foto gespeichert');
}
async function restamp(ph) {
  const project = await db.get('projects', ph.projectId); const s = await settings();
  if (!ph.address && ph.lat != null && s.geocode) ph.address = await reverseGeocode(ph.lat, ph.lon);
  const r = await processImage(ph.original, { projectName: project.name, firma: s.stampFirma ? s.firma : '', time: ph.time, lat: ph.lat, lon: ph.lon, acc: ph.acc, address: ph.address, source: ph.source, timeKind: ph.timeKind });
  ph.stamped = r.stamped; ph.thumb = r.thumb; await db.put('photos', ph);
}

/* ---------- Projektansicht mit Tabs ---------- */
async function loadSketchDoc(kind, id) {
  if (kind === 'sheet') { const s = await db.get('sheets', id); return s?.doc || importLegacyStrokes(s?.strokes || []); }
  if (kind === 'sketch') { const s = await db.get('sketches', id); return s?.doc || importLegacySketch(s || {}, s?.imgW, s?.imgH); }
  const p = await db.get('photos', id);
  return p?.markup?.doc || importLegacyStrokes(p?.markup?.strokes || []);
}
async function sketchImport(pid, photos, reload) {
  const box = $('#skImp'); if (!box) return;
  const sheets = await db.byProject('sheets', pid);
  const sketches = await db.byProject('sketches', pid);
  const phs = photos.filter((p) => p.markup?.doc || p.markup?.strokes?.length);
  const items = [
    ...sheets.map((s) => ({ kind: 'sheet', id: s.id, title: s.title || 'Leeres Blatt' })),
    ...sketches.map((s) => ({ kind: 'sketch', id: s.id, title: s.title || 'Flächenskizze' })),
    ...phs.map((p) => ({ kind: 'photo', id: p.id, title: p.caption || 'Foto-Skizze' })),
  ];
  box.innerHTML = `<h3 class="sec">Skizze wählen</h3>${items.map((s) => `<button type="button" class="btn block sk-src" data-kind="${esc(s.kind)}" data-id="${esc(s.id)}">${esc(s.title)}</button>`).join('') || '<p class="small">Keine Skizze im Projekt.</p>'}`;
  box.querySelectorAll('.sk-src').forEach((btn) => btn.onclick = async () => {
    const doc = await loadSketchDoc(btn.dataset.kind, btn.dataset.id);
    const prop = sketchProposals(doc);
    const rows = [...prop.sides, ...prop.areas];
    box.innerHTML = `<h3 class="sec">Vorschlag prüfen</h3><div id="skPrev">${rows.map((r, i) => `<label class="sk-row${r.missing || r.ambiguous || (r.free && r.kind === 'area') ? ' missing' : ''}" data-i="${i}">
      <input type="checkbox" data-take ${r.take ? 'checked' : ''} ${r.take ? '' : 'disabled'}>
      <span>${esc(r.bez)}</span>
      <input data-val inputmode="decimal" value="${r.value == null ? '' : String(r.value).replace('.', ',')}" placeholder="${r.missing ? 'Maß fehlt' : ''}" aria-label="${esc(r.bez)}">
      <b>${esc(r.unit || (r.kind === 'area' ? 'm²' : 'm'))}</b>
      ${r.missing ? '<em>Maß fehlt</em>' : ''}${r.ambiguous ? '<em>nicht eindeutig</em>' : ''}${r.derived ? '<em>abgeleitet</em>' : ''}${r.free && r.kind === 'area' ? '<em>Freie Linie</em>' : ''}
    </label>`).join('') || '<p>Nichts zu übernehmen.</p>'}</div><button type="button" class="btn primary block" id="skTake">Übernehmen</button>`;
    box.querySelectorAll('[data-val]').forEach((inp) => inp.addEventListener('input', () => {
      const row = inp.closest('.sk-row');
      const cb = row.querySelector('[data-take]');
      const note = row.querySelector('em')?.textContent || '';
      if (/nicht eindeutig|Freie Linie/.test(note)) return;
      const n = parseNum(inp.value);
      if (inp.value.trim() && isFinite(n)) { cb.disabled = false; row.classList.remove('missing'); }
    }));
    $('#skTake').onclick = async () => {
      const amNow = await db.byProject('aufmass', pid);
      let n = amNow.reduce((m, r) => Math.max(m, parseInt(r.pos, 10) || 0), 0);
      let added = 0;
      for (const lab of box.querySelectorAll('.sk-row')) {
        const cb = lab.querySelector('[data-take]');
        if (!cb || !cb.checked || cb.disabled) continue;
        const src = rows[+lab.dataset.i];
        const raw = lab.querySelector('[data-val]').value.trim();
        const num = parseNum(raw);
        if (!raw || !isFinite(num)) continue;
        n += 1; added += 1;
        const row = { id: uid(), projectId: pid, order: Date.now() + n, pos: String(n).padStart(2, '0'), bez: src.bez, menge: num, expr: raw, einheit: src.kind === 'area' ? 'm²' : (src.unit || 'm'), manual: false, fromSketch: true };
        if (src.kind === 'area') row.calc = { ok: true, result: num, steps: src.steps || [], parts: src.parts || [], faceLabel: src.bez, shapeLabel: 'Skizze', areaKind: 'projection', areaKindLabel: 'aus Maßen', isDeduction: false, edges: [], formula: ((src.steps || []).find((s) => s.startsWith('Formel:')) || '').replace('Formel: ', ''), substitution: ((src.steps || []).at(-1) || '').replace('Rechnung: ', ''), missing: [] };
        await db.put('aufmass', row);
      }
      toast(added ? `${added} Positionen übernommen` : 'Nichts übernommen');
      reload();
    };
  });
}
async function viewProject(pid, tab, q) {
  const p = await db.get('projects', pid); if (!p) return go('#/');
  const [photos, notes, am, sketches, sheets] = await Promise.all([db.byProject('photos', pid), db.byProject('notes', pid), db.byProject('aufmass', pid), db.byProject('sketches', pid), db.byProject('sheets', pid)]);
  sheets.sort((a, b) => (b.updated || 0) - (a.updated || 0));
  photos.sort((a, b) => a.time - b.time || a.created - b.created); notes.sort((a, b) => b.created - a.created); am.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const no = new Map(photos.map((x, i) => [x.id, i + 1]));
  const drawnPhotos = photos.filter((p) => p.markup?.doc || (p.markup?.strokes || []).length).length;
  const tabs = [['photos', '📷', 'Fotos', photos.length], ['notes', '📝', 'Notizen', notes.length], ['aufmass', '📐', 'Aufmaß', am.length], ['sketches', '✏️', 'Skizze', drawnPhotos + sheets.length + sketches.length], ['export', '📄', 'Export', '']];
  APP.innerHTML = header(p.name, { back: '#/', sub: [p.kunde, p.adresse].filter(Boolean).join(' · ') || (p.bvnr ? 'BV ' + p.bvnr : ''), right: `<button class="ib" data-nav="#/p/${pid}/edit" aria-label="Bearbeiten">✎</button>` }) +
    `<main id="tab"></main><nav class="tabs">${tabs.map(([k, i, l, c]) => `<button data-tab="${k}" class="${k === tab ? 'on' : ''}"><span>${i}</span>${l}${c !== '' ? ` (${c})` : ''}</button>`).join('')}</nav>`;
  $$('.tabs button').forEach(b => b.onclick = () => history.replaceState(null, '', `#/p/${pid}?tab=${b.dataset.tab}`) || route());
  const T = $('#tab');
  const reload = () => route();

  if (tab === 'photos') {
    startGeo(); cleanup.push(stopGeo);
    T.innerHTML = `<div class="gps"><span class="dot" id="gdot"></span><span id="gtxt">GPS wird gesucht …</span></div>
      <div class="pgrid">${photos.map((x, i) => `<div class="shot"><div class="ph" data-nav="#/photo/${x.id}" style="background-image:url(${url(x.thumb)})"><span class="tag">${i + 1}</span>${x.measure?.items?.length ? `<span class="tag m">📐 ${x.measure.items.length}</span>` : ''}<div class="cap">${esc(x.caption || fmtDateTime(x.time))}</div></div><button type="button" class="btn block draw-label" data-draw="${x.id}">✎ Zeichnen</button></div>`).join('')}</div>
      ${photos.length ? '' : '<div class="empty">Noch keine Fotos.<br>Foto aufnehmen oder aus der Galerie wählen.</div>'}
      <div class="actions-sticky"><button class="btn primary block" id="bCam" style="min-height:64px;font-size:1.1rem">📷 Foto aufnehmen</button>
      <div class="grid2" style="margin-top:8px"><button class="btn" id="bLive">🎥 Live-Kamera (Serie)</button><button class="btn" id="bGal">🖼 Aus Galerie</button></div></div>`;
    const upd = () => { const g = geoState(); const d = $('#gdot'), t = $('#gtxt'); if (!d) return;
      if (g.fix) { const a = g.fix.acc; d.className = 'dot ' + (a <= 15 ? 'ok' : a <= 50 ? 'mid' : 'bad'); t.textContent = `GPS ±${fmtNum(a, 0)} m · ${fmtCoord(g.fix.lat, g.fix.lon, 5)}`; }
      else { d.className = 'dot' + (g.err ? ' bad' : ''); t.textContent = !g.supported ? 'GPS nicht unterstützt – Datum wird trotzdem gestempelt' : g.err ? g.err + ' – Datum wird gestempelt, Ort fehlt' : 'GPS wird gesucht …'; } };
    cleanup.push(onGeo(upd)); upd();
    const inCam = $('#in-camera'), inGal = $('#in-gallery');
    inCam.onchange = async () => { const fs = [...inCam.files]; inCam.value = ''; await addFiles(pid, fs, 'camera'); reload(); };
    inGal.onchange = async () => { const fs = [...inGal.files]; inGal.value = ''; await addFiles(pid, fs, 'gallery'); reload(); };
    $('#bCam').onclick = () => { startGeo(); inCam.click(); };
    $('#bGal').onclick = () => inGal.click();
    $('#bLive').onclick = async () => { startGeo(); let chain = Promise.resolve(); const ok = await liveCamera(b => { chain = chain.then(() => addPhoto(pid, b, 'live')).catch(console.error); }); await chain; if (ok) reload(); };
  }

  if (tab === 'notes') {
    const pre = q.get('photo') || '';
    const opts = `<option value="">– kein Foto –</option>` + photos.map((x, i) => `<option value="${x.id}" ${x.id === pre ? 'selected' : ''}>Foto ${i + 1}${x.caption ? ': ' + esc(x.caption.slice(0, 40)) : ' · ' + fmtDateTime(x.time)}</option>`).join('');
    T.innerHTML = `<div class="card"><textarea class="inp" id="nt" placeholder="Notiz eingeben … (Tipp: Mikrofon der Tastatur zum Diktieren)"></textarea>
      <select class="inp" id="nph" style="margin-top:8px">${opts}</select>
      <button class="btn primary block" id="nsave" style="margin-top:8px">Notiz speichern</button></div>
      <div id="nlist">${notes.map(n => { const ph = photos.find(x => x.id === n.photoId);
        return `<div class="card note"><div class="nh"><span class="small"><b>${fmtDateTime(n.created)}</b>${n.updated && n.updated - n.created > 60000 ? ' · bearb. ' + fmtDateTime(n.updated) : ''}${ph ? ` · Foto ${no.get(ph.id)}` : ''}</span>
        <span>${ph ? `<span class="nt" data-nav="#/photo/${ph.id}" style="display:inline-block;vertical-align:middle;background-image:url(${url(ph.thumb)})"></span>` : ''}<button class="ib" style="color:var(--dark)" data-edit="${n.id}" aria-label="Bearbeiten">✎</button></span></div>${esc(n.text)}</div>`; }).join('') || '<div class="empty">Noch keine Notizen.</div>'}</div>`;
    $('#nsave').onclick = async () => { const t = $('#nt').value.trim(); if (!t) return toast('Notiz ist leer'); await db.put('notes', { id: uid(), projectId: pid, created: Date.now(), updated: Date.now(), text: t, photoId: $('#nph').value || null }); await touchProject(pid); toast('Notiz gespeichert'); history.replaceState(null, '', `#/p/${pid}?tab=notes`); reload(); };
    $$('[data-edit]').forEach(b => b.onclick = async () => {
      const n = notes.find(x => x.id === b.dataset.edit);
      const r = await modal({ title: 'Notiz bearbeiten', fields: [{ name: 'text', label: 'Text', type: 'textarea', value: n.text }, { name: 'photoId', label: 'Foto', type: 'select', value: n.photoId || '', options: [{ value: '', label: '– kein Foto –' }, ...photos.map((x, i) => ({ value: x.id, label: `Foto ${i + 1}${x.caption ? ': ' + x.caption.slice(0, 40) : ''}` }))] }],
        buttons: [{ label: 'Löschen', value: 'del', cls: 'danger' }, { label: 'Abbrechen', value: null }, { label: 'Speichern', value: 'ok', cls: 'primary' }] });
      if (r === 'del') { if (await confirmDlg('Notiz löschen?', n.text.slice(0, 80))) { await db.del('notes', n.id); reload(); } return; }
      if (r) { n.text = r.text.trim(); n.photoId = r.photoId || null; n.updated = Date.now(); await db.put('notes', n); reload(); }
    });
  }

  if (tab === 'aufmass') {
    const units = `<datalist id="units">${UNITS.map(u => `<option value="${u}">`).join('')}</datalist>`;
    const row = (r, i) => { const ph = photos.find(x => x.id === r.photoId); const it = ph?.measure?.items?.find(x => x.id === r.itemId);
      return `<div class="am-row" data-id="${r.id}"><input class="inp" data-k="pos" value="${esc(r.pos)}" aria-label="Position">
      <input class="inp" data-k="bez" value="${esc(r.bez)}" placeholder="Bezeichnung" aria-label="Bezeichnung">
      <div class="l2"><input class="inp" data-k="menge" inputmode="decimal" value="${esc(r.expr ?? (r.menge != null && r.menge !== '' ? fmtNum(r.menge, 2) : ''))}" placeholder="Menge (z. B. 12,5*2)" aria-label="Menge">
      <input class="inp" data-k="einheit" list="units" value="${esc(r.einheit)}" placeholder="Einheit" aria-label="Einheit">
      <button class="ib" data-mv="-1" aria-label="nach oben">↑</button><button class="ib" data-mv="1" aria-label="nach unten">↓</button><button class="ib" data-del aria-label="Löschen">🗑</button></div>
      <div class="src">= <b data-res>${r.menge != null && r.menge !== '' ? fmtNum(r.menge, 2) : '–'}</b> ${esc(r.einheit || '')}${ph ? ` · aus <a href="#/measure/${ph.id}">Foto ${no.get(ph.id)}${it ? ' – ' + esc(it.name) : ''}</a>${r.manual ? ' (manuell geändert)' : ''}` : ''}${r.sketchId ? ` · <a href="#/sketch/${r.sketchId}">Skizze${r.calc?.faceLabel ? ' ' + esc(r.calc.faceLabel) : ''}</a>` : ''}${String(r.einheit || '').trim() === 'm²' && r.menge != null && r.menge !== '' && isFinite(+r.menge) ? ` · <label class="chk" style="display:inline-flex;min-height:0"><input type="checkbox" data-pick value="${esc(r.id)}"> zur Auswahl</label>` : ''}</div>
      ${r.calc ? `<pre class="calc">${esc(formatCalcText({ pos: r.pos, name: r.bez, calc: r.calc }))}</pre>` : ''}</div>`; };
    T.innerHTML = `${units}<div id="amlist">${am.map(row).join('') || '<div class="empty">Noch keine Positionen. Manuell anlegen, im Foto messen oder in der Skizze rechnen.</div>'}</div>
      <div class="grid2"><button class="btn primary" id="amAdd">＋ Position</button><button class="btn" id="amSketch">📐 Aus Skizzen</button></div>
      <div id="skImp"></div>
      <button class="btn block" id="amSum" style="margin-top:8px">Gesamtfläche aus Auswahl</button>
      <button class="btn block" id="openSketch" style="margin-top:8px">Flächenskizze</button>
      <p class="small">Flächen entstehen im Zeichen-Editor: Foto oder leeres Blatt, Kante antippen, Maß eintragen, Ecke als rechten Winkel festlegen.</p>
      <p class="small" style="margin-top:12px">Einzelmaße werden nicht zu einer pauschalen Summe addiert. Eine Gesamtfläche entsteht nur aus angehakten, fachlich gleichen m²-Flächen. Rechenausdrücke wie <code>2*4,5+1,2</code> sind möglich.</p>`;
    $('#amAdd').onclick = async () => { const n = am.length + 1; await db.put('aufmass', { id: uid(), projectId: pid, order: Date.now(), pos: String(n).padStart(2, '0'), bez: '', menge: null, expr: '', einheit: 'm²' }); reload(); };
    $('#amSketch').onclick = () => sketchImport(pid, photos, reload);
    $('#openSketch').onclick = () => go(`#/p/${pid}?tab=sketches`);
    $('#amSum').onclick = async () => {
      const ids = new Set([...T.querySelectorAll('[data-pick]:checked')].map(el => el.value));
      const sel = am.filter(r => ids.has(r.id));
      const calc = sumSelected(sel);
      if (!calc.ok) return toast(calc.missing[0]);
      const n = am.reduce((m, r) => Math.max(m, parseInt(r.pos, 10) || 0), 0) + 1;
      await db.put('aufmass', { id: uid(), projectId: pid, order: Date.now(), pos: String(n).padStart(2, '0'), bez: 'Gesamtfläche Auswahl', menge: calc.result, expr: fmtNum(calc.result, 2), einheit: 'm²', manual: false, calc });
      toast('Gesamtfläche angelegt'); reload();
    };
    $('#amlist').addEventListener('change', async e => {
      const el = e.target.closest('[data-k]'); if (!el) return; const box = el.closest('.am-row'); const r = am.find(x => x.id === box.dataset.id);
      const k = el.dataset.k;
      if (k === 'menge') { const v = el.value.trim(); const n = parseNum(v); if (v && !isFinite(n)) { toast('Menge ungültig'); el.focus(); return; } r.expr = v; r.menge = v ? n : null; if (r.photoId || r.faceId) r.manual = true; box.querySelector('[data-res]').textContent = v ? fmtNum(n, 2) : '–'; }
      else r[k] = el.value.trim();
      await db.put('aufmass', r);
      await resyncProjectSketches(pid);
      reload();
    });
    $('#amlist').addEventListener('click', async e => {
      const box = e.target.closest('.am-row'); if (!box) return; const i = am.findIndex(x => x.id === box.dataset.id); const r = am[i];
      if (e.target.closest('[data-pick]')) return;
      if (e.target.closest('[data-del]')) { if (await confirmDlg('Position löschen?', `${r.pos} ${r.bez}`)) { await db.del('aufmass', r.id); if (r.photoId) { const ph = await db.get('photos', r.photoId); const it = ph?.measure?.items?.find(x => x.aufmassId === r.id); if (it) { it.aufmassId = null; await db.put('photos', ph); } } reload(); } }
      const mv = e.target.closest('[data-mv]'); if (mv) { const j = i + +mv.dataset.mv; if (j < 0 || j >= am.length) return; [am[i], am[j]] = [am[j], am[i]]; for (let n = 0; n < am.length; n++) { am[n].order = n; await db.put('aufmass', am[n]); } reload(); }
    });
  }

  if (tab === 'sketches') {
    T.innerHTML = `<h2 class="sec" style="text-transform:none;color:inherit;font-size:1.25rem">Skizze</h2>
      <div class="grid2"><button class="btn" id="editPhotos">Foto bearbeiten</button><button class="btn primary" id="newSheet">Neue Skizze auf leerem Blatt</button></div>
      <p class="small">Freie Skizze (leeres Blatt) und Zeichnen auf einem Foto nutzen denselben Editor. Flächenskizzen aus älteren Versionen öffnen sich ebenfalls dort.</p>
      <div id="sheetList" style="margin-top:10px">${sheets.map(s => `<div class="card" style="display:flex;align-items:center;gap:8px"><div class="meta" style="flex:1" data-nav="#/sheet/${s.id}"><div class="t">${esc(s.title || 'Freie Skizze')}</div><div class="small">${(s.strokes || []).length} Striche</div></div><button type="button" class="btn danger del" data-del-sheet="${s.id}">Löschen</button></div>`).join('') || '<p class="small">Noch kein leeres Blatt.</p>'}
      <h3 class="sec">Flächenskizze</h3>
      <div id="skList">${sketches.map(s => `<div class="card" data-nav="#/sketch/${s.id}"><div class="meta"><div class="t">${esc(s.title || 'Flächenskizze')}</div><div class="small">${(s.faces || []).length} Flächen · ${(s.edges || []).length} Kanten</div></div></div>`).join('') || '<p class="small">Keine ältere Flächenskizze.</p>'}</div>`;
    $('#editPhotos').onclick = () => go(`#/p/${pid}?tab=photos`);
    $('#newSheet').onclick = () => newSheet(pid);
  }

  if (tab === 'export') {
    const s = await settings();
    T.innerHTML = `<div class="card"><h3 style="margin:0 0 8px">PDF-Bericht</h3>
      <label class="chk"><input type="checkbox" id="oPh" checked> Fotos (${photos.length})</label>
      <label class="chk"><input type="checkbox" id="oSt" ${s.pdfStamped ? 'checked' : ''}> Fotos mit Zeit-/Ortsstempel</label>
      <label class="chk"><input type="checkbox" id="oNo" checked> Notizen (${notes.length})</label>
      <label class="chk"><input type="checkbox" id="oAm" checked> Aufmaß-Tabelle (${am.length})</label>
      <label class="chk"><input type="checkbox" id="oMi" checked> Aufmaß-Bilder mit Bemaßung (${photos.filter(x => x.measure?.items?.length).length})</label>
      <label class="chk"><input type="checkbox" id="oSk" checked> Flächenskizzen und Rechenwege (${sketches.length})</label>
      <label class="chk"><input type="checkbox" id="oSheet" checked> Freie Skizzen (${sheets.length})</label>
      <button class="btn primary block" id="mkPdf" style="margin-top:8px">📄 PDF erstellen</button><div id="pdfOut" style="margin-top:10px"></div></div>
      <div class="card"><h3 style="margin:0 0 8px">Datensicherung</h3><p class="small">Projekt mit allen Fotos, Skizzen, Ausgangsbildern, Notizen, Aufmaß und Rechenwegen als ZIP sichern. Import über ⚙ Einstellungen.</p>
      <button class="btn block" id="mkZip">💾 Projekt-Backup (ZIP)</button><div id="zipOut" style="margin-top:10px"></div></div>`;
    $('#mkPdf').onclick = async () => {
      const b = $('#mkPdf'); b.disabled = true; const out = $('#pdfOut'); out.textContent = 'PDF wird erstellt …';
      try {
        const opts = { includePhotos: $('#oPh').checked, stamped: $('#oSt').checked, includeNotes: $('#oNo').checked, includeAufmass: $('#oAm').checked, includeMeasureImgs: $('#oMi').checked, includeSketches: $('#oSk').checked, includeSheets: $('#oSheet').checked };
        const fresh = await settings();
        const blob = await buildPdf({ project: p, photos, notes, aufmass: am, sketches, sheets, settings: fresh, opts, progress: t => out.textContent = 'PDF wird erstellt … ' + t });
        const name = `Baudoku_${safeName(p.name)}_${isoDate()}.pdf`;
        window.__baudoku.lastPdf = blob;
        showFileActions(out, blob, name, `Baudokumentation ${p.name}`);
      } catch (e) { console.error(e); out.textContent = 'Fehler beim PDF-Export: ' + e.message; }
      b.disabled = false;
    };
    $('#mkZip').onclick = async () => {
      const b = $('#mkZip'); b.disabled = true; const out = $('#zipOut'); out.textContent = 'Backup wird erstellt …';
      try {
        const blob = await exportZip([pid]);
        const name = `Baudoku_Backup_${safeName(p.name)}_${isoDate()}.zip`;
        showFileActions(out, blob, name, `Backup ${p.name}`);
        toast(`Backup erstellt (${fmtBytes(blob.size)})`);
      } catch (e) { console.error(e); out.textContent = 'Fehler beim Backup: ' + e.message; }
      b.disabled = false;
    };
  }
}

/** Teilen + Herunterladen für eine erzeugte PDF- oder ZIP-Datei. Teilen nutzt das Systemmenü, sonst den Download. */
function showFileActions(el, blob, name, title) {
  el.innerHTML = `<p class="small">✓ ${esc(name)} (${fmtBytes(blob.size)})</p>
    <div class="row">
      <button type="button" class="btn primary" data-act="share">Teilen</button>
      <button type="button" class="btn" data-act="download">Herunterladen</button>
    </div>
    <p class="small">Teilen öffnet das Menü des Handys (Google Drive, Mail, WhatsApp …), wenn der Browser diese Datei teilen kann. Sonst startet der Download.</p>`;
  el.querySelector('[data-act="share"]').onclick = async () => {
    const r = await shareOrDownload(blob, name, title);
    if (r === 'shared') toast('Datei geteilt');
    else if (r === 'download') toast('Download gestartet');
  };
  el.querySelector('[data-act="download"]').onclick = () => { downloadBlob(blob, name); toast('Download gestartet'); };
}

/* Aufmaß-Zeile aus Messung anlegen/aktualisieren */
async function upsertAm(ph, it, v) {
  let r = it.aufmassId && await db.get('aufmass', it.aufmassId);
  if (!r) { const all = await db.byProject('aufmass', ph.projectId); r = { id: uid(), projectId: ph.projectId, order: Date.now(), pos: String(all.length + 1).padStart(2, '0'), photoId: ph.id, itemId: it.id }; }
  r.bez = it.name; r.menge = Math.round(v.value * 100) / 100; r.expr = fmtNum(r.menge, 2); r.einheit = v.unit; r.manual = false;
  await db.put('aufmass', r); return r.id;
}
async function syncAm(ph) {
  for (const it of ph.measure?.items || []) {
    if (!it.aufmassId) continue; const r = await db.get('aufmass', it.aufmassId); if (!r || r.manual) continue;
    const v = measureValue(ph.measure, it); if (!v) continue; const nv = Math.round(v.value * 100) / 100;
    if (r.menge !== nv || r.bez !== it.name) { r.menge = nv; r.expr = fmtNum(nv, 2); r.bez = it.name; r.einheit = v.unit; await db.put('aufmass', r); }
  }
}

/* ---------- Foto-Detail ---------- */
async function viewPhoto(id) {
  const ph = await db.get('photos', id); if (!ph) return go('#/');
  const all = (await db.byProject('photos', ph.projectId)).sort((a, b) => a.time - b.time || a.created - b.created);
  const i = all.findIndex(x => x.id === id), prev = all[i - 1], next = all[i + 1];
  const notes = (await db.byProject('notes', ph.projectId)).filter(n => n.photoId === id);
  const p = await db.get('projects', ph.projectId);
  const items = ph.measure?.items || [];
  APP.innerHTML = header(`Foto ${i + 1} / ${all.length}`, { back: `#/p/${ph.projectId}?tab=photos`, sub: p?.name, right: `<button class="ib" ${prev ? `data-nav="#/photo/${prev.id}"` : 'disabled'} aria-label="Vorheriges">‹</button><button class="ib" ${next ? `data-nav="#/photo/${next.id}"` : 'disabled'} aria-label="Nächstes">›</button>` }) +
    `<main><img class="photo-full" id="pimg" src="${url(ph.stamped)}" alt="Foto">
    <button class="btn primary block" id="drawOpen" style="margin-top:8px">✎ Zeichnen${ph.markup?.strokes?.length ? ` (${ph.markup.strokes.length})` : ''}</button>
    <div class="row" style="margin:8px 0"><button class="btn sm" data-v="stamped">Mit Stempel</button><button class="btn sm" data-v="original">Original</button></div>
    <label class="f">Bildbeschreibung<textarea class="inp" id="cap" style="min-height:70px" placeholder="z. B. Kehle Nordseite, Ziegel gebrochen">${esc(ph.caption)}</textarea></label>
    <div class="grid2"><button class="btn primary" data-nav="#/measure/${id}">📐 Aufmaß${items.length ? ` (${items.length})` : ''}</button><button class="btn" data-nav="#/p/${ph.projectId}?tab=notes&photo=${id}">📝 Notiz</button></div>
    <div class="card" style="margin-top:10px"><div class="kv"><b>Aufnahme</b><span>${fmtDateTime(ph.time, true)}${ph.timeKind === 'import' ? ' (Importzeit)' : ph.timeKind === 'exif' ? ' (Bilddatum)' : ph.source === 'gallery' ? ' (aus Galerie)' : ''}</span>
      <b>GPS</b><span>${ph.lat != null ? `<a href="https://www.openstreetmap.org/?mlat=${ph.lat}&mlon=${ph.lon}#map=19/${ph.lat}/${ph.lon}" target="_blank" rel="noopener">${fmtCoord(ph.lat, ph.lon)}</a>${ph.acc != null ? ` ±${fmtNum(ph.acc, 0)} m` : ''}` : 'nicht verfügbar'}</span>
      <b>Adresse</b><span>${esc(ph.address || '–')}</span><b>Größe</b><span>${ph.width} × ${ph.height} px</span></div></div>
    ${items.length ? `<div class="card"><b>Messungen</b><div class="mlist">${items.map(it => `<div class="mi"><span class="n">${esc(it.name)}</span><span class="v">${fmtVal(measureValue(ph.measure, it))}</span></div>`).join('')}</div></div>` : ''}
    ${notes.length ? `<div class="card"><b>Notizen zum Foto</b>${notes.map(n => `<div class="note small" style="margin-top:8px"><b>${fmtDateTime(n.created)}</b><br>${esc(n.text)}</div>`).join('')}</div>` : ''}
    <div class="grid2"><button class="btn" id="reSt">🔄 Stempel neu</button><button class="btn" id="reLoc">📍 Standort jetzt</button>
    <button class="btn" id="dl">⬇ Speichern</button><button class="btn" id="cover">⭐ Titelbild</button></div>
    <button class="btn danger block" id="delPh" style="margin-top:8px">🗑 Foto löschen</button></main>`;
  let capT; $('#cap').addEventListener('input', e => { clearTimeout(capT); capT = setTimeout(async () => { ph.caption = e.target.value; await db.put('photos', ph); }, 400); });
  let deleted = false;
  cleanup.push(() => { clearTimeout(capT); if (deleted) return; const v = $('#cap')?.value; if (v != null && v !== ph.caption) { ph.caption = v; db.put('photos', ph); } });
  $$('[data-v]').forEach(b => b.onclick = () => { $('#pimg').src = url(ph[b.dataset.v]); });
  $('#drawOpen').onclick = () => go(`#/draw/${id}`);
  $('#reSt').onclick = async () => { toast('Stempel wird erzeugt …'); ph.caption = $('#cap').value; await restamp(ph); toast('Stempel aktualisiert'); route(); };
  $('#reLoc').onclick = async () => { if (!await confirmDlg('Standort ersetzen?', 'Aktuellen GPS-Standort für dieses Foto übernehmen und Stempel neu erzeugen?', 'Übernehmen', 'primary')) return; toast('Standort wird ermittelt …'); const f = await getFix(15000); if (!f) return toast('Kein GPS verfügbar'); Object.assign(ph, { lat: f.lat, lon: f.lon, acc: f.acc, address: '' }); ph.caption = $('#cap').value; await restamp(ph); toast('Standort aktualisiert'); route(); };
  $('#dl').onclick = () => downloadBlob(ph.stamped, `${safeName(p?.name)}_Foto${i + 1}.jpg`);
  $('#cover').onclick = async () => { p.coverPhotoId = id; await db.put('projects', p); toast('Als Titelbild gesetzt'); };
  $('#delPh').onclick = async () => { if (!await confirmDlg('Foto löschen?', 'Foto inkl. Messungen wird gelöscht. Verknüpfte Aufmaß-Positionen bleiben als manuelle Werte erhalten.')) return; deleted = true; await db.del('photos', id); for (const n of notes) { n.photoId = null; await db.put('notes', n); } for (const r of (await db.byProject('aufmass', ph.projectId)).filter(r => r.photoId === id)) { r.photoId = null; await db.put('aufmass', r); } toast('Foto gelöscht'); go(`#/p/${ph.projectId}?tab=photos`); };
}

/* ---------- Aufmaß-Editor ---------- */
async function viewMeasure(id) {
  const ph = await db.get('photos', id); if (!ph) return go('#/');
  const img = await loadImg(ph.original); cleanup.push(() => URL.revokeObjectURL(img._url));
  APP.innerHTML = '<div id="me"></div>';
  const ed = mountEditor($('#me'), {
    img, measure: ph.measure || emptyMeasure(), title: ph.caption || fmtDateTime(ph.time),
    onChange: async m => { const cur = await db.get('photos', id); if (!cur) return; cur.measure = m; await db.put('photos', cur); await syncAm(cur); },
    onToAufmass: async (it, v) => { const cur = await db.get('photos', id); return upsertAm(cur, it, v); },
    onRectify: async m => {
      toast('Draufsicht wird berechnet …', 8000);
      await new Promise(r => setTimeout(r, 30));
      try {
        const { canvas, measure } = rectify(img, m, 2000);
        const blob = await canvasToBlob(canvas, 'image/jpeg', 0.9); const cur = await db.get('photos', id);
        const rec = await addPhoto(ph.projectId, blob, 'rectified');
        Object.assign(rec, { time: cur.time, lat: cur.lat, lon: cur.lon, acc: cur.acc, address: cur.address, caption: `Entzerrt: ${cur.caption || 'Foto'}`, measure });
        await restamp(rec); toast('Entzerrte Draufsicht gespeichert'); go(`#/measure/${rec.id}`);
      } catch (e) { console.error(e); toast('Entzerrung fehlgeschlagen: ' + e.message); }
    },
    onBack: () => go(`#/photo/${id}`),
  });
  cleanup.push(() => ed.destroy());
  window.__baudoku.editor = ed;
}

/* ---------- Einstellungen ---------- */
let installEvt = null; window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; });
async function viewSettings() {
  const s = await settings(); let est = '';
  try { const e = await navigator.storage.estimate(); est = `${fmtBytes(e.usage)} belegt von ca. ${fmtBytes(e.quota)}`; } catch (e) { }
  const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : false;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  APP.innerHTML = header('Einstellungen', { back: '#/' }) + `<main><form class="card" id="sf">
    <label class="f">Firma (Stempel/PDF, optional)<input name="firma" value="${esc(s.firma)}" placeholder="Leer lassen oder eigenen Namen eintragen"></label>
    <label class="f">Bearbeiter<input name="bearbeiter" value="${esc(s.bearbeiter)}"></label>
    <label class="chk"><input type="checkbox" name="stampFirma" ${s.stampFirma ? 'checked' : ''}> Firma im Fotostempel</label>
    <label class="chk"><input type="checkbox" name="geocode" ${s.geocode ? 'checked' : ''}> Adresse online ermitteln (OpenStreetMap)</label>
    <label class="chk"><input type="checkbox" name="pdfStamped" ${s.pdfStamped ? 'checked' : ''}> PDF standardmäßig mit Stempel</label>
    <div class="f">Farbe Kopfleiste<div class="head-colors" id="headColors">${Object.entries(HEADER_COLORS).map(([id, c]) => `<button type="button" data-head="${id}" aria-pressed="${(s.header || 'blue') === id ? 'true' : 'false'}" style="background:${c.bg};color:${c.fg}">${c.name}</button>`).join('')}</div></div>
    <button class="btn primary block" type="submit">Speichern</button></form>
    <div class="card"><h3 style="margin:0 0 8px">Datensicherung</h3><p class="small">Alle Daten liegen nur auf diesem Gerät. Regelmäßig sichern!</p>
    <div class="grid2"><button class="btn" id="bakAll">💾 Alles sichern</button><button class="btn" id="imp">📥 Importieren</button></div>
    <div id="bakOut" style="margin-top:10px"></div></div>
    <div class="card"><h3 style="margin:0 0 8px">App</h3><p class="small">Speicher: ${esc(est || 'unbekannt')}${persisted ? ' · dauerhaft' : ''}<br>
    ${ios ? 'Installieren: in Safari „Teilen“ → „Zum Home-Bildschirm“.' : 'Installieren: Browser-Menü → „App installieren“ / „Zum Startbildschirm hinzufügen“.'}<br>
    Kamera, GPS und Offline-Modus benötigen HTTPS (oder localhost).</p>
    <button class="btn block ${installEvt ? '' : 'hide'}" id="inst">📲 App installieren</button>
    <p class="small">Baudoku v1.7.5 · Kartendaten/Adressen © OpenStreetMap-Mitwirkende</p></div></main>`;
  let headerId = HEADER_COLORS[s.header] ? s.header : 'blue';
  const readForm = () => {
    const f = $('#sf');
    return { firma: f.firma.value.trim(), bearbeiter: f.bearbeiter.value.trim(), stampFirma: f.stampFirma.checked, geocode: f.geocode.checked, pdfStamped: f.pdfStamped.checked, header: headerId };
  };
  const paintSwatches = () => $$('#headColors button').forEach(b => { b.setAttribute('aria-pressed', b.dataset.head === headerId ? 'true' : 'false'); });
  $$('#headColors button').forEach(b => b.onclick = async () => {
    headerId = HEADER_COLORS[b.dataset.head] ? b.dataset.head : 'blue';
    applyHeader(headerId);
    paintSwatches();
    await db.setSetting('app', readForm());
  });
  $('#sf').addEventListener('submit', async e => { e.preventDefault(); await db.setSetting('app', readForm()); toast('Gespeichert'); });
  $('#bakAll').onclick = async () => {
    const ps = await db.all('projects'); if (!ps.length) return toast('Keine Projekte');
    const b = $('#bakAll'); b.disabled = true; const out = $('#bakOut'); out.textContent = 'Backup wird erstellt …';
    try {
      const blob = await exportZip(ps.map(p => p.id));
      const name = `Baudoku_Backup_alle_${isoDate()}.zip`;
      showFileActions(out, blob, name, 'Baudoku Backup');
      toast(`Backup erstellt (${fmtBytes(blob.size)})`);
    } catch (e) { console.error(e); out.textContent = 'Fehler beim Backup: ' + e.message; }
    b.disabled = false;
  };
  const inp = $('#in-import');
  $('#imp').onclick = () => inp.click();
  inp.onchange = async () => { const f = inp.files[0]; inp.value = ''; if (!f) return; try { toast('Import läuft …', 10000); const n = await importFile(f); toast(`${n} Projekt(e) importiert`); go('#/'); } catch (e) { console.error(e); toast('Import fehlgeschlagen: ' + e.message, 5000); } };
  $('#inst').onclick = async () => { if (installEvt) { installEvt.prompt(); installEvt = null; } };
}

async function newSheet(pid) {
  const r = await modal({ title: 'Freie Skizze', html: '<p>Leeres Blatt zum Zeichnen. Der Titel ist freiwillig.</p>', fields: [{ name: 'title', label: 'Titel (optional)', placeholder: 'Freie Skizze' }], buttons: [{ label: 'Abbrechen', value: null }, { label: 'Blatt anlegen', value: 'ok', cls: 'primary' }] });
  if (!r) return;
  const all = await db.byProject('sheets', pid);
  const sheet = { id: uid(), projectId: pid, created: Date.now(), updated: Date.now(), title: (r.title || '').trim() || `Freie Skizze ${all.length + 1}`, width: 1000, height: 1400, strokes: [] };
  await db.put('sheets', sheet);
  await touchProject(pid);
  go(`#/sheet/${sheet.id}`);
}
async function deleteSheetFlow(id) {
  const s = await db.get('sheets', id); if (!s) return;
  if (!await confirmDlg('Skizze löschen?', `„${s.title || 'Freie Skizze'}“ wird gelöscht. Das Projekt und die Fotos bleiben.`)) return;
  await db.del('sheets', id);
  toast('Skizze gelöscht');
  go(`#/p/${s.projectId}?tab=sketches`);
}
async function viewSheet(id) {
  const sheet = await db.get('sheets', id); if (!sheet) return go('#/');
  APP.innerHTML = '<div id="drawroot"></div>';
  const ed = mountDraw($('#drawroot'), { sheet, onBack: () => go(`#/p/${sheet.projectId}?tab=sketches`) });
  cleanup.push(() => ed.destroy());
  window.__baudoku.draw = ed;
}
async function viewDraw(id) {
  const ph = await db.get('photos', id); if (!ph) return go('#/');
  const blob = ph.stamped || ph.original;
  const img = await loadImg(blob); cleanup.push(() => URL.revokeObjectURL(img._url));
  APP.innerHTML = '<div id="drawroot"></div>';
  const ed = mountDraw($('#drawroot'), { photo: ph, img, onBack: () => go(`#/photo/${id}`) });
  cleanup.push(() => ed.destroy());
  window.__baudoku.draw = ed;
}
async function viewSketch(id) {
  const sk = await db.get('sketches', id); if (!sk) return go('#/');
  const blob = sk.sourceImage;
  const img = blob ? await loadImg(blob) : null;
  if (img) cleanup.push(() => URL.revokeObjectURL(img._url));
  APP.innerHTML = '<div id="drawroot"></div>';
  const ed = mountDraw($('#drawroot'), { sketch: sk, img, onBack: () => go(`#/p/${sk.projectId}?tab=sketches`) });
  cleanup.push(() => ed.destroy());
  window.__baudoku.draw = ed;
}

/* ---------- Start ---------- */
function showUpdateBar(reg) {
  if (document.getElementById('sw-update')) return;
  const bar = document.createElement('button');
  bar.id = 'sw-update'; bar.type = 'button'; bar.textContent = 'Neue Version – neu laden';
  bar.onclick = () => { const w = reg.waiting; if (w) w.postMessage('skip-waiting'); else location.reload(); };
  document.body.appendChild(bar);
}
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  // Relativ zur Seite, Scope = Verzeichnis der App (funktioniert unter /baudoku/ und an der Domain-Wurzel).
  const scopeUrl = new URL('./', document.baseURI);
  const swUrl = new URL('sw.js', scopeUrl);
  let hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) { hadController = true; return; }
    location.reload();
  });
  navigator.serviceWorker.register(swUrl, { scope: scopeUrl.href }).then((reg) => {
    const poke = () => { if (reg.waiting && navigator.serviceWorker.controller) showUpdateBar(reg); };
    poke();
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing; if (!nw) return;
      nw.addEventListener('statechange', () => { if (nw.state === 'installed') poke(); });
    });
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data?.type === 'NEW_VERSION' && e.data.version !== APP_VERSION) showUpdateBar(reg);
    });
  }).catch(e => console.warn('SW', e));
}
settings().then((s) => applyHeader(s.header)).catch(() => {}).finally(() => route());
