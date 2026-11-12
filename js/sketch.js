// Dachskizze: Zuschnitt, Nachzeichnen, lokale Kantenvorschläge, Maße, Rechenweg.
import * as db from './db.js';
import { uid, modal, parseNum, toast, esc, canvasToBlob } from './util.js';
import { detectFromImageData } from './detect.js';
import {
  ROLES, roleLabel, isLengthUnit, nextEdgeLabel, nextFaceLabel, reliableScale, scaleWarning,
  resolveEdgeLength, computeFace, formatCalcText, fmtM,
} from './sketch-calc.js';

export function emptySketch(projectId) {
  return {
    id: uid(), projectId, created: Date.now(), updated: Date.now(), title: 'Skizze',
    viewKind: 'unknown', vertices: [], edges: [], faces: [],
    scale: { mode: 'none', refEdgeId: null, refLengthM: null, persp: null },
    cropApplied: false, technical: true, sourcePhotoId: null, sourceImage: null,
  };
}

export async function syncSketchCalcs(sketch) {
  const rows = await db.byProject('aufmass', sketch.projectId);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered = [...(sketch.faces || []).filter((f) => !f.isComposite), ...(sketch.faces || []).filter((f) => f.isComposite)];
  for (const face of ordered) {
    const calc = computeFace(sketch, face, byId);
    face.lastCalc = calc;
    let row = face.aufmassId && byId.get(face.aufmassId);
    if (!calc.ok) {
      if (row && !row.manual) {
        row.calc = calc; row.menge = null; row.expr = ''; row.sketchId = sketch.id; row.faceId = face.id;
        await db.put('aufmass', row);
      }
      continue;
    }
    if (row?.manual) { row.calc = calc; await db.put('aufmass', row); continue; }
    if (!row) {
      row = { id: uid(), projectId: sketch.projectId, order: Date.now(), pos: nextPos(rows), einheit: 'm²', manual: false };
      rows.push(row); byId.set(row.id, row); face.aufmassId = row.id;
    }
    row.bez = `${face.isDeduction ? 'Abzug' : 'Dachfläche'} ${face.label}`;
    row.menge = calc.result;
    row.expr = fmtM(calc.result);
    row.einheit = 'm²';
    row.sketchId = sketch.id;
    row.faceId = face.id;
    row.calc = calc;
    row.manual = false;
    await db.put('aufmass', row);
  }
  sketch.updated = Date.now();
  await db.put('sketches', sketch);
  return sketch;
}
export async function resyncProjectSketches(projectId) {
  const list = await db.byProject('sketches', projectId);
  for (const sk of list) await syncSketchCalcs(sk);
}
function nextPos(rows) {
  const n = rows.reduce((m, r) => Math.max(m, parseInt(r.pos, 10) || 0), 0) + 1;
  return String(n).padStart(2, '0');
}

function drawSketch(ctx, sketch, T, o) {
  const byId = o.aufmassById || new Map();
  const fs = o.fs || 16;
  const verts = sketch.vertices || [];
  const pt = (id) => verts.find((v) => v.id === id);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  (sketch.faces || []).forEach((f) => {
    const pts = (f.vertexIds || []).map(pt).filter(Boolean);
    if (pts.length < 3) return;
    ctx.beginPath();
    pts.forEach((p, i) => { const [x, y] = T(p.x, p.y); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.closePath();
    ctx.fillStyle = f.isDeduction ? 'rgba(201,42,42,.18)' : 'rgba(232,89,12,.16)';
    ctx.fill();
  });
  const boxes = [];
  const labelAt = (x, y, text) => {
    ctx.font = `700 ${fs}px system-ui, sans-serif`;
    const w = ctx.measureText(text).width + fs * 0.7, h = fs * 1.35;
    let px = x, py = y;
    for (let n = 0; n < 8; n++) {
      const hit = boxes.some((b) => Math.abs(b.x - px) < (b.w + w) / 2 && Math.abs(b.y - py) < (b.h + h) / 2);
      if (!hit) break;
      py += h * 0.85;
    }
    boxes.push({ x: px, y: py, w, h });
    const x0 = px - w / 2, y0 = py - h / 2, r = 6;
    ctx.beginPath();
    ctx.moveTo(x0 + r, y0); ctx.arcTo(x0 + w, y0, x0 + w, y0 + h, r); ctx.arcTo(x0 + w, y0 + h, x0, y0 + h, r);
    ctx.arcTo(x0, y0 + h, x0, y0, r); ctx.arcTo(x0, y0, x0 + w, y0, r); ctx.closePath();
    ctx.fillStyle = 'rgba(20,24,29,.88)'; ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, px, py + 1);
  };
  (sketch.edges || []).forEach((e) => {
    const a = pt(e.v1), b = pt(e.v2); if (!a || !b) return;
    const A = T(a.x, a.y), B = T(b.x, b.y);
    ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]);
    ctx.strokeStyle = o.selectedEdge === e.id ? '#e8590c' : '#1f2933';
    ctx.lineWidth = o.selectedEdge === e.id ? Math.max(4, fs / 5) : Math.max(2.5, fs / 7);
    ctx.stroke();
    const len = resolveEdgeLength(sketch, e, byId);
    const text = len ? `${e.label} = ${fmtM(len.m)} m` : e.label;
    const mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2;
    const dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy) || 1;
    labelAt(mx + (-dy / L) * fs * 1.15, my + (dx / L) * fs * 1.15, text);
  });
  (sketch.faces || []).forEach((f) => {
    const pts = (f.vertexIds || []).map(pt).filter(Boolean);
    if (pts.length < 3) return;
    let sx = 0, sy = 0; pts.forEach((p) => { const [x, y] = T(p.x, p.y); sx += x; sy += y; });
    labelAt(sx / pts.length, sy / pts.length, f.label + (f.isDeduction ? ' Abzug' : ''));
  });
  verts.forEach((v) => {
    const [x, y] = T(v.x, v.y);
    ctx.beginPath(); ctx.arc(x, y, Math.max(5, fs / 3), 0, 7);
    ctx.fillStyle = o.selectedVertex === v.id ? '#e8590c' : '#fff';
    ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#1f2933'; ctx.stroke();
  });
  if (o.draft?.length) {
    ctx.setLineDash([6, 4]); ctx.beginPath();
    o.draft.forEach((id, i) => { const p = pt(id); if (!p) return; const [x, y] = T(p.x, p.y); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.strokeStyle = '#e8590c'; ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]);
  }
}

export function renderSketch(img, sketch, aufmassById, max = 1600) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const k = Math.min(1, max / Math.max(iw, ih));
  const c = document.createElement('canvas');
  c.width = Math.max(2, Math.round(iw * k)); c.height = Math.max(2, Math.round(ih * k));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.save(); ctx.globalAlpha = sketch.technical === false ? 1 : 0.3;
  ctx.drawImage(img, 0, 0, c.width, c.height); ctx.restore();
  drawSketch(ctx, sketch, (x, y) => [x * k, y * k], { fs: Math.max(18, c.width / 40), aufmassById });
  return c;
}

export function mountSketch(root, { sketch, img, onBack }) {
  let tool = 'point';
  let selectedVertex = null, selectedEdge = null, draft = [], edgeStart = null, drag = null, view = { s: 1, ox: 0, oy: 0 };
  let rows = [];
  const el = document.createElement('div'); el.className = 'sk';
  el.innerHTML = `<header class="hdr"><button type="button" class="ib" id="skBack" aria-label="Zurück">←</button><h1>${esc(sketch.title || 'Skizze')}</h1></header>
    <div class="status" id="skWarn"></div>
    <canvas id="skCanvas"></canvas>
    <div class="hint" id="skHint"></div>
    <div class="ctx" id="skCtx"></div>
    <pre class="calc" id="skCalc"></pre>
    <div class="tools" id="skTools"></div>`;
  root.appendChild(el);
  const canvas = el.querySelector('#skCanvas');
  const ctx = canvas.getContext('2d');
  const warn = el.querySelector('#skWarn');
  const hint = el.querySelector('#skHint');
  const ctxBar = el.querySelector('#skCtx');
  const calcBox = el.querySelector('#skCalc');
  const tools = el.querySelector('#skTools');
  const byId = () => new Map(rows.map((r) => [r.id, r]));

  async function reloadRows() { rows = await db.byProject('aufmass', sketch.projectId); }
  async function save(sync = true) {
    sketch.updated = Date.now();
    if (sync) await syncSketchCalcs(sketch); else await db.put('sketches', sketch);
    await reloadRows();
    paint();
  }
  function layout() {
    const r = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(2, Math.round(r.width * dpr));
    canvas.height = Math.max(2, Math.round(Math.max(r.height, 180) * dpr));
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const s = Math.min(canvas.width / iw, canvas.height / ih);
    view = { s, ox: (canvas.width - iw * s) / 2, oy: (canvas.height - ih * s) / 2 };
  }
  function paint() {
    layout();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = sketch.technical === false ? '#111' : '#f4f1ea';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.save(); ctx.globalAlpha = sketch.technical === false ? 1 : 0.35;
    ctx.drawImage(img, view.ox, view.oy, (img.naturalWidth || img.width) * view.s, (img.naturalHeight || img.height) * view.s);
    ctx.restore();
    drawSketch(ctx, sketch, (x, y) => [view.ox + x * view.s, view.oy + y * view.s], { fs: Math.max(14, canvas.width / 46), aufmassById: byId(), selectedVertex, selectedEdge, draft });
    if (!sketch.cropApplied && crop) drawCrop();
    warn.textContent = scaleWarning(sketch);
    const blocks = (sketch.faces || []).map((f) => f.lastCalc ? formatCalcText({ pos: rows.find((r) => r.id === f.aufmassId)?.pos || '', name: `${f.isDeduction ? 'Abzug' : 'Dachfläche'} ${f.label}`, calc: f.lastCalc }) : `${f.label}: noch nicht gerechnet`);
    calcBox.textContent = blocks.join('\n\n') || 'Noch keine Fläche. Eckpunkte setzen, Kanten schließen, dann Fläche anlegen.';
    if (paint.chrome !== false) renderChrome();
  }
  let crop = { x: 0, y: 0, w: img.naturalWidth || img.width, h: img.naturalHeight || img.height };
  function drawCrop() {
    const [x, y] = [view.ox + crop.x * view.s, view.oy + crop.y * view.s];
    const w = crop.w * view.s, h = crop.h * view.s;
    ctx.save(); ctx.fillStyle = 'rgba(0,0,0,.45)';
    ctx.beginPath(); ctx.rect(0, 0, canvas.width, canvas.height); ctx.rect(x, y, w, h); ctx.fill('evenodd');
    ctx.strokeStyle = '#ffd43b'; ctx.lineWidth = 3; ctx.strokeRect(x, y, w, h); ctx.restore();
  }
  function nearVertex(ix, iy) {
    let best = null, bd = 22;
    for (const v of sketch.vertices) { const d = Math.hypot(v.x - ix, v.y - iy); if (d < bd) { bd = d; best = v; } }
    return best;
  }
  function nearEdge(ix, iy) {
    let best = null, bd = 16;
    for (const e of sketch.edges) {
      const a = sketch.vertices.find((v) => v.id === e.v1), b = sketch.vertices.find((v) => v.id === e.v2);
      if (!a || !b) continue;
      const d = pointSeg(ix, iy, a, b);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
  function pointSeg(px, py, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
    let t = ((px - a.x) * dx + (py - a.y) * dy) / l2; t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
  }
  function toImage(ev) {
    const r = canvas.getBoundingClientRect();
    const cx = (ev.clientX - r.left) * (canvas.width / r.width);
    const cy = (ev.clientY - r.top) * (canvas.height / r.height);
    return [(cx - view.ox) / view.s, (cy - view.oy) / view.s];
  }
  function clientPoint(ix, iy) {
    const r = canvas.getBoundingClientRect();
    const cx = view.ox + ix * view.s, cy = view.oy + iy * view.s;
    return { x: r.left + cx / canvas.width * r.width, y: r.top + cy / canvas.height * r.height };
  }

  async function addVertex(x, y) {
    const v = { id: uid(), x, y, suggested: false };
    sketch.vertices.push(v); selectedVertex = v.id; await save(false); return v;
  }
  function ensureEdge(v1, v2) {
    if (v1 === v2) return null;
    let e = sketch.edges.find((e) => (e.v1 === v1 && e.v2 === v2) || (e.v1 === v2 && e.v2 === v1));
    if (e) return e;
    e = { id: uid(), label: nextEdgeLabel(sketch.edges), v1, v2, role: '', lengthM: null, aufmassId: null, lengthSource: 'manual' };
    sketch.edges.push(e); return e;
  }
  async function closeLoop() {
    const vs = sketch.vertices;
    if (vs.length < 3) return toast('Mindestens drei Eckpunkte');
    for (let i = 0; i < vs.length; i++) ensureEdge(vs[i].id, vs[(i + 1) % vs.length].id);
    await save(false); toast('Umriss geschlossen');
  }
  async function makeFace(vertexIds) {
    if (vertexIds.length < 3) return toast('Mindestens drei Ecken');
    const edgeIds = [];
    for (let i = 0; i < vertexIds.length; i++) {
      const e = ensureEdge(vertexIds[i], vertexIds[(i + 1) % vertexIds.length]);
      if (e) edgeIds.push(e.id);
    }
    const shape = vertexIds.length === 3 ? 'tri' : vertexIds.length === 4 ? 'rect' : 'poly';
    const face = {
      id: uid(), label: nextFaceLabel(sketch.faces), vertexIds: [...vertexIds], edgeIds, shape,
      edgeA: edgeIds[0] || null, edgeB: edgeIds[1] || null,
      baseEdgeId: edgeIds[0] || null, baseEdgeId2: edgeIds[2] || edgeIds[1] || null, heightEdgeId: null,
      areaMode: 'projection', slopeSource: 'pitch', pitchDeg: null, isDeduction: false, isComposite: false, partFaceIds: [],
    };
    const res = await faceDialog(face);
    if (!res) return;
    sketch.faces.push(face); draft = []; await save(true);
  }
  async function faceDialog(face) {
    const edgeOpts = sketch.edges.map((e) => ({ value: e.id, label: e.label }));
    const res = await modal({
      title: `Fläche ${face.label}`,
      fields: [
        { name: 'shape', label: 'Art', type: 'select', value: face.shape, options: [{ value: 'rect', label: 'Rechteck' }, { value: 'tri', label: 'Dreieck' }, { value: 'trap', label: 'Trapez' }, { value: 'poly', label: 'Vieleck' }] },
        { name: 'areaMode', label: 'Welche Fläche?', type: 'select', value: face.areaMode, options: [{ value: 'projection', label: 'Grundriss / Projektion' }, { value: 'sloped', label: 'Geneigte Dachfläche' }] },
        { name: 'slopeSource', label: 'Geneigt woraus?', type: 'select', value: face.slopeSource || 'pitch', options: [{ value: 'pitch', label: 'Dachneigung aus Grundrissmaßen' }, { value: 'edge', label: 'Eine Kante ist die schräge Dachlänge' }] },
        { name: 'pitch', label: 'Dachneigung in Grad', value: face.pitchDeg ?? '', inputmode: 'decimal' },
        { name: 'edgeA', label: 'Kante a (Rechteck / Basis)', type: 'select', value: face.edgeA || '', options: [{ value: '', label: '–' }, ...edgeOpts] },
        { name: 'edgeB', label: 'Kante b (Rechteck / zweite Seite)', type: 'select', value: face.edgeB || '', options: [{ value: '', label: '–' }, ...edgeOpts] },
        { name: 'base2', label: 'Zweite Parallelseite (Trapez)', type: 'select', value: face.baseEdgeId2 || '', options: [{ value: '', label: '–' }, ...edgeOpts] },
        { name: 'height', label: 'Höhe oder Diagonale', type: 'select', value: face.heightEdgeId || '', options: [{ value: '', label: '– fehlt noch –' }, ...edgeOpts] },
        { name: 'deduct', label: 'Abzug?', type: 'select', value: face.isDeduction ? '1' : '0', options: [{ value: '0', label: 'Nein, Dachfläche' }, { value: '1', label: 'Ja, Abzugsfläche' }] },
      ],
    });
    if (!res) return null;
    face.shape = res.shape; face.areaMode = res.areaMode; face.slopeSource = res.slopeSource;
    const p = parseNum(res.pitch); face.pitchDeg = isFinite(p) ? p : null;
    face.edgeA = res.edgeA || null; face.edgeB = res.edgeB || null;
    face.baseEdgeId = res.edgeA || null; face.baseEdgeId2 = res.base2 || null; face.heightEdgeId = res.height || null;
    face.isDeduction = res.deduct === '1';
    return face;
  }
  async function editEdge(edge) {
    await reloadRows();
    const lengthRows = rows.filter((r) => isLengthUnit(r.einheit) && !r.faceId);
    const res = await modal({
      title: `Kante ${edge.label}`,
      fields: [
        { name: 'meters', label: 'Maß in m', value: edge.lengthM ?? (resolveEdgeLength(sketch, edge, byId())?.m ?? ''), inputmode: 'decimal', placeholder: 'z. B. 8,50' },
        { name: 'role', label: 'Rolle', type: 'select', value: edge.role || '', options: ROLES.map((r) => ({ value: r.id, label: r.label })) },
        { name: 'aufmassId', label: 'Vorhandene Position', type: 'select', value: edge.aufmassId || '', options: [{ value: '', label: 'Neues Maß aus dem Feld' }, ...lengthRows.map((r) => ({ value: r.id, label: `${r.pos} ${r.bez || ''} (${fmtM(r.menge)} ${r.einheit})` }))] },
      ],
      buttons: [{ label: 'Abbrechen', value: null }, { label: 'Kante löschen', value: 'del', cls: 'danger', collect: true }, { label: 'Speichern', value: 'ok', cls: 'primary' }],
    });
    if (!res) return;
    if (res._btn === 'del') { sketch.edges = sketch.edges.filter((e) => e.id !== edge.id); selectedEdge = null; await save(true); return; }
    edge.role = res.role || '';
    if (res.aufmassId) { edge.aufmassId = res.aufmassId; edge.lengthM = null; edge.lengthSource = 'aufmass'; }
    else {
      const n = parseNum(res.meters);
      if (isFinite(n) && n > 0) await upsertLength(edge, n);
      else { edge.lengthM = null; edge.aufmassId = null; }
    }
    await save(true);
  }
  async function upsertLength(edge, meters) {
    edge.lengthM = meters; edge.lengthSource = 'manual';
    let row = edge.aufmassId && rows.find((r) => r.id === edge.aufmassId && !r.faceId);
    const bez = `${roleLabel(edge.role) || 'Strecke'} ${edge.label}`;
    if (!row) {
      row = { id: uid(), projectId: sketch.projectId, order: Date.now(), pos: nextPos(rows), bez, menge: meters, expr: fmtM(meters), einheit: 'm', manual: false, sketchId: sketch.id, edgeId: edge.id };
      edge.aufmassId = row.id; rows.push(row);
    } else { row.menge = meters; row.expr = fmtM(meters); row.bez = bez; row.einheit = 'm'; row.manual = false; row.edgeId = edge.id; row.sketchId = sketch.id; }
    await db.put('aufmass', row);
  }
  async function detect() {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth || img.width; c.height = img.naturalHeight || img.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const found = detectFromImageData(g.getImageData(0, 0, c.width, c.height));
    if (!found.vertices.length) { toast('Keine klaren Kanten. Bitte Eckpunkte von Hand setzen.'); return; }
    const map = [];
    found.vertices.forEach((v) => {
      const near = sketch.vertices.find((p) => Math.hypot(p.x - v.x, p.y - v.y) < 14);
      if (near) map.push(near.id);
      else { const nv = { id: uid(), x: v.x, y: v.y, suggested: true }; sketch.vertices.push(nv); map.push(nv.id); }
    });
    found.edges.forEach(([i, j]) => { const e = ensureEdge(map[i], map[j]); if (e) e.suggested = true; });
    await save(false);
    toast(`${found.vertices.length} Ecken vorgeschlagen, ohne Maße. Bitte korrigieren.`);
  }
  async function askScale() {
    if (sketch.viewKind === 'perspective') {
      toast('Vier Ecken eines bekannten Rechtecks nacheinander tippen');
      tool = 'persp'; draft = []; paint(); return;
    }
    if (sketch.viewKind !== 'top') { toast('Zuerst Draufsicht oder Perspektivfoto wählen. Sonst keine Maße aus Pixeln.'); return; }
    if (!selectedEdge) { toast('Zuerst eine Kante antippen, die als Referenz dient'); tool = 'assign'; paint(); return; }
    const e = sketch.edges.find((x) => x.id === selectedEdge);
    const res = await modal({ title: 'Referenzlänge', fields: [{ name: 'len', label: `Echte Länge der Kante ${e.label} in m`, value: sketch.scale?.refLengthM ?? '', inputmode: 'decimal' }], buttons: [{ label: 'Abbrechen', value: null }, { label: 'Übernehmen', value: 'ok', cls: 'primary' }] });
    if (!res) return;
    const n = parseNum(res.len);
    if (!isFinite(n) || n <= 0) return toast('Länge fehlt');
    sketch.scale = { mode: 'ref', refEdgeId: e.id, refLengthM: n, persp: sketch.scale?.persp || null };
    e.lengthM = n; e.lengthSource = 'ref'; await upsertLength(e, n); await save(true);
  }
  async function finishPersp() {
    if (draft.length !== 4) return;
    const res = await modal({ title: 'Referenzrechteck', html: '<p>Die vier Punkte werden entzerrt. Das ergibt Grundrissmaße, keine geneigte Fläche.</p>', fields: [{ name: 'w', label: 'Breite in m', inputmode: 'decimal' }, { name: 'h', label: 'Tiefe in m', inputmode: 'decimal' }], buttons: [{ label: 'Abbrechen', value: null }, { label: 'Übernehmen', value: 'ok', cls: 'primary' }] });
    if (!res) { draft = []; tool = 'point'; paint(); return; }
    const w = parseNum(res.w), h = parseNum(res.h);
    if (!(w > 0) || !(h > 0)) return toast('Breite und Tiefe angeben');
    const pts = draft.map((id) => { const v = sketch.vertices.find((p) => p.id === id); return [v.x, v.y]; });
    sketch.scale = { mode: 'homography', refEdgeId: null, refLengthM: null, persp: { pts, w, h } };
    draft = []; tool = 'point'; await save(true); toast('Entzerrung gespeichert');
  }

  function renderChrome() {
    if (!sketch.cropApplied) {
      hint.textContent = 'Bildausschnitt: Ecken des Rahmens ziehen. Oder das ganze Bild übernehmen.';
      tools.innerHTML = `<button type="button" id="skCropFull"><span>▦</span>Ganzes Bild</button><button type="button" id="skCropOk"><span>✓</span>Ausschnitt</button>`;
      ctxBar.innerHTML = '';
      el.querySelector('#skCropFull').onclick = async () => { sketch.cropApplied = true; sketch.imgW = img.naturalWidth; sketch.imgH = img.naturalHeight; await save(false); };
      el.querySelector('#skCropOk').onclick = async () => {
        const c = document.createElement('canvas'); c.width = Math.max(2, Math.round(crop.w)); c.height = Math.max(2, Math.round(crop.h));
        c.getContext('2d').drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, c.width, c.height);
        const blob = await canvasToBlob(c, 'image/jpeg', 0.92);
        sketch.sourceImage = blob; sketch.cropApplied = true; sketch.imgW = c.width; sketch.imgH = c.height;
        sketch.vertices = []; sketch.edges = []; sketch.faces = [];
        const url = URL.createObjectURL(blob); const next = new Image(); next.src = url; await next.decode(); img = next;
        await save(false);
      };
      return;
    }
    hint.textContent = tool === 'point' ? 'Eckpunkte antippen. Ziehen verschiebt einen Punkt.'
      : tool === 'edge' ? 'Zwei Eckpunkte nacheinander antippen.'
        : tool === 'face' ? 'Ecken der Reihe nach antippen, die erste erneut zum Schließen.'
          : tool === 'assign' ? 'Kante antippen und Maß oder Aufmaßposition zuweisen.'
            : tool === 'persp' ? 'Vier Ecken des Referenzrechtecks antippen.'
              : 'Werkzeug wählen.';
    const kinds = [['top', 'Draufsicht'], ['perspective', 'Perspektive'], ['unknown', 'Unklar']];
    ctxBar.innerHTML = kinds.map(([k, l]) => `<button type="button" class="btn ${sketch.viewKind === k ? 'primary' : ''}" data-kind="${k}">${l}</button>`).join('')
      + `<button type="button" class="btn" id="skClose">Umriss</button><button type="button" class="btn" id="skFace">Fläche</button><button type="button" class="btn" id="skSum">Zusammensetzen</button><button type="button" class="btn" id="skDrop">Vorschlag weg</button>`
      + sketch.edges.map((e) => `<button type="button" class="btn ${selectedEdge === e.id ? 'primary' : ''}" data-edge="${e.id}">${esc(e.label)}</button>`).join('');
    ctxBar.querySelectorAll('[data-kind]').forEach((b) => b.onclick = async () => { sketch.viewKind = b.dataset.kind; await save(true); });
    el.querySelector('#skClose').onclick = closeLoop;
    el.querySelector('#skFace').onclick = () => makeFace(sketch.vertices.map((v) => v.id));
    el.querySelector('#skDrop').onclick = async () => {
      const drop = new Set(sketch.vertices.filter((v) => v.suggested).map((v) => v.id));
      sketch.vertices = sketch.vertices.filter((v) => !v.suggested);
      sketch.edges = sketch.edges.filter((e) => !e.suggested && !drop.has(e.v1) && !drop.has(e.v2));
      await save(false); toast('Vorschlag entfernt');
    };
    el.querySelector('#skSum').onclick = compose;
    ctxBar.querySelectorAll('[data-edge]').forEach((b) => b.onclick = () => { selectedEdge = b.dataset.edge; editEdge(sketch.edges.find((e) => e.id === selectedEdge)); });
    const btns = [['point', '•', 'Punkt'], ['edge', '／', 'Kante'], ['face', '▢', 'Fläche'], ['assign', 'Maß', 'Maß'], ['detect', '◎', 'Erkennen'], ['scale', '⇄', 'Maßstab'], ['tech', sketch.technical ? 'A' : 'Foto', 'Ansicht']];
    tools.innerHTML = btns.map(([id, ic, l]) => `<button type="button" id="sk-${id}" class="${tool === id ? 'on' : ''}"><span>${ic}</span>${l}</button>`).join('');
    el.querySelector('#sk-point').onclick = () => { tool = 'point'; paint(); };
    el.querySelector('#sk-edge').onclick = () => { tool = 'edge'; edgeStart = null; paint(); };
    el.querySelector('#sk-face').onclick = () => { tool = 'face'; draft = []; paint(); };
    el.querySelector('#sk-assign').onclick = () => { tool = 'assign'; paint(); };
    el.querySelector('#sk-detect').onclick = detect;
    el.querySelector('#sk-scale').onclick = askScale;
    el.querySelector('#sk-tech').onclick = async () => { sketch.technical = !sketch.technical; await save(false); };
  }
  async function compose() {
    const cands = (sketch.faces || []).filter((f) => !f.isComposite);
    if (cands.length < 2) return toast('Mindestens zwei Teilflächen');
    let picked = [];
    const res = await modal({
      title: 'Zusammengesetzte Fläche',
      html: `<p>Nur zusammengehörige Flächen gleicher Art. Abzüge werden abgezogen.</p>` + cands.map((f) => `<label class="chk"><input type="checkbox" data-part value="${f.id}" checked> ${esc(f.label)}${f.isDeduction ? ' (Abzug)' : ''}</label>`).join(''),
      buttons: [{ label: 'Abbrechen', value: null }, { label: 'Anlegen', value: 'ok', cls: 'primary' }],
      onOpen(form) { form.addEventListener('submit', () => { picked = [...form.querySelectorAll('[data-part]:checked')].map((i) => i.value); }, true); },
    });
    if (res !== 'ok' || picked.length < 2) return;
    sketch.faces.push({ id: uid(), label: nextFaceLabel(sketch.faces), vertexIds: [], edgeIds: [], shape: 'poly', isComposite: true, partFaceIds: picked, areaMode: 'projection', isDeduction: false });
    await save(true);
  }

  canvas.addEventListener('pointerdown', (ev) => {
    if (!sketch.cropApplied) {
      const [ix, iy] = toImage(ev);
      const corners = [[crop.x, crop.y], [crop.x + crop.w, crop.y], [crop.x + crop.w, crop.y + crop.h], [crop.x, crop.y + crop.h]];
      let hit = -1, bd = 24;
      corners.forEach((c, i) => { const d = Math.hypot(c[0] - ix, c[1] - iy); if (d < bd) { bd = d; hit = i; } });
      drag = { crop: true, hit, ix, iy, start: { ...crop } };
      canvas.setPointerCapture(ev.pointerId); return;
    }
    const [ix, iy] = toImage(ev);
    const v = nearVertex(ix, iy);
    if (tool === 'point') {
      if (v) { selectedVertex = v.id; drag = { id: v.id }; }
      else addVertex(ix, iy);
    } else if (tool === 'edge') {
      if (!v) return;
      if (!edgeStart) edgeStart = v.id;
      else { ensureEdge(edgeStart, v.id); edgeStart = null; save(false); }
    } else if (tool === 'face' || tool === 'persp') {
      if (!v) return;
      if (draft.length >= 3 && draft[0] === v.id && tool === 'face') { const ids = draft.slice(); draft = []; makeFace(ids); return; }
      if (!draft.includes(v.id)) draft.push(v.id);
      if (tool === 'persp' && draft.length === 4) finishPersp();
      else paint();
    } else if (tool === 'assign') {
      const e = nearEdge(ix, iy);
      if (e) { selectedEdge = e.id; editEdge(e); }
    }
    if (drag) canvas.setPointerCapture(ev.pointerId);
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    const [ix, iy] = toImage(ev);
    if (drag.crop) {
      if (drag.hit < 0) return;
      const s = drag.start;
      if (drag.hit === 0) { crop = { x: ix, y: iy, w: s.x + s.w - ix, h: s.y + s.h - iy }; }
      if (drag.hit === 1) { crop = { x: s.x, y: iy, w: ix - s.x, h: s.y + s.h - iy }; }
      if (drag.hit === 2) { crop = { x: s.x, y: s.y, w: ix - s.x, h: iy - s.y }; }
      if (drag.hit === 3) { crop = { x: ix, y: s.y, w: s.x + s.w - ix, h: iy - s.y }; }
      if (crop.w < 8) crop.w = 8; if (crop.h < 8) crop.h = 8;
      paint.chrome = false; paint(); paint.chrome = true; return;
    }
    const v = sketch.vertices.find((p) => p.id === drag.id);
    if (!v) return;
    v.x = ix; v.y = iy; paint.chrome = false; paint(); paint.chrome = true;
  });
  canvas.addEventListener('pointerup', async () => {
    if (drag && !drag.crop) await save(false);
    drag = null;
  });
  el.querySelector('#skBack').onclick = () => onBack();
  let roLock = false;
  const ro = new ResizeObserver(() => {
    if (roLock) return;
    const r = canvas.getBoundingClientRect();
    const key = `${Math.round(r.width)}x${Math.round(r.height)}`;
    if (canvas.dataset.box === key) return;
    canvas.dataset.box = key;
    roLock = true;
    try { paint(); } finally { roLock = false; }
  });
  ro.observe(el);
  reloadRows().then(() => paint());
  return {
    destroy() { ro.disconnect(); el.remove(); },
    clientPoint,
    get sketch() { return sketch; },
  };
}
