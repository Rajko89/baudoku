// Lesen und PDF alter Flächenskizzen. Der frühere Editor wird nicht mehr geöffnet.
import * as db from './db.js';
import { uid } from './util.js';
import { resolveEdgeLength, computeFace, fmtM } from './sketch-calc.js';

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
