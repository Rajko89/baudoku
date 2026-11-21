// Ein Editor für Foto, leeres Blatt und vorhandene Flächenskizzen.
import * as db from './db.js';
import { parseNum } from './util.js';
import {
  emptyDoc, addLine, addStroke, addText, editText, moveText, deleteText, setMeasure, setEdgeStyle, toggleRight, setParallel,
  snapTarget, importLegacyStrokes, importLegacySketch, legacyStrokes,
  nodeById, edgeById, fmtNum, evaluateFaces, faceEvalAt, angleSnap, rightAtJoin, moveNode, moveEdge, setFaceOffset,
  constrainEndpoint, placeEndpoint, deleteEdge, splitEdgeAt, moveSplitPoint, isSplitNode,   addShape, patchShape, deleteShape, symbolBox, fitSymbols, arrowSpan,
} from './plan.js';

const INK = '#e8590c';
const MEASURE = '#1c7ed6';
export const LINE_COLORS = [
  { name: 'Hellblau', hex: '#4dabf7' },
  { name: 'Dunkelblau', hex: '#1864ab' },
  { name: 'Hellgrün', hex: '#8ce99a' },
  { name: 'Dunkelgrün', hex: '#2b8a3e' },
  { name: 'Gelb', hex: '#ffd43b' },
  { name: 'Lila', hex: '#7950f2' },
  { name: 'Rot', hex: '#e03131' },
  { name: 'Schwarz', hex: '#111111' },
];
function edgeLook(e) {
  return { color: e.color || (e.free ? '#7048e8' : '#1f2933'), dash: e.dash != null ? !!e.dash : !!e.free };
}
function yellow(c) { return String(c || '').toLowerCase() === '#ffd43b'; }
function paintArrow(ctx, x1, y1, x2, y2, { color = '#111111', dash = false, lw = 4, z = 1, text = '' } = {}) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const head = Math.max(14 * z, Math.min(len * 0.42, 36 * z));
  const wing = head * 0.58;
  const bx = x2 - ux * head, by = y2 - uy * head;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.setLineDash(dash ? [8 * z, 6 * z] : []);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(bx, by);
  if (yellow(color)) { ctx.strokeStyle = '#1f2933'; ctx.lineWidth = lw + 3 * z; ctx.stroke(); }
  ctx.strokeStyle = color || '#111111';
  ctx.lineWidth = lw;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(bx + -uy * wing, by + ux * wing);
  ctx.lineTo(bx - -uy * wing, by - ux * wing);
  ctx.closePath();
  if (yellow(color)) { ctx.lineWidth = 3 * z; ctx.strokeStyle = '#1f2933'; ctx.stroke(); }
  ctx.fillStyle = color || '#111111';
  ctx.fill();
  if (text) {
    ctx.font = `700 ${Math.max(14, 16 * z)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lx = x1 - ux * (20 * z);
    const ly = y1 - uy * (20 * z);
    const tw = ctx.measureText(text).width + 12 * z;
    const th = 22 * z;
    ctx.fillStyle = 'rgba(255,255,255,.94)';
    ctx.fillRect(lx - tw / 2, ly - th / 2, tw, th);
    ctx.fillStyle = '#111';
    ctx.fillText(text, lx, ly);
  }
  ctx.restore();
}

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
  paintDoc(ctx, fitSymbols(doc || emptyDoc(), iw, ih), c.width, c.height, null);
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
    const look = edgeLook(e);
    const lw = selected === e.id ? Math.max(7, w / 80) : Math.max(4, w / 140);
    ctx.setLineDash(look.dash ? [10, 7] : []);
    if (yellow(look.color)) { ctx.strokeStyle = '#1f2933'; ctx.lineWidth = lw + 3; ctx.stroke(); }
    ctx.strokeStyle = look.color;
    ctx.lineWidth = lw;
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
  for (const s of doc.shapes || []) {
    if (s.kind === 'arrow') {
      paintArrow(ctx, s.x * w, s.y * h, (s.x2 ?? s.x) * w, (s.y2 ?? s.y) * h, { color: s.color, dash: !!s.dash, lw: Math.max(4, w / 140), z: Math.max(1, w / 700), text: s.text || '' });
      continue;
    }
    ctx.beginPath();
    if (s.kind === 'circle') {
      const r = (s.d || 0.1) / 2 * w;
      ctx.ellipse(s.x * w, s.y * h, r, r, 0, 0, Math.PI * 2);
    } else ctx.rect(s.x * w, s.y * h, (s.w || 0) * w, (s.h || 0) * h);
    ctx.setLineDash(s.dash ? [10, 7] : []);
    const lw = Math.max(4, w / 140);
    if (yellow(s.color)) { ctx.strokeStyle = '#1f2933'; ctx.lineWidth = lw + 3; ctx.stroke(); }
    ctx.strokeStyle = s.color || '#111111';
    ctx.lineWidth = lw;
    ctx.stroke();
    ctx.setLineDash([]);
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
  const rawDoc = docFrom(photo, sheet, sketch);
  const sheetW = img.naturalWidth || img.width || sheet?.width || 1000;
  const sheetH = img.naturalHeight || img.height || sheet?.height || 1400;
  let doc = fitSymbols(rawDoc, sheetW, sheetH);
  const symbolsResized = doc !== rawDoc;
  let hidePhoto = blank || !!photo?.markup?.hidePhoto;
  let tool = 'line';
  let pen = doc.pen || { width: 0.012, color: '#111111' };
  let lineColor = '#111111';
  let lineDash = false;
  let undo = [];
  let active = null;
  let selectedEdge = null;
  let selectedText = null;
  let selectedShape = null;
  let selectedNode = null;
  let detail = null;
  let arm = null;
  let ann = [];
  let msg = '';
  let formGen = 0;
  let view = { s: 1, ox: 0, oy: 0, iw: 1, ih: 1 };
  let userZoom = 1;
  const minZoom = blank ? 0.5 : 1;
  const maxZoom = 6;
  const pointers = new Map();
  let hands = null;
  let pinchRef = null;
  let lastTapAt = 0;
  let lastTapX = 0;
  let lastTapY = 0;
  let down = null;
  const title = sheet?.title || sketch?.title || 'Zeichnen';
  const el = document.createElement('div');
  el.className = 'draw';
  el.innerHTML = `<header class="hdr"><button type="button" class="ib" id="drawBack" aria-label="Zurück">←</button><h1 id="drawTitle"></h1></header>
    <div id="drawStage"><canvas id="drawCanvas"></canvas><div id="snapMark" hidden></div><button type="button" id="drawZoom" hidden aria-label="Zoom zurücksetzen">1:1</button>
    <div id="penBar">
      <button type="button" data-w="0.006">klein</button>
      <button type="button" data-w="0.012">mittel</button>
      <button type="button" data-w="0.022">groß</button>
      <button type="button" id="draw-dash">gestrichelt</button>
      ${LINE_COLORS.map((c) => `<button type="button" data-c="${c.hex}" class="swatch${c.hex === '#ffd43b' ? ' yel' : ''}">${c.name}</button>`).join('')}
    </div></div>
    <pre id="drawMsg"></pre>
    <form id="drawForm" hidden>
      <input id="drawInput" autocomplete="off">
      <select id="drawUnit"><option value="m">m</option><option value="cm">cm</option><option value="mm">mm</option></select>
      <button type="submit" class="btn primary">OK</button>
      <button type="button" id="drawDel" class="btn danger">Löschen</button>
    </form>
    <div id="drawCtx"></div>
    <div id="drawDock">
    <div class="draw-tools">
      <button type="button" id="draw-pen"><span>✎</span>Stift</button>
      <button type="button" id="draw-line" class="on"><span>／</span>Linie</button>
      <button type="button" id="draw-free"><span>∿</span>Freie Linie</button>
      <button type="button" id="draw-edit"><span>✥</span>Bearbeiten</button>
      <button type="button" id="draw-rect"><span>▢</span>Quadrat</button>
      <button type="button" id="draw-circle"><span>○</span>Kreis</button>
      <button type="button" id="draw-arrow"><span>➜</span>Pfeil</button>
      <button type="button" id="draw-text"><span>T</span>Text</button>
      <button type="button" id="draw-measure"><span>↔</span>Maß</button>
      <button type="button" id="draw-area"><span>▢</span>Fläche</button>
      <button type="button" id="draw-undo"><span>↩</span>Rückgängig</button>
      ${photo ? '<button type="button" id="draw-photo"><span>▣</span><b>Foto aus</b></button>' : ''}
      <button type="button" id="draw-fold" aria-expanded="true"><span>▾</span>Weniger</button>
    </div>
    <div class="draw-keep" hidden>
      <button type="button" id="draw-unfold" aria-label="Werkzeuge einblenden"><span>▴</span>Werkzeuge</button>
      <button type="button" id="draw-home"><span>←</span>Zurück</button>
      <button type="button" id="draw-save">Speichern</button>
    </div>
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
    const iw = img.naturalWidth || img.width || 1, ih = img.naturalHeight || img.height || 1;
    if (canvas.width === bw && canvas.height === bh && view.s0) return;
    let nx = 0.5, ny = 0.5;
    if (view.s0 && view.iw && view.s) {
      nx = (canvas.width / 2 - view.ox) / (view.iw * view.s);
      ny = (canvas.height / 2 - view.oy) / (view.ih * view.s);
      if (!isFinite(nx)) nx = 0.5;
      if (!isFinite(ny)) ny = 0.5;
    }
    canvas.width = bw;
    canvas.height = bh;
    const s0 = Math.min(bw / iw, bh / ih) || 1;
    const s = s0 * userZoom;
    view = { s, ox: bw / 2 - nx * iw * s, oy: bh / 2 - ny * ih * s, iw, ih, s0 };
  }
  function clampView() {
    const r = canvas.getBoundingClientRect();
    const margin = 48 * (canvas.width / (r.width || 1));
    const right = view.ox + view.iw * view.s;
    const bottom = view.oy + view.ih * view.s;
    if (right < margin) view.ox += margin - right;
    if (view.ox > canvas.width - margin) view.ox -= view.ox - (canvas.width - margin);
    if (bottom < margin) view.oy += margin - bottom;
    if (view.oy > canvas.height - margin) view.oy -= view.oy - (canvas.height - margin);
  }
  function resetZoom() {
    userZoom = 1;
    const s = view.s0 || view.s || 1;
    view.s = s;
    view.ox = (canvas.width - view.iw * s) / 2;
    view.oy = (canvas.height - view.ih * s) / 2;
    paint();
  }
  function beginPinch() {
    active = null;
    showSnap(null);
    if (!form.hidden) { form.hidden = true; formGen++; }
    hands = 'pinch';
    const pts = [...pointers.values()];
    if (pts.length >= 2) {
      pinchRef = {
        dist: Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) || 1,
        mid: { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 },
      };
    }
    paint();
  }
  function pinchApply() {
    const pts = [...pointers.values()];
    if (pts.length < 2 || !pinchRef || !view.s0) return;
    const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) || 1;
    const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    const factor = dist / pinchRef.dist;
    const r = canvas.getBoundingClientRect();
    const kx = canvas.width / (r.width || 1), ky = canvas.height / (r.height || 1);
    const prevX = (pinchRef.mid.x - r.left) * kx;
    const prevY = (pinchRef.mid.y - r.top) * ky;
    const nx = (prevX - view.ox) / (view.iw * view.s);
    const ny = (prevY - view.oy) / (view.ih * view.s);
    userZoom = Math.min(maxZoom, Math.max(minZoom, userZoom * factor));
    view.s = view.s0 * userZoom;
    view.ox = (mid.x - r.left) * kx - nx * view.iw * view.s;
    view.oy = (mid.y - r.top) * ky - ny * view.ih * view.s;
    clampView();
    pinchRef = { dist, mid };
    paint();
  }
  function pxPerNorm() {
    const r = canvas.getBoundingClientRect();
    return view.iw * view.s * (r.width / canvas.width) || 1;
  }
  function px(n) { const k = pxPerNorm(); return k > 1 ? n / k : 0.05; }
  function pxPerNormY() {
    const r = canvas.getBoundingClientRect();
    return view.ih * view.s * (r.height / canvas.height) || 1;
  }
  function cssDist(x0, y0, x1, y1) { return Math.hypot(x1 - x0, y1 - y0) * (pxPerNorm() > 1 ? pxPerNorm() : 400); }
  function radiusNorm() { return px(28); }
  function angDiff(a, b) {
    let d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return Math.abs(d);
  }
  function nearestNode(p, css) {
    const r = px(css);
    let best = null, bd = r;
    for (const n of doc.nodes) {
      const d = Math.hypot(n.x - p[0], n.y - p[1]);
      if (d <= bd) { bd = d; best = n; }
    }
    return best;
  }
  function edgeAxis(node, edge) {
    const o = nodeById(doc, edge.a === node.id ? edge.b : edge.a);
    if (!o) return null;
    return { e: edge, o, dir: Math.atan2(o.y - node.y, o.x - node.x) };
  }
  function bestEdge(node, p, limit) {
    const ang = Math.atan2(p[1] - node.y, p[0] - node.x);
    let best = null, bestOff = limit;
    for (const e of doc.edges) {
      if (e.a !== node.id && e.b !== node.id) continue;
      const info = edgeAxis(node, e);
      if (!info) continue;
      const d = angDiff(ang, info.dir);
      const off = Math.min(d, Math.abs(Math.PI - d));
      if (off < bestOff) { bestOff = off; best = info; }
    }
    return best;
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
    ctx.fillStyle = '#c5ced6'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff'; ctx.fillRect(view.ox, view.oy, view.iw * view.s, view.ih * view.s);
    if (!hidePhoto) ctx.drawImage(img, view.ox, view.oy, view.iw * view.s, view.ih * view.s);
    ctx.save();
    ctx.strokeStyle = '#1f2933';
    ctx.setLineDash([8 * (window.devicePixelRatio || 1), 6 * (window.devicePixelRatio || 1)]);
    ctx.lineWidth = 2 * (window.devicePixelRatio || 1);
    ctx.strokeRect(view.ox + 2, view.oy + 2, Math.max(0, view.iw * view.s - 4), Math.max(0, view.ih * view.s - 4));
    ctx.restore();
    ctx.save();
    ctx.translate(view.ox, view.oy); ctx.scale(view.iw * view.s, view.ih * view.s);
    ctx.restore();
    let preview = doc;
    if (active?.tool === 'pen' && active.points?.length) preview = { ...doc, strokes: doc.strokes.concat([{ id: 'tmp', points: active.points, width: pen.width, color: pen.color }]) };
    else if ((active?.tool === 'line' || active?.tool === 'free') && active.end) preview = addLine(doc, active.start, active.end, { free: active.tool === 'free' });
    else if (active?.tool === 'moveedge' && active.moved) preview = moveEdge(doc, active.id, active.dx, active.dy);
    else if (active?.tool === 'movenode' && active.moved) preview = moveNode(doc, active.id, active.nx, active.ny);
    else if (active?.tool === 'dragend' && active.pos) preview = active.split ? moveSplitPoint(doc, active.nodeId, active.pos.x, active.pos.y) : moveNode(doc, active.nodeId, active.pos.x, active.pos.y);
    else if (active?.tool === 'face' && active.moved) {
      const base = (doc.faceOffsets || []).find((f) => f.sig === active.sig) || { dx: 0, dy: 0 };
      preview = setFaceOffset(doc, active.sig, (base.dx || 0) + active.dx, (base.dy || 0) + active.dy);
    }
    else if (active?.tool === 'text' && active.moved) preview = doc;
    paintFitted(ctx, preview, selectedEdge);
    el.querySelector('#draw-undo').disabled = !undo.length;
    const zoomBtn = el.querySelector('#drawZoom');
    if (zoomBtn) zoomBtn.hidden = Math.abs(userZoom - 1) < 0.02;
    if (photoBtn) { photoBtn.querySelector('b').textContent = hidePhoto ? 'Foto an' : 'Foto aus'; photoBtn.classList.toggle('on', hidePhoto); }
    ['pen', 'line', 'free', 'edit', 'text', 'measure', 'area', 'rect', 'circle', 'arrow'].forEach((t) => el.querySelector('#draw-' + t).classList.toggle('on', tool === t));
    const bar = el.querySelector('#penBar');
    const showInk = tool === 'pen' || detail === 'line' || detail === 'shape';
    bar.classList.toggle('on', showInk);
    bar.classList.toggle('pen', tool === 'pen');
    bar.classList.toggle('ink', tool !== 'pen');
    const activeColor = selectedShape ? ((doc.shapes || []).find((s) => s.id === selectedShape)?.color) : selectedEdge ? edgeLook(edgeById(doc, selectedEdge) || {}).color : (tool === 'pen' ? pen.color : lineColor);
    bar.querySelectorAll('[data-w]').forEach((b) => b.classList.toggle('on', Math.abs(+b.dataset.w - pen.width) < 1e-6));
    bar.querySelectorAll('[data-c]').forEach((b) => b.classList.toggle('on', b.dataset.c === activeColor));
    const dashBtn = el.querySelector('#draw-dash');
    const dashOn = selectedShape ? !!(doc.shapes || []).find((s) => s.id === selectedShape)?.dash : selectedEdge ? edgeLook(edgeById(doc, selectedEdge) || {}).dash : lineDash;
    if (dashBtn) { dashBtn.classList.toggle('on', !!dashOn); dashBtn.textContent = dashOn ? 'gestrichelt' : 'durchgezogen'; }
    el.querySelector('#drawMsg').textContent = msg;
    const ctxBar = el.querySelector('#drawCtx');
    ctxBar.innerHTML = [
      selectedNode ? '<button type="button" id="btn-right" class="btn">rechter Winkel</button>' : '',
      detail === 'line' && selectedEdge ? '<button type="button" id="btn-split" class="btn">Teilen</button><button type="button" id="btn-parallel" class="btn">parallel</button><button type="button" id="btn-del-line" class="btn danger">Linie löschen</button>' : '',
      detail === 'shape' && selectedShape ? `${(doc.shapes || []).find((s) => s.id === selectedShape)?.kind === 'arrow' ? '<button type="button" id="btn-arrow-text" class="btn">Text am Pfeil</button>' : ''}<button type="button" id="btn-del-shape" class="btn danger">Löschen</button>` : '',
      detail === 'text' && selectedText ? '<button type="button" id="btn-text-edit" class="btn">Text ändern</button><button type="button" id="btn-text-del" class="btn danger">Text löschen</button>' : '',
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
    const splitBtn = el.querySelector('#btn-split');
    if (splitBtn) splitBtn.onclick = async () => {
      const id = selectedEdge;
      if (!id) return;
      await commit(splitEdgeAt(doc, id, 0.5));
      selectedEdge = id;
      msg = 'Teilpunkt ziehen, um die Längen zu verschieben.';
      await refreshArea();
    };
    const arrowText = el.querySelector('#btn-arrow-text');
    if (arrowText) arrowText.onclick = () => {
      const s = (doc.shapes || []).find((x) => x.id === selectedShape);
      if (s) openForm('arrow-text', s.text || '');
    };
    const delShape = el.querySelector('#btn-del-shape');
    if (delShape) delShape.onclick = async () => {
      const id = selectedShape;
      if (!id) return;
      selectedShape = null;
      await commit(deleteShape(doc, id));
      paint();
    };
    const textEdit = el.querySelector('#btn-text-edit');
    if (textEdit) textEdit.onclick = () => {
      const t = (doc.texts || []).find((x) => x.id === selectedText);
      if (t) openForm('text-edit', t.text);
    };
    const textDel = el.querySelector('#btn-text-del');
    if (textDel) textDel.onclick = async () => {
      const id = selectedText;
      if (!id) return;
      selectedText = null;
      await commit(deleteText(doc, id));
      paint();
    };
  }
  function paintFitted(ctx2, d, sel) {
    const z = userZoom || 1;
    const X = (nx) => view.ox + nx * view.iw * view.s;
    const Y = (ny) => view.oy + ny * view.ih * view.s;
    drawStrokes(ctx2, (d.strokes || []).map((s) => ({ points: s.points.map((p) => [X(p[0]) / canvas.width, Y(p[1]) / canvas.height]), width: (s.width || 0.012) * z, color: s.color })), canvas.width, canvas.height);
    for (const e of d.edges || []) {
      const a = nodeById(d, e.a), b = nodeById(d, e.b);
      if (!a || !b) continue;
      ctx2.beginPath(); ctx2.moveTo(X(a.x), Y(a.y)); ctx2.lineTo(X(b.x), Y(b.y));
      const look = edgeLook(e);
      const lw = (sel === e.id ? 8 : 4) * z;
      ctx2.setLineDash(look.dash ? [8 * z, 6 * z] : []);
      if (sel === e.id) { ctx2.strokeStyle = '#fff'; ctx2.lineWidth = lw + 6 * z; ctx2.stroke(); ctx2.setLineDash(look.dash ? [8 * z, 6 * z] : []); }
      if (yellow(look.color)) { ctx2.strokeStyle = '#1f2933'; ctx2.lineWidth = lw + 3 * z; ctx2.stroke(); ctx2.setLineDash(look.dash ? [8 * z, 6 * z] : []); }
      ctx2.strokeStyle = look.color;
      ctx2.lineWidth = lw;
      ctx2.stroke();
      ctx2.setLineDash([]);
      const mx = (X(a.x) + X(b.x)) / 2, my = (Y(a.y) + Y(b.y)) / 2;
      const ang = readable(Math.atan2(Y(b.y) - Y(a.y), X(b.x) - X(a.x)));
      ctx2.save(); ctx2.translate(mx, my); ctx2.rotate(ang);
      ctx2.font = `700 ${15 * z}px sans-serif`; ctx2.textAlign = 'center';
      ctx2.lineWidth = 4 * z; ctx2.strokeStyle = '#fff'; ctx2.strokeText(e.label || '', 0, -8 * z); ctx2.fillStyle = '#1f2933'; ctx2.fillText(e.label || '', 0, -8 * z);
      const note = ann.find((n) => n.id === e.id);
      if (e.measure && e.measure.source !== 'derived') {
        const m = `${fmtNum(e.measure.value)} ${e.measure.unit || 'm'}`;
        ctx2.strokeText(m, 0, 16 * z); ctx2.fillStyle = MEASURE; ctx2.fillText(m, 0, 16 * z);
      } else if (note?.derived) {
        ctx2.font = `italic ${15 * z}px sans-serif`;
        ctx2.strokeText('(' + note.text + ')', 0, 16 * z); ctx2.fillStyle = '#868e96'; ctx2.fillText('(' + note.text + ')', 0, 16 * z);
      }
      ctx2.restore();
    }
    for (const n of d.nodes || []) {
      const right = (d.rights || []).some((r) => r.node === n.id);
      ctx2.beginPath(); ctx2.arc(X(n.x), Y(n.y), (right ? 8 : 5) * z, 0, 7);
      ctx2.fillStyle = right ? '#2b8a3e' : '#fff'; ctx2.fill(); ctx2.lineWidth = 2 * z; ctx2.strokeStyle = '#1f2933'; ctx2.stroke();
      if (right) { ctx2.fillStyle = '#2b8a3e'; ctx2.font = `700 ${16 * z}px sans-serif`; ctx2.fillText('∟', X(n.x) + 8 * z, Y(n.y) - 8 * z); }
    }
    const picked = (d.edges || []).find((e) => e.id === sel);
    if (picked) {
      for (const id of [picked.a, picked.b]) {
        const n = nodeById(d, id);
        if (!n) continue;
        ctx2.beginPath();
        ctx2.arc(X(n.x), Y(n.y), 18 * z, 0, 7);
        ctx2.fillStyle = '#fff';
        ctx2.fill();
        ctx2.lineWidth = 4 * z;
        ctx2.strokeStyle = '#0b7285';
        ctx2.stroke();
      }
    }
    for (const t of d.texts || []) {
      ctx2.font = `700 ${18 * z}px sans-serif`;
      const tw = ctx2.measureText(t.text || '').width + 14 * z;
      ctx2.fillStyle = 'rgba(255,255,255,.94)'; ctx2.fillRect(X(t.x) - 6 * z, Y(t.y) - 20 * z, tw, 26 * z);
      ctx2.fillStyle = '#111'; ctx2.textAlign = 'left'; ctx2.fillText(t.text || '', X(t.x), Y(t.y));
    }
    const drawShape = (s, selId) => {
      if (s.kind === 'arrow') {
        paintArrow(ctx2, X(s.x), Y(s.y), X(s.x2 ?? s.x), Y(s.y2 ?? s.y), { color: s.color, dash: !!s.dash, lw: (selId === s.id ? 8 : 4) * z, z, text: s.text || '' });
        return;
      }
      ctx2.beginPath();
      if (s.kind === 'circle') {
        const r = (s.d || 0.1) / 2 * view.iw * view.s;
        ctx2.ellipse(X(s.x), Y(s.y), r, r, 0, 0, Math.PI * 2);
      } else ctx2.rect(X(s.x), Y(s.y), (s.w || 0) * view.iw * view.s, (s.h || 0) * view.ih * view.s);
      ctx2.setLineDash(s.dash ? [8 * z, 6 * z] : []);
      const lw = (selId === s.id ? 8 : 4) * z;
      if (yellow(s.color)) { ctx2.strokeStyle = '#1f2933'; ctx2.lineWidth = lw + 3 * z; ctx2.stroke(); ctx2.setLineDash(s.dash ? [8 * z, 6 * z] : []); }
      ctx2.strokeStyle = s.color || '#111111';
      ctx2.lineWidth = lw;
      ctx2.stroke();
      ctx2.setLineDash([]);
    };
    for (const s of d.shapes || []) drawShape(s, selectedShape);
    if (active?.tool === 'arrow' && active.raw) {
      const far = Math.hypot(active.raw[0] - active.x0, active.raw[1] - active.y0) > 0.01;
      if (far) paintArrow(ctx2, X(active.x0), Y(active.y0), X(active.raw[0]), Y(active.raw[1]), { color: lineColor, dash: false, lw: 4 * z, z });
    }
    ctx2.textAlign = 'center';
    for (const f of evaluateFaces(d)) {
      ctx2.font = `700 ${16 * z}px sans-serif`;
      const tw = ctx2.measureText(f.text).width + 16 * z;
      ctx2.fillStyle = 'rgba(255,255,255,.94)';
      ctx2.fillRect(X(f.x) - tw / 2, Y(f.y) - 16 * z, tw, 28 * z);
      ctx2.fillStyle = f.ok ? '#0b7285' : '#c92a2a';
      ctx2.fillText(f.text, X(f.x), Y(f.y) + 5 * z);
    }
    if (active?.tool === 'line' && active.angled?.right && active.start) {
      ctx2.fillStyle = '#2b8a3e'; ctx2.font = `700 ${16 * z}px sans-serif`; ctx2.textAlign = 'left';
      ctx2.fillText('∟', X(active.start.x) + 8 * z, Y(active.start.y) - 8 * z);
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
    let best = null, bd = px(28);
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
    let best = null, bd = Infinity;
    for (const t of doc.texts || []) {
      const w = Math.max(px(28), ((t.text || '').length || 1) * px(8));
      const dx = p[0] - t.x;
      const dy = t.y - p[1];
      if (dx >= -px(18) && dx <= w && dy >= -px(10) && dy <= px(24)) {
        const d = Math.hypot(dx, dy);
        if (d < bd) { bd = d; best = t; }
      }
    }
    return best;
  }
  function arrowPart(s, p) {
    const kx = pxPerNorm() || 1, ky = pxPerNormY() || 1;
    const ax = s.x * kx, ay = s.y * ky, bx = (s.x2 ?? s.x) * kx, by = (s.y2 ?? s.y) * ky;
    const px0 = p[0] * kx, py0 = p[1] * ky;
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
    let t = ((px0 - ax) * dx + (py0 - ay) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    const dist = Math.hypot(px0 - (ax + t * dx), py0 - (ay + t * dy));
    const tip = Math.hypot(px0 - bx, py0 - by);
    const tail = Math.hypot(px0 - ax, py0 - ay);
    if (dist > 22 && tip > 22 && tail > 22) return null;
    if (t >= 0.72) return 'tip';
    if (t <= 0.28) return 'tail';
    return 'shaft';
  }
  function hitShape(p) {
    const kx = pxPerNorm() || 1;
    const ky = pxPerNormY() || 1;
    const list = [...(doc.shapes || [])].reverse();
    for (const s of list) {
      if (s.kind === 'arrow') { if (arrowPart(s, p)) return s; continue; }
      if (s.kind === 'circle') {
        const dx = (p[0] - s.x) * kx;
        const dy = (p[1] - s.y) * ky;
        const vis = (s.d || 0) / 2 * kx;
        if (Math.hypot(dx, dy) <= Math.max(vis + 12, 22)) return s;
      } else {
        const cx = s.x + (s.w || 0) / 2;
        const cy = s.y + (s.h || 0) / 2;
        const halfW = Math.max((s.w || 0) / 2 + 14 / kx, 22 / kx);
        const halfH = Math.max((s.h || 0) / 2 + 14 / ky, 22 / ky);
        if (Math.abs(p[0] - cx) <= halfW && Math.abs(p[1] - cy) <= halfH) return s;
      }
    }
    return null;
  }
  function symbolAt(kind, x, y) {
    const box = symbolBox(view.iw || img.naturalWidth || img.width || 1000, view.ih || img.naturalHeight || img.height || 1400);
    if (kind === 'circle') return { kind: 'circle', x: clamp(x), y: clamp(y), d: box.d, w: box.w, h: box.h, color: lineColor, dash: false, symbol: true };
    const left = Math.max(0, Math.min(1 - box.w, x - box.w / 2));
    const top = Math.max(0, Math.min(1 - box.h, y - box.h / 2));
    return { kind: 'rect', x: left, y: top, w: box.w, h: box.h, d: box.d, color: lineColor, dash: false, symbol: true };
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
    } else if (form.dataset.mode === 'arrow-text' && selectedShape) {
      await commit(patchShape(doc, selectedShape, { text: input.value.trim() }));
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
  function beginLengthDrag(act, info) {
    if (!info || !act.grab) return;
    const moving = act.grab;
    act.tool = 'dragend';
    act.edgeId = info.e.id;
    act.nodeId = moving.id;
    act.free = !!info.e.free;
    act.fixed = { x: info.o.x, y: info.o.y, nodeId: info.o.id };
    act.origin = Math.atan2(moving.y - info.o.y, moving.x - info.o.x);
    act.x = act.x0;
    act.y = act.y0;
    act.moved = false;
    act.pos = null;
    act.split = isSplitNode(doc, moving.id);
    selectedEdge = info.e.id;
  }
  function updateLengthDrag(act, p) {
    if (cssDist(act.x0, act.y0, p[0], p[1]) > 12) act.moved = true;
    if (!act.moved) return;
    if (act.split) { act.pos = { x: p[0], y: p[1] }; paint(); return; }
    act.pos = constrainEndpoint(doc, { nodeId: act.nodeId, fixed: act.fixed, origin: act.origin, x: p[0], y: p[1], free: act.free, radius: px(28), lock: true });
    const e = edgeById(doc, act.edgeId);
    const len = Math.hypot(act.pos.x - act.fixed.x, act.pos.y - act.fixed.y);
    msg = e?.measure ? `Maß bleibt ${fmtNum(e.measure.value)} ${e.measure.unit || 'm'} · Länge ${fmtNum(len)}` : `Länge ${fmtNum(len)}`;
    showSnap(act.pos.snap || null);
    paint();
  }
  canvas.addEventListener('pointerdown', (ev) => {
    if (ev.button != null && ev.button !== 0) return;
    ev.preventDefault();
    try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* Test-Events */ }
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pointers.size >= 2) { beginPinch(); return; }
    if (hands === 'hold' || hands === 'pinch') return;
    hands = 'draw';
    const p = norm(ev);
    down = { x: ev.clientX, y: ev.clientY, line: hitEdge(p), shape: hitShape(p), text: hitText(p) };
    const t = hitText(p);
    const shapeHit = hitShape(p);
    const grabShape = (s) => {
      selectedShape = s.id;
      selectedEdge = null;
      selectedText = null;
      active = { tool: 'shape', id: s.id, mode: s.kind === 'arrow' ? (arrowPart(s, p) || 'shaft') : 'move', x: p[0], y: p[1], x0: p[0], y0: p[1], ox: s.x, oy: s.y, ox2: s.x2, oy2: s.y2, moved: false, origin: clone(doc) };
      paint();
    };
    if (tool === 'rect' || tool === 'circle' || tool === 'arrow') {
      if (shapeHit) { grabShape(shapeHit); return; }
      if (tool === 'arrow') { active = { tool: 'arrow', x0: p[0], y0: p[1], raw: [p[0], p[1]] }; return; }
      active = { tool: 'symbol', kind: tool, x0: p[0], y0: p[1], raw: [p[0], p[1]] };
      return;
    }
    if (t && tool !== 'measure') {
      selectedText = t.id;
      selectedEdge = null;
      selectedShape = null;
      active = { tool: 'text', id: t.id, x: p[0], y: p[1], x0: p[0], y0: p[1], moved: false, origin: clone(doc) };
      return;
    }
    if (shapeHit && tool !== 'pen' && tool !== 'measure') { grabShape(shapeHit); return; }
    if (tool === 'measure') {
      const e = hitEdge(p);
      if (arm && e && e.id !== arm) {
        const next = setParallel(doc, arm, e.id);
        arm = null;
        selectedEdge = e.id;
        commit(next).then(() => refreshArea());
        return;
      }
      selectedEdge = e ? e.id : null;
      detail = e ? 'line' : null;
      if (!e) { selectedShape = null; selectedText = null; }
      if (e) { unit.value = e.measure?.unit || 'm'; openForm('measure', e.measure ? String(e.measure.value).replace('.', ',') : ''); }
      paint();
      return;
    }
    if (tool === 'text') {
      selectedText = null; form.dataset.pos = JSON.stringify(p); openForm('text-new', '');
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
    if (glyph && tool !== 'line' && tool !== 'free') { active = { tool: 'angle', nodeId: glyph.id }; return; }
    if (tool === 'edit') {
      const grab = nearestNode(p, 30);
      const edge = hitEdge(p);
      if (grab) {
        active = { tool: 'editwait', grab, x0: p[0], y0: p[1], raw: [p[0], p[1]], hitEdge: edge?.id || null };
        return;
      }
      selectedEdge = edge?.id || null;
      selectedNode = null;
      if (!edge) { detail = null; selectedShape = null; selectedText = null; }
      paint();
      return;
    }
    if (tool === 'pen') active = { tool: 'pen', points: [p] };
    else if (tool === 'line' || tool === 'free') {
      const grab = nearestNode(p, 30);
      const snap = snapTarget(doc, p[0], p[1], radiusNorm());
      const start = snap || { x: p[0], y: p[1] };
      active = { tool, start, end: start, angled: null, x0: p[0], y0: p[1], raw: [p[0], p[1]], grab, hitEdge: hitEdge(p)?.id || null, decided: null };
      showSnap(snap);
    } else if (tool === 'area') {
      const n = hitNode(p);
      const e = n ? null : hitEdge(p);
      if (n) { selectedNode = n.id; active = { tool: 'movenode', id: n.id, x: p[0], y: p[1], nx: n.x, ny: n.y, moved: false }; }
      else if (e) { selectedEdge = e.id; active = { tool: 'moveedge', id: e.id, x: p[0], y: p[1], dx: 0, dy: 0, moved: false }; }
      else {
        const hit = faceEvalAt(doc, p[0], p[1]);
        if (!hit) msg = 'Keine geschlossene Fläche an dieser Stelle.';
        else {
          ann = hit.ev.edgeNotes || [];
          msg = hit.ev.steps.join('\n');
        }
        paint();
      }
    }
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (pointers.has(ev.pointerId)) pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (hands === 'pinch' || pointers.size >= 2) {
      if (hands !== 'pinch') beginPinch();
      else pinchApply();
      return;
    }
    if (hands === 'hold' || !active) return;
    const p = norm(ev);
    if (active.tool === 'pen') {
      const last = active.points[active.points.length - 1];
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.004) active.points.push(p);
      paint();
    } else if (active.tool === 'editwait') {
      active.raw = [p[0], p[1]];
      if (cssDist(active.x0, active.y0, p[0], p[1]) > 12) beginLengthDrag(active, bestEdge(active.grab, p, Math.PI));
      if (active.tool === 'dragend') updateLengthDrag(active, p);
    } else if (active.tool === 'line' || active.tool === 'free') {
      active.raw = [p[0], p[1]];
      if (!active.decided && active.grab && cssDist(active.x0, active.y0, p[0], p[1]) > 12) {
        const info = bestEdge(active.grab, p, 24 * Math.PI / 180);
        if (info) beginLengthDrag(active, info);
        else active.decided = 'draw';
      }
      if (active.tool === 'dragend') { updateLengthDrag(active, p); return; }
      const placed = placeEnd(active.start, p[0], p[1], active.tool === 'free');
      active.end = placed.end;
      active.angled = placed.angled;
      showSnap(placed.mark);
      paint();
    } else if (active.tool === 'text') {
      if (cssDist(active.x0, active.y0, p[0], p[1]) > 12) {
        if (!active.moved && active.origin) { undo.push(active.origin); if (undo.length > 40) undo.shift(); }
        active.moved = true;
      }
      if (active.moved) { doc = moveText(doc, active.id, p[0], p[1]); paint(); }
    } else if (active.tool === 'shape') {
      if (cssDist(active.x0, active.y0, p[0], p[1]) > 8) {
        if (!active.moved && active.origin) { undo.push(active.origin); if (undo.length > 40) undo.shift(); }
        active.moved = true;
      }
      if (active.moved) {
        const s = (doc.shapes || []).find((x) => x.id === active.id);
        if (s) {
          if (active.mode === 'tip') { s.x2 = p[0]; s.y2 = p[1]; }
          else if (active.mode === 'tail') { s.x = p[0]; s.y = p[1]; }
          else {
            s.x = active.ox + (p[0] - active.x);
            s.y = active.oy + (p[1] - active.y);
            if (s.kind === 'arrow') { s.x2 = active.ox2 + (p[0] - active.x); s.y2 = active.oy2 + (p[1] - active.y); }
          }
        }
        paint();
      }
    } else if (active.tool === 'symbol' || active.tool === 'arrow') {
      active.raw = [p[0], p[1]];
      if (active.tool === 'arrow') paint();
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
      updateLengthDrag(active, p);
    }
  });
  const end = async () => {
    if (!active) return;
    const act = active; active = null; showSnap(null);
    if (act.tool === 'pen' && act.points.length >= 2) { doc.pen = pen; await commit(addStroke(doc, act.points, pen)); }
    else if (act.tool === 'editwait') {
      if (cssDist(act.x0, act.y0, act.raw[0], act.raw[1]) <= 12) {
        selectedEdge = act.hitEdge || doc.edges.find((e) => e.a === act.grab.id || e.b === act.grab.id)?.id || null;
        paint();
      }
    } else if (act.tool === 'line' || act.tool === 'free') {
      const moved = cssDist(act.x0, act.y0, act.raw[0], act.raw[1]) > 12;
      if (!moved) {
        if (act.hitEdge) selectedEdge = act.hitEdge;
        else { selectedEdge = null; detail = null; selectedShape = null; selectedText = null; }
        paint();
        return;
      }
      const rights = act.tool === 'line' ? rightAtJoin(doc, act.start, act.end) : [];
      if (act.angled?.right) rights.push(act.angled.right);
      const next = addLine(doc, act.start, act.end, { free: act.tool === 'free', rights, color: lineColor, dash: lineDash });
      if (next.edges.length !== doc.edges.length || next.nodes.length !== doc.nodes.length || next.rights.length !== doc.rights.length) {
        await commit(next);
        await refreshArea();
      } else paint();
    }     else if (act.tool === 'text' && act.moved) await persist();
    else if (act.tool === 'text' && !act.moved) {
      selectedText = act.id;
      const t = (doc.texts || []).find((x) => x.id === act.id);
      if (t) openForm('text-edit', t.text);
      else paint();
    } else if (act.tool === 'symbol') {
      const p = act.raw || [act.x0, act.y0];
      if (cssDist(act.x0, act.y0, p[0], p[1]) <= 14) {
        await commit(addShape(doc, symbolAt(act.kind, act.x0, act.y0)));
        selectedShape = doc.shapes?.[doc.shapes.length - 1]?.id || null;
        selectedEdge = null;
        selectedText = null;
      } else paint();
    } else if (act.tool === 'arrow') {
      const p = act.raw || [act.x0, act.y0];
      const dragged = cssDist(act.x0, act.y0, p[0], p[1]) > 14;
      let x2 = p[0], y2 = p[1];
      if (!dragged || Math.hypot(x2 - act.x0, y2 - act.y0) < 0.012) {
        const span = arrowSpan(view.iw || 1000, view.ih || 1400);
        x2 = act.x0 + span.dx;
        y2 = act.y0;
        if (x2 > 0.98) x2 = act.x0 - span.dx;
      }
      await commit(addShape(doc, { kind: 'arrow', x: act.x0, y: act.y0, x2, y2, color: lineColor, dash: false }));
      selectedShape = doc.shapes?.[doc.shapes.length - 1]?.id || null;
      selectedEdge = null;
      selectedText = null;
    } else if (act.tool === 'shape' && act.moved) await persist();
    else if (act.tool === 'face' && act.moved) {
      const base = (doc.faceOffsets || []).find((f) => f.sig === act.sig) || { dx: 0, dy: 0 };
      await commit(setFaceOffset(doc, act.sig, (base.dx || 0) + act.dx, (base.dy || 0) + act.dy));
    } else if (act.tool === 'face') paint();
    else if (act.tool === 'angle') {
      const res = toggleRight(doc, act.nodeId);
      if (!res.error) { await commit(res.doc); await refreshArea(); }
    }     else if (act.tool === 'dragend' && act.moved && act.pos) {
      await commit(act.split ? moveSplitPoint(doc, act.nodeId, act.pos.x, act.pos.y) : placeEndpoint(doc, act.nodeId, act.pos));
      selectedEdge = edgeById(doc, act.edgeId) ? act.edgeId : null;
      await refreshArea();
    } else if (act.tool === 'movenode' && act.moved) { await commit(moveNode(doc, act.id, act.nx, act.ny)); await refreshArea(); }
    else if (act.tool === 'moveedge' && act.moved) { await commit(moveEdge(doc, act.id, act.dx, act.dy)); await refreshArea(); }
    else paint();
  };
  const release = async (ev) => {
    pointers.delete(ev.pointerId);
    if (hands === 'pinch' || hands === 'hold') {
      if (pointers.size >= 2) return;
      hands = pointers.size === 0 ? null : 'hold';
      pinchRef = null;
      active = null;
      showSnap(null);
      return;
    }
    if (pointers.size > 0) { beginPinch(); return; }
    const movedPx = down ? Math.hypot(ev.clientX - down.x, ev.clientY - down.y) : 0;
    const tap = !down || movedPx <= 14;
    const placing = tool === 'rect' || tool === 'circle' || tool === 'arrow';
    const doubleShape = !down || tool === 'pen' || tool === 'measure' ? null : down.shape;
    if (tap && !(placing && !doubleShape) && Date.now() - lastTapAt < 360 && Math.hypot(ev.clientX - lastTapX, ev.clientY - lastTapY) < 32) {
      const textHit = !down || tool === 'measure' || placing ? null : down.text;
      const shapeHit = doubleShape;
      const lineHit = down && !placing && tool !== 'text' ? down.line : null;
      active = null;
      showSnap(null);
      hands = null;
      lastTapAt = 0;
      if (textHit) {
        selectedText = textHit.id; selectedEdge = null; selectedShape = null; selectedNode = null; detail = 'text';
        openForm('text-edit', textHit.text);
        paint();
        return;
      }
      if (shapeHit) {
        selectedShape = shapeHit.id; selectedEdge = null; selectedText = null; selectedNode = null; detail = 'shape'; paint(); return;
      }
      if (lineHit) {
        selectedEdge = lineHit.id; selectedShape = null; selectedText = null; selectedNode = null; detail = 'line'; paint(); return;
      }
      detail = null;
      selectedEdge = null;
      selectedShape = null;
      selectedText = null;
      resetZoom();
      return;
    }
    if (tap) { lastTapAt = Date.now(); lastTapX = ev.clientX; lastTapY = ev.clientY; }
    hands = null;
    await end();
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('touchstart', (ev) => ev.preventDefault(), { passive: false });
  canvas.addEventListener('touchmove', (ev) => ev.preventDefault(), { passive: false });
  el.querySelector('#drawZoom').onclick = (ev) => { ev.preventDefault(); ev.stopPropagation(); resetZoom(); };

  el.querySelector('#draw-pen').onclick = () => { tool = 'pen'; paint(); };
  el.querySelector('#draw-line').onclick = () => { tool = 'line'; lineDash = false; paint(); };
  el.querySelector('#draw-free').onclick = () => { tool = 'free'; lineDash = true; paint(); };
  el.querySelector('#draw-edit').onclick = () => { tool = 'edit'; paint(); };
  el.querySelector('#draw-rect').onclick = () => { tool = 'rect'; paint(); };
  el.querySelector('#draw-circle').onclick = () => { tool = 'circle'; paint(); };
  el.querySelector('#draw-arrow').onclick = () => { tool = 'arrow'; paint(); };
  el.querySelector('#draw-text').onclick = () => { tool = 'text'; paint(); };
  el.querySelector('#penBar').addEventListener('click', async (ev) => {
    const b = ev.target.closest('button'); if (!b) return;
    if (b.id === 'draw-dash') {
      const next = !(selectedShape ? (doc.shapes || []).find((s) => s.id === selectedShape)?.dash : selectedEdge ? edgeLook(edgeById(doc, selectedEdge) || {}).dash : lineDash);
      lineDash = next;
      if (selectedEdge) { await commit(setEdgeStyle(doc, selectedEdge, { dash: next })); await refreshArea(); return; }
      if (selectedShape) { await commit(patchShape(doc, selectedShape, { dash: next })); paint(); return; }
      paint();
      return;
    }
    if (b.dataset.w) pen = { ...pen, width: +b.dataset.w };
    if (b.dataset.c) {
      pen = { ...pen, color: b.dataset.c };
      lineColor = b.dataset.c;
      doc.pen = pen;
      if (selectedEdge) { await commit(setEdgeStyle(doc, selectedEdge, { color: b.dataset.c })); await refreshArea(); return; }
      if (selectedShape) { await commit(patchShape(doc, selectedShape, { color: b.dataset.c })); paint(); return; }
    }
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
      selectedShape = null;
      detail = null;
      ann = [];
    await persist();
    await refreshArea();
  };
  if (photoBtn) photoBtn.onclick = async () => { hidePhoto = !hidePhoto; await persist(); paint(); };
  el.querySelector('#drawBack').onclick = () => onBack();
  const TOOLS_KEY = 'baudoku-draw-tools';
  let toolsOpen = true;
  try { toolsOpen = localStorage.getItem(TOOLS_KEY) !== 'closed'; } catch (e) { /* privater Modus */ }
  function applyDock() {
    el.querySelector('.draw-tools').hidden = !toolsOpen;
    el.querySelector('.draw-keep').hidden = toolsOpen;
    const fold = el.querySelector('#draw-fold');
    if (fold) fold.setAttribute('aria-expanded', toolsOpen ? 'true' : 'false');
  }
  function setToolsOpen(open) {
    toolsOpen = !!open;
    try { localStorage.setItem(TOOLS_KEY, toolsOpen ? 'open' : 'closed'); } catch (e) { /* privater Modus */ }
    applyDock();
    paint();
  }
  el.querySelector('#draw-fold').onclick = () => setToolsOpen(false);
  el.querySelector('#draw-unfold').onclick = () => setToolsOpen(true);
  el.querySelector('#draw-home').onclick = () => onBack();
  el.querySelector('#draw-save').onclick = async () => { await persist(); msg = 'Gespeichert'; paint(); };
  applyDock();
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
  if (symbolsResized) persist();
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
    edgeEnds: () => doc.edges.map((e) => { const a = nodeById(doc, e.a), b = nodeById(doc, e.b); const look = edgeLook(e); return { label: e.label, x1: a?.x, y1: a?.y, x2: b?.x, y2: b?.y, free: !!e.free, m: e.measure ? e.measure.value : null, unit: e.measure?.unit || null, color: look.color, dash: look.dash }; }),
    shapes: () => (doc.shapes || []).map((s) => ({ kind: s.kind, x: s.x, y: s.y, x2: s.x2, y2: s.y2, text: s.text || '', w: s.w, h: s.h, d: s.d, color: s.color, dash: !!s.dash, symbol: !!s.symbol })),
    sheet: () => ({ w: view.iw || img.naturalWidth || img.width || 1, h: view.ih || img.naturalHeight || img.height || 1 }),
    toolsOpen: () => toolsOpen,
    nodes: () => doc.nodes.length,
    texts: () => (doc.texts || []).map((t) => ({ text: t.text, x: t.x, y: t.y })),
    faces: () => evaluateFaces(doc).map((f) => ({ text: f.text, x: f.x, y: f.y, ok: f.ok, free: f.free })),
    rights: () => (doc.rights || []).length,
    selected: () => !!selectedEdge,
    pen: () => ({ ...pen }),
    zoom: () => userZoom,
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
