// Ein Editor für Foto, leeres Blatt und vorhandene Flächenskizzen.
import * as db from './db.js';
import { parseNum } from './util.js';
import {
  emptyDoc, addLine, addStroke, addText, editText, moveText, deleteText, setMeasure, toggleRight,
  snapTarget, cycleAt, evaluateCycle, findCycles, importLegacyStrokes, importLegacySketch, legacyStrokes,
  nodeById, edgeById, fmtNum,
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
  drawStrokes(ctx, (doc.strokes || []).map((s) => ({ points: s.points, width: 0.012 })), w, h);
  for (const e of doc.edges || []) {
    const a = nodeById(doc, e.a), b = nodeById(doc, e.b);
    if (!a || !b) continue;
    ctx.beginPath(); ctx.moveTo(a.x * w, a.y * h); ctx.lineTo(b.x * w, b.y * h);
    ctx.strokeStyle = selected === e.id ? '#0b7285' : '#1f2933';
    ctx.lineWidth = selected === e.id ? Math.max(7, w / 80) : Math.max(4, w / 140);
    ctx.stroke();
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
  let tool = 'pen';
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
  const projectId = photo?.projectId || sheet?.projectId || sketch?.projectId;
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
    <div class="draw-tools">
      <button type="button" id="draw-pen" class="on"><span>✎</span>Stift</button>
      <button type="button" id="draw-line"><span>／</span>Linie</button>
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
    const shown = active?.tool === 'pen' && active.points?.length ? { ...doc, strokes: doc.strokes.concat([{ id: 'tmp', points: active.points }]) } : doc;
    const preview = active?.tool === 'line' && active.end ? addLine(shown, active.start, active.end) : shown;
    paintFitted(ctx, preview, selectedEdge);
    el.querySelector('#draw-undo').disabled = !undo.length;
    if (photoBtn) { photoBtn.querySelector('b').textContent = hidePhoto ? 'Foto an' : 'Foto aus'; photoBtn.classList.toggle('on', hidePhoto); }
    ['pen', 'line', 'text', 'measure', 'area'].forEach((t) => el.querySelector('#draw-' + t).classList.toggle('on', tool === t));
    el.querySelector('#drawMsg').textContent = msg;
    const ctxBar = el.querySelector('#drawCtx');
    ctxBar.innerHTML = [
      selectedNode ? '<button type="button" id="btn-right" class="btn">rechter Winkel</button>' : '',
      selectedEdge ? '<button type="button" id="btn-parallel" class="btn">parallel zu anderer Kante</button>' : '',
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
  }
  function paintFitted(ctx2, d, sel) {
    const X = (nx) => view.ox + nx * view.iw * view.s;
    const Y = (ny) => view.oy + ny * view.ih * view.s;
    drawStrokes(ctx2, (d.strokes || []).map((s) => ({ points: s.points.map((p) => [X(p[0]) / canvas.width, Y(p[1]) / canvas.height]), width: 0.012 })), canvas.width, canvas.height);
    for (const e of d.edges || []) {
      const a = nodeById(d, e.a), b = nodeById(d, e.b);
      if (!a || !b) continue;
      ctx2.beginPath(); ctx2.moveTo(X(a.x), Y(a.y)); ctx2.lineTo(X(b.x), Y(b.y));
      ctx2.strokeStyle = sel === e.id ? '#0b7285' : '#1f2933';
      ctx2.lineWidth = sel === e.id ? 8 : 4;
      ctx2.stroke();
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
    for (const t of d.texts || []) {
      ctx2.font = '700 18px sans-serif';
      const tw = ctx2.measureText(t.text || '').width + 14;
      ctx2.fillStyle = 'rgba(255,255,255,.94)'; ctx2.fillRect(X(t.x) - 6, Y(t.y) - 20, tw, 26);
      ctx2.fillStyle = '#111'; ctx2.textAlign = 'left'; ctx2.fillText(t.text || '', X(t.x), Y(t.y));
    }
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
    let best = null, bd = radiusNorm();
    for (const t of doc.texts || []) { const d = Math.hypot(t.x - p[0], t.y - p[1]); if (d < bd) { bd = d; best = t; } }
    return best;
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

  canvas.addEventListener('pointerdown', (ev) => {
    if (ev.button != null && ev.button !== 0) return;
    ev.preventDefault();
    try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* Test-Events */ }
    const p = norm(ev);
    if (tool === 'pen') active = { tool: 'pen', points: [p] };
    else if (tool === 'line') {
      const snap = snapTarget(doc, p[0], p[1], radiusNorm());
      active = { tool: 'line', start: snap || { x: p[0], y: p[1] }, end: snap || { x: p[0], y: p[1] } };
      showSnap(snap);
    } else if (tool === 'text') {
      const t = hitText(p);
      if (t) { selectedText = t.id; active = { tool: 'text', id: t.id, x: p[0], y: p[1], moved: false, origin: clone(doc) }; openForm('text-edit', t.text); }
      else { selectedText = null; form.dataset.pos = JSON.stringify(p); openForm('text-new', ''); }
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
      selectedNode = n ? n.id : null;
      if (!n) {
        const cyc = cycleAt(doc, p[0], p[1]);
        if (!cyc) msg = 'Keine geschlossene Fläche an dieser Stelle.';
        else {
          const ev = evaluateCycle(doc, cyc.nodes);
          ann = ev.edgeNotes || [];
          msg = ev.steps.join('\n');
          if (ev.ok) syncFaces(cyc, ev);
        }
      }
      paint();
    }
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (!active) return;
    const p = norm(ev);
    if (active.tool === 'pen') {
      const last = active.points[active.points.length - 1];
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.004) active.points.push(p);
      paint();
    } else if (active.tool === 'line') {
      const snap = snapTarget(doc, p[0], p[1], radiusNorm());
      active.end = snap || { x: p[0], y: p[1] };
      showSnap(snap);
      paint();
    } else if (active.tool === 'text') {
      if (Math.hypot(p[0] - active.x, p[1] - active.y) > 0.01) {
        if (!active.moved && active.origin) { undo.push(active.origin); if (undo.length > 40) undo.shift(); }
        active.moved = true;
      }
      if (active.moved) { doc = moveText(doc, active.id, p[0], p[1]); paint(); }
    }
  });
  const end = async () => {
    if (!active) return;
    const act = active; active = null; showSnap(null);
    if (act.tool === 'pen' && act.points.length >= 2) await commit(addStroke(doc, act.points));
    else if (act.tool === 'line') {
      const next = addLine(doc, act.start, act.end);
      if (next.edges.length !== doc.edges.length || next.nodes.length !== doc.nodes.length) await commit(next);
      else paint();
    } else if (act.tool === 'text' && act.moved) await persist();
    else paint();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  el.querySelector('#draw-pen').onclick = () => { tool = 'pen'; paint(); };
  el.querySelector('#draw-line').onclick = () => { tool = 'line'; paint(); };
  el.querySelector('#draw-text').onclick = () => { tool = 'text'; paint(); };
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
    for (const cyc of findCycles(doc)) {
      const ev = evaluateCycle(doc, cyc.nodes);
      lines.push(...(ev.steps || []));
      for (const n of ev.edgeNotes || []) ann.push(n);
      if (ev.ok) await syncFaces(cyc, ev);
    }
    msg = lines.join('\n');
    paint();
  }
  async function syncFaces(cyc, ev) {
    if (!projectId || !ev?.ok) return;
    const key = [...cyc.nodes].sort().join(',');
    const rows = await db.byProject('aufmass', projectId);
    let row = rows.find((r) => r.drawKey === key);
    if (row?.manual) return;
    const menge = Math.round(ev.area * 100) / 100;
    if (!row) {
      const n = rows.reduce((m, r) => Math.max(m, parseInt(r.pos, 10) || 0), 0) + 1;
      row = { id: 'face-' + Date.now(), projectId, order: Date.now(), pos: String(n).padStart(2, '0'), einheit: 'm²', manual: false, drawKey: key };
    }
    row.bez = 'Fläche ' + (ev.parts?.[0]?.label || 'F1');
    row.menge = menge;
    row.expr = fmtNum(menge);
    row.calc = { ok: true, result: menge, steps: ev.steps, parts: ev.parts, faceLabel: ev.parts?.map((p) => p.label).join(', '), shapeLabel: 'Skizze', areaKind: 'projection', areaKindLabel: 'aus Maßen', isDeduction: false, edges: [], formula: (ev.steps.find((s) => s.startsWith('Formel:')) || '').replace('Formel: ', ''), substitution: (ev.steps.at(-1) || '').replace('Rechnung: ', ''), missing: [] };
    await db.put('aufmass', row);
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
        if (s.type === 'stroke') return { tool: 'pen', n: (doc.strokes.find((x) => x.id === s.id)?.points.length) || 0 };
        return { tool: 'line', n: 2 };
      });
    },
    edges: () => doc.edges.length,
    nodes: () => doc.nodes.length,
    texts: () => (doc.texts || []).map((t) => ({ text: t.text, x: t.x, y: t.y })),
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
