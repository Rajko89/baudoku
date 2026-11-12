// Freihand und Gerade auf dem Foto. Striche liegen als Vektoren auf dem Foto, das Bild selbst bleibt unverändert.
import * as db from './db.js';

const INK = '#e8590c';

export function drawStrokes(ctx, strokes, w, h) {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const s of strokes || []) {
    const pts = s.points || [];
    if (!pts.length) continue;
    const lw = Math.max(4, (s.width || 0.012) * Math.max(w, h));
    ctx.beginPath();
    pts.forEach((p, i) => { const x = p[0] * w, y = p[1] * h; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    if (pts.length === 1) ctx.lineTo(pts[0][0] * w + 1, pts[0][1] * h + 1);
    ctx.strokeStyle = 'rgba(0,0,0,.55)';
    ctx.lineWidth = lw + 3;
    ctx.stroke();
    ctx.strokeStyle = s.color || INK;
    ctx.lineWidth = lw;
    ctx.stroke();
  }
}

/** Zeichenfläche über dem Foto oder auf Weiß. Das Foto-Blob wird nicht verändert. */
export function renderMarkup(img, markup, { hidePhoto = false, max = 1600 } = {}) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const k = Math.min(1, max / Math.max(iw, ih));
  const c = document.createElement('canvas');
  c.width = Math.max(2, Math.round(iw * k));
  c.height = Math.max(2, Math.round(ih * k));
  const ctx = c.getContext('2d');
  if (hidePhoto) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); }
  else ctx.drawImage(img, 0, 0, c.width, c.height);
  drawStrokes(ctx, markup?.strokes, c.width, c.height);
  return c;
}

export function blankCanvas(w = 1000, h = 1400) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
  return c;
}

export function mountDraw(root, { photo, sheet, img, onBack }) {
  const blank = !photo;
  img = img || blankCanvas(sheet?.width || 1000, sheet?.height || 1400);
  const strokes = ((blank ? sheet.strokes : photo.markup?.strokes) || []).map((s) => ({ ...s, points: (s.points || []).map((p) => [...p]) }));
  let hidePhoto = blank || !!photo.markup?.hidePhoto;
  let tool = 'pen';
  let active = null;
  let view = { s: 1, ox: 0, oy: 0 };
  const el = document.createElement('div');
  el.className = 'draw';
  el.innerHTML = `<header class="hdr"><button type="button" class="ib" id="drawBack" aria-label="Zurück">←</button><h1 id="drawTitle">${blank ? (sheet.title || 'Freie Skizze') : 'Zeichnen'}</h1>${blank ? '<button type="button" class="ib" id="drawRename" aria-label="Titel">Aa</button>' : ''}</header>
    <canvas id="drawCanvas"></canvas>
    <div class="draw-tools">
      <button type="button" id="draw-pen" class="on"><span>✎</span>Stift</button>
      <button type="button" id="draw-line"><span>／</span>Linie</button>
      <button type="button" id="draw-undo"><span>↩</span>Rückgängig</button>
      ${blank ? '' : '<button type="button" id="draw-photo"><span>▣</span><b>Foto aus</b></button>'}
    </div>`;
  root.appendChild(el);
  const canvas = el.querySelector('#drawCanvas');
  const ctx = canvas.getContext('2d');
  const undoBtn = el.querySelector('#draw-undo');
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
  function paint() {
    layout();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!hidePhoto) ctx.drawImage(img, view.ox, view.oy, view.iw * view.s, view.ih * view.s);
    const shown = active ? strokes.concat([active]) : strokes;
    drawStrokes(ctx, shown.map((s) => ({ ...s, points: s.points.map((p) => [view.ox / canvas.width + p[0] * view.iw * view.s / canvas.width, view.oy / canvas.height + p[1] * view.ih * view.s / canvas.height]) })), canvas.width, canvas.height);
    undoBtn.disabled = !strokes.length;
    if (photoBtn) {
      photoBtn.classList.toggle('on', hidePhoto);
      photoBtn.querySelector('b').textContent = hidePhoto ? 'Foto an' : 'Foto aus';
    }
    el.querySelector('#draw-pen').classList.toggle('on', tool === 'pen');
    el.querySelector('#draw-line').classList.toggle('on', tool === 'line');
  }
  function norm(ev) {
    const r = canvas.getBoundingClientRect();
    const cx = (ev.clientX - r.left) * (canvas.width / r.width);
    const cy = (ev.clientY - r.top) * (canvas.height / r.height);
    let x = (cx - view.ox) / (view.iw * view.s);
    let y = (cy - view.oy) / (view.ih * view.s);
    x = Math.max(0, Math.min(1, x));
    y = Math.max(0, Math.min(1, y));
    return [x, y];
  }
  const pack = () => strokes.map((s) => ({ tool: s.tool, color: s.color, width: s.width, points: s.points.map((p) => [p[0], p[1]]) }));
  async function persist() {
    if (blank) { sheet.strokes = pack(); sheet.updated = Date.now(); await db.put('sheets', sheet); }
    else { photo.markup = { strokes: pack(), hidePhoto }; await db.put('photos', photo); }
  }
  function pushActive() {
    if (!active || active.points.length < 2 && active.tool === 'line') { active = null; return; }
    if (active.tool === 'pen' && active.points.length < 2) { active = null; return; }
    strokes.push(active);
    active = null;
    return persist();
  }

  canvas.addEventListener('pointerdown', (ev) => {
    if (ev.button != null && ev.button !== 0) return;
    ev.preventDefault();
    try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* synthetische Touches */ }
    const p = norm(ev);
    active = { tool, color: INK, width: 0.012, points: [p] };
    paint();
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (!active) return;
    const p = norm(ev);
    const last = active.points[active.points.length - 1];
    if (active.tool === 'line') active.points = [active.points[0], p];
    else if (Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.004) active.points.push(p);
    paint();
  });
  const end = async () => { if (!active) return; await pushActive(); paint(); };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  el.querySelector('#draw-pen').onclick = () => { tool = 'pen'; paint(); };
  el.querySelector('#draw-line').onclick = () => { tool = 'line'; paint(); };
  undoBtn.onclick = async () => { if (!strokes.length) return; strokes.pop(); await persist(); paint(); };
  if (photoBtn) photoBtn.onclick = async () => { hidePhoto = !hidePhoto; await persist(); paint(); };
  const rename = el.querySelector('#drawRename');
  if (rename) rename.onclick = async () => {
    const { modal } = await import('./util.js');
    const r = await modal({ title: 'Titel', fields: [{ name: 'title', label: 'Titel (optional)', value: sheet.title || '' }], buttons: [{ label: 'Abbrechen', value: null }, { label: 'Speichern', value: 'ok', cls: 'primary' }] });
    if (!r) return;
    sheet.title = (r.title || '').trim() || 'Freie Skizze';
    el.querySelector('#drawTitle').textContent = sheet.title;
    await persist();
  };
  el.querySelector('#drawBack').onclick = () => onBack();
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
  paint();
  return {
    destroy() { ro.disconnect(); el.remove(); },
    count: () => strokes.length,
    strokes: () => strokes.map((s) => ({ tool: s.tool, n: s.points.length })),
    clientPoint(nx, ny) {
      const r = canvas.getBoundingClientRect();
      const cx = view.ox + nx * view.iw * view.s;
      const cy = view.oy + ny * view.ih * view.s;
      return { x: r.left + cx / canvas.width * r.width, y: r.top + cy / canvas.height * r.height };
    },
  };
}
