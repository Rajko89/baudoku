// Foto-Aufmaß-Editor: Maßstab, 4-Punkt-Perspektive, Längen (Polylinien), Flächen (Polygone)
import { dist, centroid, realMapper, measureValue, orderQuad, homography, applyH, invert3, hW, emptyMeasure } from './geom.js';
import { fmtNum, modal, parseNum, toast, esc, uid, confirmDlg } from './util.js';

const COL = { line: '#ff7a1a', area: '#40c057', scale: '#ffd43b', persp: '#22b8cf', sel: '#ffffff' };
export function fmtVal(v) { return v ? `${fmtNum(v.value, 2)} ${v.unit}` : 'nicht kalibriert'; }

/* ---------- Zeichnen (Bildschirm und Export gemeinsam) ---------- */
function label(ctx, x, y, text, color, fs) {
  ctx.font = `700 ${fs}px system-ui, -apple-system, Roboto, Arial, sans-serif`;
  const w = ctx.measureText(text).width + fs * 0.8, h = fs * 1.45;
  ctx.fillStyle = 'rgba(0,0,0,.78)'; ctx.strokeStyle = color; ctx.lineWidth = Math.max(1.5, fs / 9);
  const r = h / 3, x0 = x - w / 2, y0 = y - h / 2;
  ctx.beginPath(); ctx.moveTo(x0 + r, y0); ctx.arcTo(x0 + w, y0, x0 + w, y0 + h, r); ctx.arcTo(x0 + w, y0 + h, x0, y0 + h, r); ctx.arcTo(x0, y0 + h, x0, y0, r); ctx.arcTo(x0, y0, x0 + w, y0, r); ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, x, y + fs * 0.04);
}
function path(ctx, pts, T, closed) { ctx.beginPath(); pts.forEach((p, i) => { const [x, y] = T(p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); if (closed) ctx.closePath(); }
function dots(ctx, pts, T, r, color) { pts.forEach(p => { const [x, y] = T(p); ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = Math.max(2, r / 2.5); ctx.strokeStyle = color; ctx.stroke(); }); }
function midLabelPos(pts, T) {
  let best = 0, bi = 0; for (let i = 1; i < pts.length; i++) { const d = dist(T(pts[i - 1]), T(pts[i])); if (d > best) { best = d; bi = i; } }
  const a = T(pts[bi - 1] || pts[0]), b = T(pts[bi]); return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}
/** zeichnet alle Messungen. T = Bild->Ziel-Koordinaten. o = {fs, lw, pr, selected, draft, tool, editable} */
export function drawOverlay(ctx, m, T, o) {
  const mapper = realMapper(m);
  const { fs, lw, pr } = o;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  // Referenz
  if (m.scale && (m.mode === 'scale' || o.showAllRefs)) {
    const p = [m.scale.a, m.scale.b];
    ctx.setLineDash([lw * 3, lw * 2]); path(ctx, p, T); ctx.strokeStyle = '#000'; ctx.lineWidth = lw + 2; ctx.stroke(); ctx.strokeStyle = COL.scale; ctx.lineWidth = lw; ctx.stroke(); ctx.setLineDash([]);
    if (o.editable) dots(ctx, p, T, pr, COL.scale);
    const [x, y] = midLabelPos(p, T); label(ctx, x, y - fs * 1.3, `Ref. ${fmtNum(m.scale.len, 2)} m`, COL.scale, fs * 0.9);
  }
  if (m.persp && m.persp.pts?.length === 4 && (m.mode === 'persp' || o.showAllRefs)) {
    const p = m.persp.pts;
    path(ctx, p, T, true); ctx.fillStyle = 'rgba(34,184,207,.12)'; ctx.fill(); ctx.setLineDash([lw * 3, lw * 2]); ctx.strokeStyle = COL.persp; ctx.lineWidth = lw; ctx.stroke(); ctx.setLineDash([]);
    if (o.editable) { dots(ctx, p, T, pr, COL.persp); p.forEach((q, i) => { const [x, y] = T(q); ctx.fillStyle = '#000'; ctx.font = `700 ${fs * .7}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(i + 1), x, y); }); }
    const [x, y] = T(centroid(p)); label(ctx, x, y, `Ref. ${fmtNum(m.persp.w, 2)} × ${fmtNum(m.persp.h, 2)} m`, COL.persp, fs * 0.9);
  }
  // Messungen
  m.items.forEach((it, idx) => {
    const sel = o.selected === it.id; const c = COL[it.type];
    if (it.type === 'area' && it.pts.length >= 3) { path(ctx, it.pts, T, true); ctx.fillStyle = sel ? 'rgba(64,192,87,.38)' : 'rgba(64,192,87,.22)'; ctx.fill(); }
    path(ctx, it.pts, T, it.type === 'area');
    ctx.strokeStyle = '#000'; ctx.lineWidth = lw + 2.5; ctx.stroke();
    ctx.strokeStyle = sel ? COL.sel : c; ctx.lineWidth = sel ? lw * 1.4 : lw; ctx.stroke();
    if (o.editable && (sel || o.tool === 'select')) dots(ctx, it.pts, T, sel ? pr : pr * 0.6, c);
    const v = measureValue(m, it, mapper);
    const txt = `${it.name || (idx + 1)}: ${v ? fmtNum(v.value, 2) + ' ' + v.unit : '?'}`;
    const [x, y] = it.type === 'area' && it.pts.length >= 3 ? T(centroid(it.pts)) : midLabelPos(it.pts, T);
    label(ctx, x, y - (it.type === 'line' ? fs * 1.2 : 0), txt, sel ? '#fff' : c, fs);
  });
  // Entwurf
  const d = o.draft;
  if (d && d.pts.length) {
    const c = COL[d.type] || '#fff';
    if (d.type === 'area' && d.pts.length >= 3) { path(ctx, d.pts, T, true); ctx.fillStyle = 'rgba(64,192,87,.25)'; ctx.fill(); }
    path(ctx, d.pts, T, d.type === 'area' || (d.type === 'persp' && d.pts.length === 4));
    ctx.strokeStyle = '#000'; ctx.lineWidth = lw + 2.5; ctx.stroke(); ctx.strokeStyle = c; ctx.lineWidth = lw; ctx.stroke();
    dots(ctx, d.pts, T, pr, c);
    if (d.type === 'persp') d.pts.forEach((q, i) => { const [x, y] = T(q); ctx.fillStyle = '#000'; ctx.font = `700 ${fs * .7}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(i + 1), x, y); });
    if ((d.type === 'line' || d.type === 'area') && mapper) {
      const v = measureValue(m, { type: d.type, pts: d.pts, usePitch: d.type === 'area' && m.mode === 'scale' }, mapper);
      if (v) { const [x, y] = T(d.pts[d.pts.length - 1]); label(ctx, x, y - fs * 1.8, fmtNum(v.value, 2) + ' ' + v.unit, c, fs); }
    }
  }
}
/** Bild mit eingezeichnetem Aufmaß (für PDF) */
export function renderAnnotated(img, m, max = 1800) {
  const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
  const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, c.width, c.height);
  const base = Math.max(c.width, c.height);
  drawOverlay(ctx, m, p => [p[0] * k, p[1] * k], { fs: Math.max(14, base / 55), lw: Math.max(3, base / 380), pr: base / 200 });
  return c;
}

/* ---------- Entzerrung (Draufsicht aus 4-Punkt-Referenz) ---------- */
export function rectify(img, m, maxPx = 1800) {
  const { pts, w, h } = m.persp;
  const H = homography(pts, [[0, 0], [w, 0], [w, h], [0, h]]); const Hi = invert3(H);
  if (!H || !Hi) throw new Error('Referenz ungültig');
  const IW = img.naturalWidth, IH = img.naturalHeight, sgn = Math.sign(hW(H, pts[0]));
  let x0 = 0, y0 = 0, x1 = w, y1 = h;
  for (const c of [[0, 0], [IW, 0], [IW, IH], [0, IH]]) {
    if (Math.sign(hW(H, c)) !== sgn) continue; const q = applyH(H, c);
    x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]);
  }
  x0 = Math.max(x0, -3 * w); y0 = Math.max(y0, -3 * h); x1 = Math.min(x1, 4 * w); y1 = Math.min(y1, 4 * h);
  const ppm = maxPx / Math.max(x1 - x0, y1 - y0);
  const OW = Math.max(1, Math.round((x1 - x0) * ppm)), OH = Math.max(1, Math.round((y1 - y0) * ppm));
  const sk = Math.min(1, 3000 / Math.max(IW, IH));
  const sc = document.createElement('canvas'); sc.width = Math.round(IW * sk); sc.height = Math.round(IH * sk);
  const sctx = sc.getContext('2d'); sctx.drawImage(img, 0, 0, sc.width, sc.height);
  const S = sctx.getImageData(0, 0, sc.width, sc.height).data, SW = sc.width, SH = sc.height;
  const out = document.createElement('canvas'); out.width = OW; out.height = OH;
  const octx = out.getContext('2d'); const O = octx.createImageData(OW, OH); const D = O.data;
  for (let y = 0; y < OH; y++) {
    const Y = y0 + (y + 0.5) / ppm;
    for (let x = 0; x < OW; x++) {
      const X = x0 + (x + 0.5) / ppm;
      const ww = Hi[6] * X + Hi[7] * Y + Hi[8];
      const sx = (Hi[0] * X + Hi[1] * Y + Hi[2]) / ww * sk - 0.5, sy = (Hi[3] * X + Hi[4] * Y + Hi[5]) / ww * sk - 0.5;
      const o = (y * OW + x) * 4;
      if (sx < 0 || sy < 0 || sx >= SW - 1 || sy >= SH - 1) { D[o] = 30; D[o + 1] = 30; D[o + 2] = 30; D[o + 3] = 255; continue; }
      const ix = sx | 0, iy = sy | 0, fx = sx - ix, fy = sy - iy;
      const i00 = (iy * SW + ix) * 4, i10 = i00 + 4, i01 = i00 + SW * 4, i11 = i01 + 4;
      for (let c = 0; c < 3; c++) D[o + c] = (S[i00 + c] * (1 - fx) + S[i10 + c] * fx) * (1 - fy) + (S[i01 + c] * (1 - fx) + S[i11 + c] * fx) * fy;
      D[o + 3] = 255;
    }
  }
  octx.putImageData(O, 0, 0);
  const T = p => { const q = applyH(H, p); return [(q[0] - x0) * ppm, (q[1] - y0) * ppm]; };
  const nm = emptyMeasure(); nm.mode = 'scale';
  nm.scale = { a: T(pts[0]), b: T(pts[1]), len: w };
  nm.items = m.items.map(it => ({ ...it, id: uid(), aufmassId: null, pts: it.pts.map(T) }));
  return { canvas: out, measure: nm };
}

/* ---------- Interaktiver Editor ---------- */
export function mountEditor(root, { img, measure, title, onChange, onToAufmass, onRectify, onBack }) {
  const m = measure ? JSON.parse(JSON.stringify(measure)) : emptyMeasure();
  m.items = m.items || [];
  let tool = m.mode === 'none' ? 'scale' : 'select', draft = null, selected = null;
  const view = { k: 1, tx: 0, ty: 0 }; let dpr = window.devicePixelRatio || 1;
  root.innerHTML = `<div class="me">
    <div class="hdr"><button class="ib" data-a="back" aria-label="Zurück">←</button><h1>Aufmaß<span class="sub">${esc(title || '')}</span></h1>
      <button class="ib" data-a="list" aria-label="Liste">☰</button><button class="ib" data-a="menu" aria-label="Menü">⋯</button></div>
    <div class="status"></div>
    <div class="hint"></div>
    <canvas></canvas>
    <div class="ctx"></div>
    <div class="tools">
      <button data-t="select"><span>✋</span>Auswahl</button>
      <button data-t="scale"><span>📏</span>Maßstab</button>
      <button data-t="persp"><span>⬚</span>Perspektive</button>
      <button data-t="line"><span>〰</span>Länge</button>
      <button data-t="area"><span>▱</span>Fläche</button>
    </div></div>`;
  const cv = root.querySelector('canvas'), ctx = cv.getContext('2d');
  const $hint = root.querySelector('.hint'), $ctx = root.querySelector('.ctx'), $status = root.querySelector('.status');
  let saveT; const changed = () => { clearTimeout(saveT); saveT = setTimeout(() => onChange(JSON.parse(JSON.stringify(m))), 250); };
  const flush = () => { clearTimeout(saveT); return onChange(JSON.parse(JSON.stringify(m))); };
  const toS = p => [p[0] * view.k + view.tx, p[1] * view.k + view.ty];
  const toI = (x, y) => [(x - view.tx) / view.k, (y - view.ty) / view.k];
  const clampI = p => [Math.max(0, Math.min(img.naturalWidth, p[0])), Math.max(0, Math.min(img.naturalHeight, p[1]))];
  function fit() { const W = cv.clientWidth, H = cv.clientHeight; view.k = Math.min(W / img.naturalWidth, H / img.naturalHeight) * 0.96; view.tx = (W - img.naturalWidth * view.k) / 2; view.ty = (H - img.naturalHeight * view.k) / 2; }
  function resize() { dpr = window.devicePixelRatio || 1; const W = cv.clientWidth, H = cv.clientHeight; if (!W || !H) return; const first = !cv.width || cv.width === 300; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); if (first) fit(); draw(); }
  const ro = new ResizeObserver(resize); ro.observe(cv);
  let loupe = null;
  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#111'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.setTransform(dpr * view.k, 0, 0, dpr * view.k, dpr * view.tx, dpr * view.ty); ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawOverlay(ctx, m, toS, { fs: 14, lw: 3, pr: 9, selected, draft, tool, editable: true, showAllRefs: false });
    if (loupe) {
      const R = 62, Z = 3, [px, py] = toS(loupe); const cx = px < 160 && py < 180 ? cv.clientWidth - R - 12 : R + 12, cy = R + 12;
      ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.clip(); ctx.fillStyle = '#000'; ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);
      const k = view.k * Z; ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * (cx - loupe[0] * k), dpr * (cy - loupe[1] * k)); ctx.drawImage(img, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawOverlay(ctx, m, p => [cx + (p[0] - loupe[0]) * k, cy + (p[1] - loupe[1]) * k], { fs: 12, lw: 2, pr: 0.01, selected, draft: draft && { ...draft }, tool: '', editable: false });
      ctx.strokeStyle = '#ff0'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
      ctx.restore(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.stroke();
    }
  }
  const HINTS = {
    select: 'Punkte ziehen zum Korrigieren · Messung antippen zum Bearbeiten · 2 Finger: Zoom/Verschieben',
    scale: 'Maßstab: Anfang und Ende einer bekannten Strecke antippen (z. B. Zollstock, Dachfenster, Ziegelreihe)',
    persp: 'Perspektive: 4 Ecken eines bekannten Rechtecks antippen (z. B. Dachfenster, Tür, Plattenformat) – Reihenfolge egal',
    line: 'Länge: Punkte nacheinander antippen, dann „Fertig“',
    area: 'Fläche: Eckpunkte nacheinander antippen, dann „Fertig“',
  };
  function calibText() {
    if (m.mode === 'persp' && m.persp) return `<span class="pill ok">Perspektive ${fmtNum(m.persp.w, 2)} × ${fmtNum(m.persp.h, 2)} m</span>`;
    if (m.mode === 'scale' && m.scale) return `<span class="pill ok">Maßstab ${fmtNum(m.scale.len, 2)} m</span>`;
    return `<span class="pill" style="background:#c92a2a">nicht kalibriert</span>`;
  }
  function ui() {
    root.querySelectorAll('.tools button').forEach(b => b.classList.toggle('on', b.dataset.t === tool));
    $hint.textContent = HINTS[tool];
    $status.innerHTML = `${calibText()}<span class="pill" data-a="pitch" role="button">Neigung ${m.pitch ? fmtNum(m.pitch, 0) + '°' : '–'}</span><span class="pill">${m.items.length} Messung${m.items.length === 1 ? '' : 'en'}</span>`;
    let h = '';
    if (draft && draft.pts.length) {
      h += `<button class="btn" data-a="undo">↶ Punkt</button><button class="btn" data-a="cancel">✕ Abbrechen</button>`;
      if (draft.type === 'line' || draft.type === 'area') {
        const v = measureValue(m, { type: draft.type, pts: draft.pts, usePitch: draft.type === 'area' && m.mode === 'scale' });
        h += `<button class="btn primary" data-a="finish" ${draft.pts.length < (draft.type === 'line' ? 2 : 3) ? 'disabled' : ''}>✓ Fertig${v ? ' · ' + fmtNum(v.value, 2) + ' ' + v.unit : ''}</button>`;
      }
    } else if (selected) {
      const it = m.items.find(i => i.id === selected);
      if (it) {
        const v = measureValue(m, it);
        h += `<div style="flex-basis:100%;color:#fff;padding:2px 4px"><b>${esc(it.name)}</b> · ${fmtVal(v)}${it.usePitch && m.pitch ? ` (inkl. Neigung ${fmtNum(m.pitch, 0)}°)` : ''}${it.aufmassId ? ' · im Aufmaß ✓' : ''}</div>
          <button class="btn" data-a="rename">✎ Name</button><button class="btn" data-a="togglePitch">${it.usePitch ? '∠ Neigung an' : '∠ Neigung aus'}</button>
          <button class="btn primary" data-a="toAm">→ Aufmaß</button><button class="btn" data-a="delItem">🗑</button>`;
      }
    }
    $ctx.innerHTML = h;
    draw();
  }
  function setTool(t) {
    if ((t === 'scale' || t === 'persp') && m.mode !== 'none' && m.items.length && t !== tool) toast('Hinweis: Eine neue Kalibrierung ersetzt die bisherige – alle Messungen dieses Fotos werden neu berechnet.', 4500);
    tool = t; draft = (t === 'select') ? null : { type: t, pts: [] }; selected = null; ui(); }

  /* --- Eingabe --- */
  const ptrs = new Map(); let g = null;
  const pos = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  function editablePointLists() {
    const L = [];
    if (draft) L.push(draft.pts);
    if (tool === 'select') {
      if (m.mode === 'scale' && m.scale) L.push([m.scale.a, m.scale.b]);
      if (m.mode === 'persp' && m.persp) L.push(m.persp.pts);
      const s = m.items.find(i => i.id === selected); if (s) L.unshift(s.pts);
      m.items.forEach(i => i.id !== selected && L.push(i.pts));
    }
    return L;
  }
  function hitPoint(sx, sy, touch) {
    const R = touch ? 26 : 12; let best = null, bd = R;
    for (const arr of editablePointLists()) arr.forEach((p, i) => { const [x, y] = toS(p); const d = Math.hypot(x - sx, y - sy); if (d < bd) { bd = d; best = { arr, i }; } });
    return best;
  }
  function hitItem(sx, sy) {
    const p = toI(sx, sy);
    for (let n = m.items.length - 1; n >= 0; n--) {
      const it = m.items[n];
      for (let i = 1; i < it.pts.length + (it.type === 'area' ? 1 : 0); i++) {
        const a = toS(it.pts[i - 1]), b = toS(it.pts[i % it.pts.length]);
        const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy || 1; const t = Math.max(0, Math.min(1, ((sx - a[0]) * dx + (sy - a[1]) * dy) / L));
        if (Math.hypot(a[0] + t * dx - sx, a[1] + t * dy - sy) < 20) return it.id;
      }
      if (it.type === 'area') { let ins = false; for (let i = 0, j = it.pts.length - 1; i < it.pts.length; j = i++) { const [xi, yi] = it.pts[i], [xj, yj] = it.pts[j]; if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) ins = !ins; } if (ins) return it.id; }
    }
    return null;
  }
  cv.addEventListener('pointerdown', e => {
    cv.setPointerCapture(e.pointerId); const [x, y] = pos(e); ptrs.set(e.pointerId, [x, y]);
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()]; g = { type: 'pinch', d0: Math.hypot(a[0] - b[0], a[1] - b[1]), k0: view.k, ip: toI((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) }; loupe = null; draw(); return;
    }
    if (ptrs.size > 2) return;
    const hp = hitPoint(x, y, e.pointerType !== 'mouse');
    if (hp) { g = { type: 'drag', hp, sx: x, sy: y, moved: false, off: [hp.arr[hp.i][0] - toI(x, y)[0], hp.arr[hp.i][1] - toI(x, y)[1]] }; }
    else g = { type: 'pending', sx: x, sy: y, tx: view.tx, ty: view.ty };
  });
  cv.addEventListener('pointermove', e => {
    if (!ptrs.has(e.pointerId) || !g) return; const [x, y] = pos(e); ptrs.set(e.pointerId, [x, y]);
    if (g.type === 'pinch' && ptrs.size >= 2) {
      const [a, b] = [...ptrs.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      view.k = Math.max(0.02, Math.min(40, g.k0 * d / g.d0)); const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      view.tx = mx - g.ip[0] * view.k; view.ty = my - g.ip[1] * view.k; draw(); return;
    }
    if (g.type === 'drag') {
      if (!g.moved && Math.hypot(x - g.sx, y - g.sy) < 3) return; g.moved = true;
      const p = clampI([toI(x, y)[0] + g.off[0], toI(x, y)[1] + g.off[1]]); g.hp.arr[g.hp.i][0] = p[0]; g.hp.arr[g.hp.i][1] = p[1];
      loupe = p; draw(); return;
    }
    if (g.type === 'pending' && Math.hypot(x - g.sx, y - g.sy) > 8) g.type = 'pan';
    if (g.type === 'pan') { view.tx = g.tx + x - g.sx; view.ty = g.ty + y - g.sy; draw(); }
  });
  const end = e => {
    if (!ptrs.has(e.pointerId)) return; ptrs.delete(e.pointerId);
    if (!g) return;
    if (g.type === 'pinch') { if (ptrs.size === 0) g = null; else { const [p] = [...ptrs.values()]; g = { type: 'pan', sx: p[0], sy: p[1], tx: view.tx, ty: view.ty }; } return; }
    if (ptrs.size) return;
    const gg = g; g = null; loupe = null;
    if (gg.type === 'drag') { if (gg.moved) { changed(); ui(); } else tap(gg.sx, gg.sy, true); return; }
    if (gg.type === 'pending' && e.type === 'pointerup') tap(gg.sx, gg.sy, false);
    draw();
  };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  cv.addEventListener('wheel', e => { e.preventDefault(); const [x, y] = pos(e); const ip = toI(x, y); view.k = Math.max(0.02, Math.min(40, view.k * Math.exp(-e.deltaY * 0.0015))); view.tx = x - ip[0] * view.k; view.ty = y - ip[1] * view.k; draw(); }, { passive: false });
  cv.addEventListener('dblclick', e => e.preventDefault());

  async function tap(sx, sy, onPoint) {
    const p = toI(sx, sy);
    const inside = p[0] >= 0 && p[1] >= 0 && p[0] <= img.naturalWidth && p[1] <= img.naturalHeight;
    if (tool === 'select') { selected = hitItem(sx, sy); ui(); return; }
    if (!inside || !draft) return;
    if (onPoint) return; // Tippen auf vorhandenen Punkt fügt keinen Punkt hinzu
    draft.pts.push(clampI(p));
    if (tool === 'scale' && draft.pts.length === 2) { ui(); return askScale(); }
    if (tool === 'persp' && draft.pts.length === 4) { draft.pts = orderQuad(draft.pts); ui(); return askPersp(); }
    ui();
  }
  async function askScale(pre) {
    const r = await modal({ title: 'Maßstab festlegen', html: '<p class="small">Reale Länge der markierten Referenzstrecke:</p>', fields: [{ name: 'len', label: 'Länge in m', inputmode: 'decimal', value: pre ? fmtNum(pre, 2) : '', placeholder: 'z. B. 1,00' }], buttons: [{ label: 'Abbrechen', value: null }, { label: 'Übernehmen', value: 'ok', cls: 'primary' }] });
    const len = r && parseNum(r.len);
    if (!(len > 0)) { if (r) toast('Bitte gültige Länge eingeben'); if (!pre) { draft.pts = []; } ui(); return; }
    if (draft && draft.type === 'scale') m.scale = { a: draft.pts[0], b: draft.pts[1], len }; else if (m.scale) m.scale.len = len;
    m.mode = 'scale'; changed(); setTool('select'); toast(`Maßstab gesetzt: ${fmtNum(len, 2)} m`);
  }
  async function askPersp(pre) {
    const r = await modal({ title: 'Referenz-Rechteck', html: '<p class="small">Ecken: 1 oben links → 2 oben rechts → 3 unten rechts → 4 unten links. Reale Maße:</p>',
      fields: [{ name: 'w', label: 'Breite 1→2 (m)', inputmode: 'decimal', value: pre ? fmtNum(pre.w, 2) : '' }, { name: 'h', label: 'Höhe 2→3 (m)', inputmode: 'decimal', value: pre ? fmtNum(pre.h, 2) : '' }],
      buttons: [{ label: 'Abbrechen', value: null }, { label: 'Übernehmen', value: 'ok', cls: 'primary' }] });
    const w = r && parseNum(r.w), h = r && parseNum(r.h);
    if (!(w > 0 && h > 0)) { if (r) toast('Bitte Breite und Höhe eingeben'); if (!pre) draft.pts = []; ui(); return; }
    if (draft && draft.type === 'persp') m.persp = { pts: draft.pts, w, h }; else if (m.persp) { m.persp.w = w; m.persp.h = h; }
    m.mode = 'persp'; changed(); setTool('select'); toast(m.pitch ? 'Perspektive kalibriert – Neigung wird bei neuen Flächen nicht angewendet (Referenz liegt in der Dachebene)' : 'Perspektive kalibriert', 4000);
  }
  async function finishDraft() {
    const type = draft.type, n = m.items.filter(i => i.type === type).length + 1;
    const def = (type === 'line' ? 'Länge ' : 'Fläche ') + n;
    const r = await modal({ title: type === 'line' ? 'Länge speichern' : 'Fläche speichern', fields: [{ name: 'name', label: 'Bezeichnung', value: def, placeholder: 'z. B. Traufe, Dachfläche Süd' }],
      html: `<p><b>${fmtVal(measureValue(m, { type, pts: draft.pts, usePitch: type === 'area' && m.mode === 'scale' }))}</b></p>`, buttons: [{ label: 'Zurück', value: null }, { label: 'Speichern', value: 'ok', cls: 'primary' }] });
    if (!r) return;
    const it = { id: uid(), type, name: r.name.trim() || def, pts: draft.pts, usePitch: type === 'area' && m.pitch > 0 && m.mode === 'scale', aufmassId: null };
    m.items.push(it); draft = { type, pts: [] }; changed(); ui();
    if (!realMapper(m)) toast('Gespeichert – noch kein Maßstab gesetzt');
  }
  async function editPitch() {
    const r = await modal({ title: 'Dachneigung', html: '<p class="small">Nur verwenden, wenn das Foto die Fläche <b>senkrecht von oben</b> zeigt (Draufsicht, Drohne, Luftbild) oder die Referenz waagerecht liegt. Fläche wird dann durch cos(Neigung) geteilt. Bei Perspektive-Kalibrierung direkt auf der Dachfläche: 0 lassen.</p>',
      fields: [{ name: 'p', label: 'Neigung in Grad', inputmode: 'decimal', value: m.pitch ? fmtNum(m.pitch, 1) : '0' }] });
    if (!r) return; const p = parseNum(r.p); if (!(p >= 0 && p < 89)) return toast('Neigung 0–88°');
    const was = +m.pitch || 0; m.pitch = p;
    if (p > 0 && !was) m.items.forEach(i => { if (i.type === 'area') i.usePitch = true; });
    changed(); ui();
  }
  async function showList() {
    const mp = realMapper(m);
    const rows = m.items.map(it => { const v = measureValue(m, it, mp); return `<div class="mi"><span class="sw" style="background:${COL[it.type]}"></span><span class="n">${esc(it.name)}${it.aufmassId ? ' ✓' : ''}</span><span class="v">${fmtVal(v)}</span></div>`; }).join('') || '<p class="muted">Noch keine Messungen.</p>';
    const r = await modal({ title: 'Messungen', html: `<div class="mlist">${rows}</div>`, buttons: [{ label: 'Schließen', value: null }, { label: 'Alle → Aufmaß', value: 'all', cls: 'primary' }] });
    if (r === 'all') { for (const it of m.items) await toAm(it, true); toast('Alle Messungen ins Aufmaß übernommen'); ui(); }
  }
  async function toAm(it, silent) {
    const v = measureValue(m, it); if (!v) { toast('Erst Maßstab oder Perspektive setzen'); return; }
    it.aufmassId = await onToAufmass(it, v); await flush(); if (!silent) toast('Ins Aufmaß übernommen'); ui();
  }
  async function menu() {
    const r = await modal({ title: 'Aufmaß-Optionen', buttons: [{ label: 'Neigung einstellen', value: 'pitch' }, { label: 'Referenzlänge ändern', value: 'reflen' }, { label: 'Entzerrte Draufsicht erzeugen', value: 'rect' }, { label: 'Ansicht einpassen', value: 'fit' }, { label: 'Kalibrierung löschen', value: 'delcal', cls: 'danger' }, { label: 'Schließen', value: null }],
      html: '<p class="small">Hinweis: Foto-Aufmaß ist eine Schätzung. Genauigkeit hängt von Referenz, Perspektive und Bildqualität ab – vor Bestellung/Angebot vor Ort prüfen.</p>' });
    if (r === 'pitch') editPitch();
    if (r === 'fit') { fit(); draw(); }
    if (r === 'reflen') { if (m.mode === 'scale' && m.scale) askScale(m.scale.len); else if (m.mode === 'persp' && m.persp) askPersp(m.persp); else toast('Noch keine Referenz gesetzt'); }
    if (r === 'delcal' && await confirmDlg('Kalibrierung löschen?', 'Maßstab und Perspektive werden entfernt. Messungen bleiben erhalten.')) { m.mode = 'none'; m.scale = null; m.persp = null; changed(); ui(); }
    if (r === 'rect') { if (!(m.mode === 'persp' && m.persp)) return toast('Dafür zuerst Perspektive (4 Punkte) kalibrieren'); await flush(); onRectify(JSON.parse(JSON.stringify(m))); }
  }
  root.querySelector('.me').addEventListener('click', async e => {
    const t = e.target.closest('[data-t]'); if (t) return setTool(t.dataset.t);
    const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
    const it = m.items.find(i => i.id === selected);
    if (a === 'back') { ro.disconnect(); await flush(); onBack(); }
    if (a === 'undo') { draft.pts.pop(); ui(); }
    if (a === 'cancel') { draft.pts = []; ui(); }
    if (a === 'finish') finishDraft();
    if (a === 'pitch') editPitch();
    if (a === 'list') showList();
    if (a === 'menu') menu();
    if (a === 'rename' && it) { const r = await modal({ title: 'Bezeichnung', fields: [{ name: 'n', label: 'Name', value: it.name }] }); if (r) { it.name = r.n.trim() || it.name; changed(); ui(); } }
    if (a === 'togglePitch' && it) { if (!m.pitch) { await editPitch(); if (!m.pitch) return; it.usePitch = true; } else it.usePitch = !it.usePitch; changed(); ui(); }
    if (a === 'toAm' && it) toAm(it);
    if (a === 'delItem' && it && await confirmDlg('Messung löschen?', it.name)) { m.items = m.items.filter(i => i !== it); selected = null; changed(); ui(); }
  });
  setTool(tool); requestAnimationFrame(resize);
  return { destroy() { ro.disconnect(); flush(); }, get measure() { return m; }, view };
}
