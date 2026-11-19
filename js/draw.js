// Ein Editor für Foto, leeres Blatt und vorhandene Flächenskizzen.
import * as db from './db.js';
import { parseNum } from './util.js';
import {
  emptyDoc, addLine, addStroke, addText, editText, moveText, deleteText, setMeasure, toggleRight, setParallel,
  snapTarget, cycleAt, evaluateCycle, importLegacyStrokes, importLegacySketch, legacyStrokes,
  nodeById, edgeById, fmtNum, evaluateFaces, angleSnap, rightAtJoin, moveNode, moveEdge, setFaceOffset,
  constrainEndpoint, placeEndpoint, deleteEdge,
} from './plan.js';

const INK = '#e8590c';
const MEASURE = '#1c7ed6';

export function drawStrokes(ctx, strokes, w, h) {
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  for (const s of strokes || []) {
    const pts = s.points || [];
    if (!pts.length) continue;
    const lw = Math.max(4, (s.width || 0.012) * Math.max(w, h));
    ctx.beginPath();
    pts.forEach((p, i) => { const x = p[0] * w, y = p[1] * h; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    if (pts.length === 1) ctx.lineTo(pts[0][0] * w + 1, pts[0][1] * h + 1);
    ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = lw + 3; ctx.stroke();
    ctx.strokeStyle = s.color || INK; ctx.lineWidth = lw; ctx.stroke();
  }
}
export function blankCanvas(w = 1000, h = 1400) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
  return c;
}
export function renderMarkup(img, markup, { hidePhoto = false, max = 1600 } = {}) {
  return renderDoc(img, markup?.doc || importLegacyStrokes(markup?.strokes || []), { hidePhoto, max });
}
export function renderDoc(img, doc, { hidePhoto = false, max = 1600 } = {}) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const k = Math.min(1, max / Math.max(iw, ih));
  const c = document.createElement('canvas');
  c.width = Math.max(2, Math.round(iw * k));
  c.height = Math.max(2, Math.round(ih * k));
  const ctx = c.getContext('2d');
  if (hidePhoto || !img) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); }
  else ctx.drawImage(img, 0, 0, c.width, c.height);
  paintDoc(ctx, doc || emptyDoc(), c.width, c.height, null);
  return c;
}
function readable(ang) {
  return ang > Math.PI / 2 || ang < -Math.PI / 2 ? ang + Math.PI : ang;
}
function paintDoc(ctx, doc, w, h, selected) {
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  drawStrokes(ctx, (doc.strokes || []).map((s) => ({ points: s.points, width: s.width || 0.012, color: s.color })), w, h);
  for (const e of doc.edges || []) {
    const a = nodeById(doc, e.a), b = nodeById(doc, e.b);
    if (!a || !b) continue;
    ctx.beginPath(); ctx.moveTo(a.x * w, a.y * h); ctx.lineTo(b.x * w, b.y * h);
    ctx.strokeStyle = e.free ? '#7048e8' : (selected === e.id ? '#0b7285' : '#1f2933');
    ctx.lineWidth = selected === e.id ? Math.max(7, w / 80) : Math.max(4, w / 140);
    ctx.setLineDash(e.free ? [10, 7] : []);
    ctx.stroke();
    ctx.setLineDash([]);
    const mx = (a.x + b.x) / 2 * w, my = (a.y + b.y) / 2 * h;
    const ang = readable(Math.atan2((b.y - a.y) * h, (b.x - a.x) * w));
    ctx.save(); ctx.translate(mx, my); ctx.rotate(ang);
    ctx.font = `700 ${Math.max(14, w / 40)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.lineWidth = 4; ctx.strokeStyle = '#fff';
    ctx.strokeText(e.label || '', 0, -10); ctx.fillStyle = '#1f2933'; ctx.fillText(e.label || '', 0, -10);
    if (e.measure) {
      const m = `${e.label} = ${fmtNum(e.measure.value)} ${e.measure.unit || 'm'}`;
      ctx.font = `700 ${Math.max(13, w / 46)}px sans-serif`;
      ctx.strokeStyle = '#fff'; ctx.strokeText(m, 0, 16); ctx.fillStyle = MEASURE; ctx.fillText(m, 0, 16);
    }
    ctx.restore();
  }
  for (const n of doc.nodes || []) {
    const right = (doc.rights || []).some((r) => r.node === n.id);
    ctx.beginPath(); ctx.arc(n.x * w, n.y * h, right ? 7 : 4, 0, 7);
    ctx.fillStyle = right ? '#2b8a3e' : '#fff'; ctx.fill();
    ctx.strokeStyle = '#1f2933'; ctx.lineWidth = 2; ctx.stroke();
    if (right) {
      ctx.fillStyle = '#2b8a3e'; ctx.font = `700 ${Math.max(12, w / 50)}px sans-serif`;
      ctx.fillText('∟', n.x * w + 8, n.y * h - 8);
    }
  }
  for (const t of doc.texts || []) {
    ctx.font = `700 ${Math.max(16, w / 36)}px sans-serif`;
    const tw = ctx.measureText(t.text || '').width + 12;
    ctx.fillStyle = 'rgba(255,255,255,.92)';
    ctx.fillRect(t.x * w - 6, t.y * h - 18, tw, 24);
    ctx.fillStyle = '#111'; ctx.textAlign = 'left'; ctx.fillText(t.text || '', t.x * w, t.y * h);
  }
  for (const f of evaluateFaces(doc)) {
    ctx.font = `700 ${Math.max(15, w / 38)}px sans-serif`;
    ctx.textAlign = 'center';
    const tw = ctx.measureText(f.text).width + 16;
    ctx.fillStyle = 'rgba(255,255,255,.94)';
    ctx.fillRect(f.x * w - tw / 2, f.y * h - 16, tw, 28);
    ctx.fillStyle = f.ok ? '#0b7285' : '#c92a2a';
    ctx.fillText(f.text, f.x * w, f.y * h + 5);
  }
}

function docFrom(photo, sheet, sketch) {
  if (photo?.markup?.doc) return clone(photo.markup.doc);
  if (sheet?.doc) return clone(sheet.doc);
  if (sketch?.doc) return clone(sketch.doc);
  if (sketch) return importLegacySketch(sketch, sketch.imgW, sketch.imgH);
  if (sheet) return importLegacyStrokes(sheet.strokes || []);
  return importLegacyStrokes(photo?.markup?.strokes || []);
}
function clone(d) { return JSON.parse(JSON.stringify(d)); }

export function mountDraw(root, { photo, sheet, sketch, img, onBack }) {
  const blank = !photo && !sketch;
  img = img || blankCanvas(sheet?.width || 1000, sheet?.height || 1400);
  let doc = docFrom(photo, sheet, sketch);
  let hidePhoto = blank || !!photo?.markup?.hidePhoto;
  let tool = 'line';
  let pen = doc.pen || { width: 0.012, color: '#111111' };
  let undo = [];
  let active = null;
  let selectedEdge = null;
  let selectedText = null;
  let selectedNode = null;
  let arm = null;
  let ann = [];
  let msg = '';
  let formGen = 0;
  let view = { s: 1, ox: 0, oy: 0, iw: 1, ih: 1 };
  const title = sheet?.title || sketch?.title || 'Zeichnen';
  const el = document.createElement('div');
  el.className = 'draw';
  el.innerHTML = `<header class="hdr"><button type="button" class="ib" id="drawBack" aria-label="Zurück">←</button><h1 id="drawTitle"></h1></header>
    <div id="drawStage"><canvas id="drawCanvas"></canvas><div id="snapMark" hidden></div></div>
    <pre id="drawMsg"></pre>
    <form id="drawForm" hidden>
      <input id="drawInput" autocomplete="off">
      <select id="drawUnit"><option value="m">m</option><option value="cm">cm</option><option value="mm">mm</option></select>
      <button type="submit" class="btn primary">OK</button>
      <button type="button" id="drawDel" class="btn danger">Löschen</button>
    </form>
    <div id="drawCtx"></div>
    <div id="penBar">
      <button type="button" data-w="0.006">klein</button>
      <button type="button" data-w="0.012">mittel</button>
      <button type="button" data-w="0.022">groß</button>
      <button type="button" data-c="#111111" class="swatch">schwarz</button>
      <button type="button" data-c="#e03131" class="swatch">rot</button>
      <button type="button" data-c="#2b8a3e" class="swatch">grün</button>
      <button type="button" data-c="#1c7ed6" class="swatch">blau</button>
    </div>
    <div class="draw-tools">
      <button type="button" id="draw-pen"><span>✎</span>Stift</button>
      <button type="button" id="draw-line" class="on"><span>／</span>Linie</button>
      <button type="button" id="draw-free"><span>∿</span>Freie Linie</button>
      <button type="button" id="draw-text"><span>T</span>Text</button>
      <button type="button" id="draw-measure"><span>↔</span>Maß</button>
      <button type="button" id="draw-area"><span>▢</span>Fläche</button>
      <button type="button" id="draw-undo"><span>↩</span>Rückgängig</button>
      ${photo ? '<button type="button" id="draw-photo"><span>▣</span><b>Foto aus</b></button>' : ''}
    </div>`;
  root.appendChild(el);
  el.querySelector('#drawTitle').textContent = title;
  const canvas = el.querySelector('#drawCanvas');
  const ctx = canvas.getContext('2d');
  const form = el.querySelector('#drawForm');
  const input = el.querySelector('#drawInput');
  const unit = el.querySelector('#drawUnit');
  const mark = el.querySelector('#snapMark');
  const photoBtn = el.querySelector('#draw-photo');

  function layout() {
    const r = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const bw = Math.max(2, Math.round(r.width * dpr));
    const bh = Math.max(2, Math.round(Math.max(r.height, 160) * dpr));
    if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const s = Math.min(canvas.width / iw, canvas.height / ih);
    view = { s, ox: (canvas.width - iw * s) / 2, oy: (canvas.height - ih * s) / 2, iw, ih };
  }
  function radiusNorm() {
    const r = canvas.getBoundingClientRect();
    const css = view.iw * view.s * (r.width / canvas.width);
    return css > 1 ? 22 / css : 0.04;
  }
  function norm(ev) {
    const r = canvas.getBoundingClientRect();
    const cx = (ev.clientX - r.left) * (canvas.width / r.width);
    const cy = (ev.clientY - r.top) * (canvas.height / r.height);
    return [clamp((cx - view.ox) / (view.iw * view.s)), clamp((cy - view.oy) / (view.ih * view.s))];
  }
  function clamp(v) { return Math.max(0, Math.min(1, v)); }
  function toClient(nx, ny) {
    const r = canvas.getBoundingClientRect();
    const cx = view.ox + nx * view.iw * view.s;
    const cy = view.oy + ny * view.ih * view.s;
    return { x: r.left + cx / canvas.width * r.width, y: r.top + cy / canvas.height * r.height };
  }
  function showSnap(spec) {
    if (!spec) { mark.hidden = true; return; }
    const p = toClient(spec.x, spec.y);
    const host = el.querySelector('#drawStage').getBoundingClientRect();
    mark.hidden = false;
    mark.style.left = (p.x - host.left - 16) + 'px';
    mark.style.top = (p.y - host.top - 16) + 'px';
  }
  function paint() {
    layout();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!hidePhoto) ctx.drawImage(img, view.ox, view.oy, view.iw * view.s, view.ih * view.s);
    ctx.save();
    ctx.translate(view.ox, view.oy); ctx.scale(view.iw * view.s, view.ih * view.s);
    ctx.restore();
    let preview = doc;
    if (active?.tool === 'pen' && active.points?.length) preview = { ...doc, strokes: doc.strokes.concat([{ id: 'tmp', points: active.points, width: pen.width, color: pen.color }]) };
    else if ((active?.tool === 'line' || active?.tool === 'free') && active.end) preview = addLine(doc, active.start, active.end, { free: active.tool === 'free' });
    else if (active?.tool === 'moveedge' && active.moved) preview = moveEdge(doc, active.id, active.dx, active.dy);
    else if (active?.tool === 'movenode' && active.moved) preview = moveNode(doc, active.id, active.nx, active.ny);
    else if (active?.tool === 'dragend' && active.pos) preview = moveNode(doc, active.nodeId, active.pos.x, active.pos.y);
    else if (active?.tool === 'face' && active.moved) {
      const base = (doc.faceOffsets || []).find((f) => f.sig === active.sig) || { dx: 0, dy: 0 };
      preview = setFaceOffset(doc, active.sig, (base.dx || 0) + active.dx, (base.dy || 0) + active.dy);
    }
    else if (active?.tool === 'text' && active.moved) preview = doc;
    paintFitted(ctx, preview, selectedEdge);
    el.querySelector('#draw-undo').disabled = !undo.length;
    if (photoBtn) { photoBtn.querySelector('b').textContent = hidePhoto ? 'Foto an' : 'Foto aus'; photoBtn.classList.toggle('on', hidePhoto); }
    ['pen', 'line', 'free', 'text', 'measure', 'area'].forEach((t) => el.querySelector('#draw-' + t).classList.toggle('on', tool === t));
    const bar = el.querySelector('#penBar');
    bar.classList.toggle('on', tool === 'pen');
    bar.querySelectorAll('[data-w]').forEach((b) => b.classList.toggle('on', Math.abs(+b.dataset.w - pen.width) < 1e-6));
    bar.querySelectorAll('[data-c]').forEach((b) => b.classList.toggle('on', b.dataset.c === pen.color));
    el.querySelector('#drawMsg').textContent = msg;
    const ctxBar = el.querySelector('#drawCtx');
    ctxBar.innerHTML = [
      selectedNode ? '<button type="button" id="btn-right" class="btn">rechter Winkel</button>' : '',
      selectedEdge ? '<button type="button" id="btn-parallel" class="btn">parallel zu anderer Kante</button><button type="button" id="btn-del-line" class="btn danger">Linie löschen</button>' : '',
    ].join('');
    const right = el.querySelector('#btn-right');
    if (right) right.onclick = async () => {
      const res = toggleRight(doc, selectedNode);
      if (res.error) { msg = res.error; paint(); return; }
      await commit(res.doc);
      await refreshArea();
    };
    const par = el.querySelector('#btn-parallel');
    if (par) par.onclick = () => { arm = selectedEdge; msg = 'Jetzt die zweite, parallele Kante antippen.'; paint(); };
    const delLine = el.querySelector('#btn-del-line');
    if (delLine) delLine.onclick = async () => {
      const id = selectedEdge;
      if (!id) return;
      selectedEdge = null;
      await commit(deleteEdge(doc, id));
      await refreshArea();
    };
  }
  function paintFitted(ctx2, d, sel) {
    const X = (nx) => view.ox + nx * view.iw * view.s;
    const Y = (ny) => view.oy + ny * view.ih * view.s;
    drawStrokes(ctx2, (d.strokes || []).map((s) => ({ points: s.points.map((p) => [X(p[0]) / canvas.width, Y(p[1]) / canvas.height]), width: s.width || 0.012, color: s.color })), canvas.width, canvas.height);
    for (const e of d.edges || []) {
      const a = nodeById(d, e.a), b = nodeById(d, e.b);
      if (!a || !b) continue;
      ctx2.beginPath(); ctx2.moveTo(X(a.x), Y(a.y)); ctx2.lineTo(X(b.x), Y(b.y));
      ctx2.strokeStyle = e.free ? '#7048e8' : (sel === e.id ? '#0b7285' : '#1f2933');
      ctx2.lineWidth = sel === e.id ? 8 : 4;
      ctx2.setLineDash(e.free ? [8, 6] : []);
      ctx2.stroke();
      ctx2.setLineDash([]);
      const mx = (X(a.x) + X(b.x)) / 2, my = (Y(a.y) + Y(b.y)) / 2;
      const ang = readable(Math.atan2(Y(b.y) - Y(a.y), X(b.x) - X(a.x)));
      ctx2.save(); ctx2.translate(mx, my); ctx2.rotate(ang);
      ctx2.font = '700 15px sans-serif'; ctx2.textAlign = 'center';
      ctx2.lineWidth = 4; ctx2.strokeStyle = '#fff'; ctx2.strokeText(e.label || '', 0, -8); ctx2.fillStyle = '#1f2933'; ctx2.fillText(e.label || '', 0, -8);
      const note = ann.find((n) => n.id === e.id);
      if (e.measure && e.measure.source !== 'derived') {
        const m = `${fmtNum(e.measure.value)} ${e.measure.unit || 'm'}`;
        ctx2.strokeText(m, 0, 16); ctx2.fillStyle = MEASURE; ctx2.fillText(m, 0, 16);
      } else if (note?.derived) {
        ctx2.font = 'italic 15px sans-serif';
        ctx2.strokeText('(' + note.text + ')', 0, 16); ctx2.fillStyle = '#868e96'; ctx2.fillText('(' + note.text + ')', 0, 16);
      }
      ctx2.restore();
    }
    for (const n of d.nodes || []) {
      const right = (d.rights || []).some((r) => r.node === n.id);
      ctx2.beginPath(); ctx2.arc(X(n.x), Y(n.y), right ? 8 : 5, 0, 7);
      ctx2.fillStyle = right ? '#2b8a3e' : '#fff'; ctx2.fill(); ctx2.lineWidth = 2; ctx2.strokeStyle = '#1f2933'; ctx2.stroke();
      if (right) { ctx2.fillStyle = '#2b8a3e'; ctx2.font = '700 16px sans-serif'; ctx2.fillText('∟', X(n.x) + 8, Y(n.y) - 8); }
    }
    const picked = (d.edges || []).find((e) => e.id === sel);
    if (picked) {
      for (const id of [picked.a, picked.b]) {
        const n = nodeById(d, id);
        if (!n) continue;
        ctx2.beginPath();
        ctx2.arc(X(n.x), Y(n.y), 18, 0, 7);
        ctx2.fillStyle = '#fff';
        ctx2.fill();
        ctx2.lineWidth = 4;
        ctx2.strokeStyle = '#0b7285';
        ctx2.stroke();
      }
    }
    for (const t of d.texts || []) {
      ctx2.font = '700 18px sans-serif';
      const tw = ctx2.measureText(t.text || '').width + 14;
      ctx2.fillStyle = 'rgba(255,255,255,.94)'; ctx2.fillRect(X(t.x) - 6, Y(t.y) - 20, tw, 26);
      ctx2.fillStyle = '#111'; ctx2.textAlign = 'left'; ctx2.fillText(t.text || '', X(t.x), Y(t.y));
    }
    ctx2.textAlign = 'center';
    for (const f of evaluateFaces(d)) {
      ctx2.font = '700 16px sans-serif';
      const tw = ctx2.measureText(f.text).width + 16;
      ctx2.fillStyle = 'rgba(255,255,255,.94)';
      ctx2.fillRect(X(f.x) - tw / 2, Y(f.y) - 16, tw, 28);
      ctx2.fillStyle = f.ok ? '#0b7285' : '#c92a2a';
      ctx2.fillText(f.text, X(f.x), Y(f.y) + 5);
    }
    if (active?.tool === 'line' && active.angled?.right && active.start) {
      ctx2.fillStyle = '#2b8a3e'; ctx2.font = '700 16px sans-serif'; ctx2.textAlign = 'left';
      ctx2.fillText('∟', X(active.start.x) + 8, Y(active.start.y) - 8);
    }
  }
  function hitHandle(p) {
    if (!selectedEdge) return null;
    const e = edgeById(doc, selectedEdge);
    if (!e) return null;
    const r = radiusNorm() * 1.8;
    for (const end of ['a', 'b']) {
      const n = nodeById(doc, e[end]);
      if (n && Math.hypot(n.x - p[0], n.y - p[1]) <= r) return { nodeId: n.id, end, edge: e };
    }
    return null;
  }
  function hitEdge(p) {
    let best = null, bd = radiusNorm();
    for (const e of doc.edges) {
      const a = nodeById(doc, e.a), b = nodeById(doc, e.b);
      if (!a || !b) continue;
      const d = pointSeg(p[0], p[1], a, b);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
  function pointSeg(px, py, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
    let t = ((px - a.x) * dx + (py - a.y) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
  }
  function hitNode(p) {
    let best = null, bd = radiusNorm();
    for (const n of doc.nodes) { const d = Math.hypot(n.x - p[0], n.y - p[1]); if (d < bd) { bd = d; best = n; } }
    return best;
  }
  function hitText(p) {
    let best = null, bd = radiusNorm() * 1.6;
    for (const t of doc.texts || []) { const d = Math.hypot(t.x - p[0], t.y - p[1]); if (d < bd) { bd = d; best = t; } }
    return best;
  }
  function hitFace(p) {
    let best = null, bd = radiusNorm() * 1.8;
    for (const f of evaluateFaces(doc)) { const d = Math.hypot(f.x - p[0], f.y - p[1]); if (d < bd) { bd = d; best = f; } }
    return best;
  }
  function hitAngle(p) {
    const dn = 14 / ((view.iw * view.s) || 1);
    for (const n of doc.nodes) {
      if (!(doc.rights || []).some((r) => r.node === n.id)) continue;
      if (Math.hypot(p[0] - (n.x + dn), p[1] - (n.y - dn)) < dn * 1.2) return n;
    }
    return null;
  }
  async function persist() {
    const strokes = legacyStrokes(doc);
    if (photo) { photo.markup = { ...(photo.markup || {}), doc, hidePhoto, strokes }; await db.put('photos', photo); }
    if (sheet) { sheet.doc = doc; sheet.strokes = strokes; sheet.updated = Date.now(); await db.put('sheets', sheet); }
    if (sketch) { sketch.doc = doc; sketch.updated = Date.now(); await db.put('sketches', sketch); }
  }
  async function commit(next) {
    undo.push(clone(doc));
    if (undo.length > 40) undo.shift();
    doc = next;
    await persist();
    paint();
  }
  function openForm(mode, value) {
    const gen = ++formGen;
    form.hidden = false;
    form.dataset.mode = mode;
    input.value = value || '';
    input.inputMode = mode === 'measure' ? 'decimal' : 'text';
    input.setAttribute('inputmode', mode === 'measure' ? 'decimal' : 'text');
    unit.hidden = mode !== 'measure';
    el.querySelector('#drawDel').hidden = mode === 'measure' ? !selectedEdge : !selectedText;
    setTimeout(() => { if (gen === formGen && !form.hidden) { input.focus(); input.select?.(); } }, 30);
  }
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const gen = formGen;
    if (form.dataset.mode === 'measure' && selectedEdge) {
      const n = parseNum(input.value);
      if (input.value.trim() && !isFinite(n)) { msg = 'Maß ungültig. Komma ist erlaubt, z. B. 8,50.'; paint(); return; }
      msg = '';
      await commit(setMeasure(doc, selectedEdge, input.value.trim() ? n : null, unit.value));
      await refreshArea();
    } else if (form.dataset.mode === 'text-new') {
      const p = JSON.parse(form.dataset.pos || '[0.5,0.5]');
      if (input.value.trim()) await commit(addText(doc, p[0], p[1], input.value.trim()));
    } else if (form.dataset.mode === 'text-edit' && selectedText) {
      await commit(input.value.trim() ? editText(doc, selectedText, input.value.trim()) : deleteText(doc, selectedText));
    }
    if (gen === formGen) form.hidden = true;
  });
  el.querySelector('#drawDel').onclick = async () => {
    if (selectedText) { await commit(deleteText(doc, selectedText)); selectedText = null; form.hidden = true; }
  };

  function placeEnd(start, x, y, free) {
    const snap = snapTarget(doc, x, y, radiusNorm());
    if (snap) return { end: snap, angled: null, mark: snap };
    if (free) return { end: { x, y }, angled: null, mark: null };
    const angled = angleSnap(doc, start, x, y);
    if (angled) return { end: { x: angled.x, y: angled.y }, angled, mark: { x: angled.x, y: angled.y, kind: 'angle' } };
    return { end: { x, y }, angled: null, mark: null };
  }
  canvas.addEventListener('pointerdown', (ev) => {
    if (ev.button != null && ev.button !== 0) return;
    ev.preventDefault();
    try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* Test-Events */ }
    const p = norm(ev);
    const t = hitText(p);
    if (t) {
      selectedText = t.id;
      active = { tool: 'text', id: t.id, x: p[0], y: p[1], moved: false, origin: clone(doc) };
      return;
    }
    const face = hitFace(p);
    if (face) {
      active = { tool: 'face', sig: face.sig, x: p[0], y: p[1], dx: 0, dy: 0, moved: false, pole: { x: face.x, y: face.y } };
      const evu = face.ev;
      ann = evu.edgeNotes || [];
      msg = (evu.steps || [face.text]).join('\n');
      paint();
      return;
    }
    const glyph = hitAngle(p);
    if (glyph) { active = { tool: 'angle', nodeId: glyph.id }; return; }
    const handle = hitHandle(p);
    if (handle && tool !== 'pen' && tool !== 'measure' && tool !== 'text') {
      const e = handle.edge;
      const moving = nodeById(doc, handle.nodeId);
      const fixed = nodeById(doc, e.a === handle.nodeId ? e.b : e.a);
      active = {
        tool: 'dragend', edgeId: e.id, nodeId: handle.nodeId, free: !!e.free,
        fixed: { x: fixed.x, y: fixed.y, nodeId: fixed.id },
        origin: Math.atan2(moving.y - fixed.y, moving.x - fixed.x),
        x: p[0], y: p[1], moved: false, pos: null,
      };
      return;
    }
    if (tool === 'pen') active = { tool: 'pen', points: [p] };
    else if (tool === 'line' || tool === 'free') {
      const snap = snapTarget(doc, p[0], p[1], radiusNorm());
      const start = snap || { x: p[0], y: p[1] };
      active = { tool, start, end: start, angled: null, x0: p[0], y0: p[1], hitEdge: hitEdge(p)?.id || null };
      showSnap(snap);
    } else if (tool === 'text') {
      selectedText = null; form.dataset.pos = JSON.stringify(p); openForm('text-new', '');
    } else if (tool === 'measure') {
      const e = hitEdge(p);
      if (arm && e && e.id !== arm) {
        const next = setParallel(doc, arm, e.id);
        arm = null;
        selectedEdge = e.id;
        commit(next).then(() => refreshArea());
        return;
      }
      selectedEdge = e ? e.id : null;
      if (e) { unit.value = e.measure?.unit || 'm'; openForm('measure', e.measure ? String(e.measure.value).replace('.', ',') : ''); }
      paint();
    } else if (tool === 'area') {
      const n = hitNode(p);
      const e = n ? null : hitEdge(p);
      if (n) { selectedNode = n.id; active = { tool: 'movenode', id: n.id, x: p[0], y: p[1], nx: n.x, ny: n.y, moved: false }; }
      else if (e) { selectedEdge = e.id; active = { tool: 'moveedge', id: e.id, x: p[0], y: p[1], dx: 0, dy: 0, moved: false }; }
      else {
        const cyc = cycleAt(doc, p[0], p[1]);
        if (!cyc) msg = 'Keine geschlossene Fläche an dieser Stelle.';
        else {
          const evu = evaluateCycle(doc, cyc.nodes);
          ann = evu.edgeNotes || [];
          msg = evu.steps.join('\n');
        }
        paint();
      }
    }
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (!active) return;
    const p = norm(ev);
    if (active.tool === 'pen') {
      const last = active.points[active.points.length - 1];
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.004) active.points.push(p);
      paint();
    } else if (active.tool === 'line' || active.tool === 'free') {
      const placed = placeEnd(active.start, p[0], p[1], active.tool === 'free');
      active.end = placed.end;
      active.angled = placed.angled;
      showSnap(placed.mark);
      paint();
    } else if (active.tool === 'text') {
      if (Math.hypot(p[0] - active.x, p[1] - active.y) > 0.012) {
        if (!active.moved && active.origin) { undo.push(active.origin); if (undo.length > 40) undo.shift(); }
        active.moved = true;
      }
      if (active.moved) { doc = moveText(doc, active.id, p[0], p[1]); paint(); }
    } else if (active.tool === 'face') {
      const dx = p[0] - active.x, dy = p[1] - active.y;
      if (Math.hypot(dx, dy) > 0.012) active.moved = true;
      if (active.moved) { active.dx = dx; active.dy = dy; paint(); }
    } else if (active.tool === 'movenode') {
      if (Math.hypot(p[0] - active.x, p[1] - active.y) > 0.012) active.moved = true;
      if (active.moved) { active.nx = p[0]; active.ny = p[1]; paint(); }
    } else if (active.tool === 'moveedge') {
      const dx = p[0] - active.x, dy = p[1] - active.y;
      if (Math.hypot(dx, dy) > 0.012) active.moved = true;
      if (active.moved) { active.dx = dx; active.dy = dy; paint(); }
    } else if (active.tool === 'dragend') {
      if (Math.hypot(p[0] - active.x, p[1] - active.y) > 0.012) active.moved = true;
      if (active.moved) {
        active.pos = constrainEndpoint(doc, { nodeId: active.nodeId, fixed: active.fixed, origin: active.origin, x: p[0], y: p[1], free: active.free, radius: radiusNorm() });
        const e = edgeById(doc, active.edgeId);
        const len = Math.hypot(active.pos.x - active.fixed.x, active.pos.y - active.fixed.y);
        msg = e?.measure ? `Maß bleibt ${fmtNum(e.measure.value)} ${e.measure.unit || 'm'} · Länge ${fmtNum(len)}` : `Länge ${fmtNum(len)}`;
        if (active.pos.snap) showSnap(active.pos.snap.kind ? active.pos.snap : { x: active.pos.x, y: active.pos.y });
        else showSnap(null);
        paint();
      }
    }
  });
  const end = async () => {
    if (!active) return;
    const act = active; active = null; showSnap(null);
    if (act.tool === 'pen' && act.points.length >= 2) { doc.pen = pen; await commit(addStroke(doc, act.points, pen)); }
    else if (act.tool === 'line' || act.tool === 'free') {
      const moved = Math.hypot((act.end?.x ?? act.x0) - act.x0, (act.end?.y ?? act.y0) - act.y0) > 0.015;
      if (!moved) {
        selectedEdge = act.hitEdge || null;
        paint();
        return;
      }
      const rights = act.tool === 'line' ? rightAtJoin(doc, act.start, act.end) : [];
      if (act.angled?.right) rights.push(act.angled.right);
      const next = addLine(doc, act.start, act.end, { free: act.tool === 'free', rights });
      if (next.edges.length !== doc.edges.length || next.nodes.length !== doc.nodes.length || next.rights.length !== doc.rights.length) {
        await commit(next);
        await refreshArea();
      } else paint();
    } else if (act.tool === 'text' && act.moved) await persist();
    else if (act.tool === 'text' && !act.moved) {
      const t = (doc.texts || []).find((x) => x.id === act.id);
      if (t) openForm('text-edit', t.text);
    } else if (act.tool === 'face' && act.moved) {
      const base = (doc.faceOffsets || []).find((f) => f.sig === act.sig) || { dx: 0, dy: 0 };
      await commit(setFaceOffset(doc, act.sig, (base.dx || 0) + act.dx, (base.dy || 0) + act.dy));
    } else if (act.tool === 'face') paint();
    else if (act.tool === 'angle') {
      const res = toggleRight(doc, act.nodeId);
      if (!res.error) { await commit(res.doc); await refreshArea(); }
    } else if (act.tool === 'dragend' && act.moved && act.pos) {
      await commit(placeEndpoint(doc, act.nodeId, act.pos));
      selectedEdge = edgeById(doc, act.edgeId) ? act.edgeId : null;
      await refreshArea();
    } else if (act.tool === 'movenode' && act.moved) { await commit(moveNode(doc, act.id, act.nx, act.ny)); await refreshArea(); }
    else if (act.tool === 'moveedge' && act.moved) { await commit(moveEdge(doc, act.id, act.dx, act.dy)); await refreshArea(); }
    else paint();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  el.querySelector('#draw-pen').onclick = () => { tool = 'pen'; paint(); };
  el.querySelector('#draw-line').onclick = () => { tool = 'line'; paint(); };
  el.querySelector('#draw-free').onclick = () => { tool = 'free'; paint(); };
  el.querySelector('#draw-text').onclick = () => { tool = 'text'; paint(); };
  el.querySelector('#penBar').addEventListener('click', (ev) => {
    const b = ev.target.closest('button'); if (!b) return;
    if (b.dataset.w) pen = { ...pen, width: +b.dataset.w };
    if (b.dataset.c) pen = { ...pen, color: b.dataset.c };
    doc.pen = pen;
    persist();
    paint();
  });
  el.querySelector('#draw-measure').onclick = () => { tool = 'measure'; paint(); };
  el.querySelector('#draw-area').onclick = () => { tool = 'area'; paint(); };
  el.querySelector('#draw-undo').onclick = async () => {
    if (!undo.length) return;
    doc = undo.pop();
    selectedEdge = null;
    selectedNode = null;
    selectedText = null;
    ann = [];
    await persist();
    await refreshArea();
  };
  if (photoBtn) photoBtn.onclick = async () => { hidePhoto = !hidePhoto; await persist(); paint(); };
  el.querySelector('#drawBack').onclick = () => onBack();
  async function refreshArea() {
    ann = [];
    const lines = [];
    for (const f of evaluateFaces(doc)) {
      lines.push(...(f.ev.steps || []));
      for (const n of f.ev.edgeNotes || []) ann.push(n);
    }
    msg = lines.join('\n');
    paint();
  }
  let roLock = false;
  const ro = new ResizeObserver(() => {
    if (roLock) return;
    const r = canvas.getBoundingClientRect();
    const key = `${Math.round(r.width)}x${Math.round(r.height)}`;
    if (canvas.dataset.box === key) return;
    canvas.dataset.box = key;
    roLock = true; try { paint(); } finally { roLock = false; }
  });
  ro.observe(el);
  paint();
  const api = {
    destroy() { ro.disconnect(); el.remove(); if (window.__baudoku.draw === api) window.__baudoku.draw = null; },
    count: () => (doc.seq || []).filter((s) => s.type === 'stroke' || s.type === 'edge').length,
    strokes() {
      return (doc.seq || []).filter((s) => s.type === 'stroke' || s.type === 'edge').map((s) => {
        if (s.type === 'stroke') { const st = doc.strokes.find((x) => x.id === s.id); return { tool: 'pen', n: st?.points.length || 0, color: st?.color || '', width: st?.width || 0 }; }
        return { tool: 'line', n: 2 };
      });
    },
    edges: () => doc.edges.length,
    edgeEnds: () => doc.edges.map((e) => { const a = nodeById(doc, e.a), b = nodeById(doc, e.b); return { label: e.label, x1: a?.x, y1: a?.y, x2: b?.x, y2: b?.y, free: !!e.free, m: e.measure ? e.measure.value : null, unit: e.measure?.unit || null }; }),
    nodes: () => doc.nodes.length,
    texts: () => (doc.texts || []).map((t) => ({ text: t.text, x: t.x, y: t.y })),
    faces: () => evaluateFaces(doc).map((f) => ({ text: f.text, x: f.x, y: f.y, ok: f.ok, free: f.free })),
    rights: () => (doc.rights || []).length,
    selected: () => !!selectedEdge,
    pen: () => ({ ...pen }),
    clientPoint(nx, ny) {
      layout();
      const r = canvas.getBoundingClientRect();
      const cx = view.ox + nx * view.iw * view.s;
      const cy = view.oy + ny * view.ih * view.s;
      return { x: r.left + cx / canvas.width * r.width, y: r.top + cy / canvas.height * r.height };
    },
  };
  return api;
}
