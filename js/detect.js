// Lokale Kantenfindung (Grauwert, Sobel, Non-Maximum, Hough). Liefert nur Linien und Ecken, nie Meter.

function angleDiff(a, b) {
  let d = Math.abs(a - b) % Math.PI;
  if (d > Math.PI / 2) d = Math.PI - d;
  return d;
}
function intersect(a, b) {
  const c1 = Math.cos(a.th), s1 = Math.sin(a.th), c2 = Math.cos(b.th), s2 = Math.sin(b.th);
  const det = c1 * s2 - s1 * c2;
  if (Math.abs(det) < 1e-6) return null;
  return { x: (a.r * s2 - b.r * s1) / det, y: (c1 * b.r - c2 * a.r) / det };
}
function pointLineDist(p, l) {
  return Math.abs(p.x * Math.cos(l.th) + p.y * Math.sin(l.th) - l.r);
}
function nearStrong(strong, width, height, p, rad) {
  const x0 = Math.max(0, Math.round(p.x) - rad), x1 = Math.min(width - 1, Math.round(p.x) + rad);
  const y0 = Math.max(0, Math.round(p.y) - rad), y1 = Math.min(height - 1, Math.round(p.y) + rad);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (strong[y * width + x] === 2) return true;
  return false;
}

/**
 * @param {Uint8ClampedArray|Uint8Array} src RGBA oder Grau
 * @param {number} width
 * @param {number} height
 * @param {{channels?: number}} [opt]
 * @returns {{vertices: {x:number,y:number}[], edges: number[][]}}
 */
export function detectOutline(src, width, height, opt = {}) {
  const ch = opt.channels || 4;
  const n = width * height;
  if (!width || !height || src.length < n * (ch === 1 ? 1 : 4)) return { vertices: [], edges: [] };
  const gray = new Float32Array(n);
  if (ch === 1) { for (let i = 0; i < n; i++) gray[i] = src[i]; }
  else { for (let i = 0, p = 0; i < n; i++, p += 4) gray[i] = 0.299 * src[p] + 0.587 * src[p + 1] + 0.114 * src[p + 2]; }

  const blur = new Float32Array(n);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += gray[(y + dy) * width + (x + dx)];
      blur[y * width + x] = s / 9;
    }
  }
  const mag = new Float32Array(n);
  const ang = new Uint8Array(n);
  let maxMag = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const gx = -blur[i - width - 1] + blur[i - width + 1] - 2 * blur[i - 1] + 2 * blur[i + 1] - blur[i + width - 1] + blur[i + width + 1];
      const gy = -blur[i - width - 1] - 2 * blur[i - width] - blur[i - width + 1] + blur[i + width - 1] + 2 * blur[i + width] + blur[i + width + 1];
      const m = Math.hypot(gx, gy);
      mag[i] = m;
      if (m > maxMag) maxMag = m;
      let deg = (Math.atan2(gy, gx) * 180 / Math.PI + 180) % 180;
      ang[i] = deg < 22.5 || deg >= 157.5 ? 0 : deg < 67.5 ? 1 : deg < 112.5 ? 2 : 3;
    }
  }
  if (!(maxMag > 8)) return { vertices: [], edges: [] };
  const nms = new Float32Array(n);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      let n1, n2;
      const a = ang[i];
      if (a === 0) { n1 = mag[i - 1]; n2 = mag[i + 1]; }
      else if (a === 1) { n1 = mag[i - width + 1]; n2 = mag[i + width - 1]; }
      else if (a === 2) { n1 = mag[i - width]; n2 = mag[i + width]; }
      else { n1 = mag[i - width - 1]; n2 = mag[i + width + 1]; }
      if (mag[i] >= n1 && mag[i] >= n2) nms[i] = mag[i];
    }
  }
  const hi = Math.max(30, maxMag * 0.22);
  const lo = hi * 0.35;
  const strong = new Uint8Array(n);
  const stack = [];
  for (let i = 0; i < n; i++) {
    if (nms[i] >= hi) { strong[i] = 2; stack.push(i); }
    else if (nms[i] >= lo) strong[i] = 1;
  }
  while (stack.length) {
    const i = stack.pop();
    const x = i % width, y = (i / width) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const j = ny * width + nx;
      if (strong[j] === 1) { strong[j] = 2; stack.push(j); }
    }
  }

  const diag = Math.hypot(width, height);
  const tStep = 3;
  const rStep = 2;
  const tBins = Math.round(180 / tStep);
  const rBins = Math.ceil((diag * 2) / rStep) + 2;
  const acc = new Uint16Array(tBins * rBins);
  const r0 = diag;
  let edgeCount = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (strong[y * width + x] !== 2) continue;
      edgeCount++;
      for (let t = 0; t < tBins; t++) {
        const th = (t * tStep * Math.PI) / 180;
        const r = x * Math.cos(th) + y * Math.sin(th);
        const ri = Math.round((r + r0) / rStep);
        if (ri >= 0 && ri < rBins) acc[t * rBins + ri]++;
      }
    }
  }
  if (edgeCount < 20) return { vertices: [], edges: [] };
  const minVotes = Math.max(18, Math.round(Math.min(width, height) * 0.12));
  const peaks = [];
  for (let t = 0; t < tBins; t++) {
    for (let ri = 0; ri < rBins; ri++) {
      const v = acc[t * rBins + ri];
      if (v < minVotes) continue;
      let isMax = true;
      for (let dt = -1; dt <= 1 && isMax; dt++) for (let dr = -2; dr <= 2; dr++) {
        if (!dt && !dr) continue;
        const tt = t + dt, rr = ri + dr;
        if (tt < 0 || tt >= tBins || rr < 0 || rr >= rBins) continue;
        if (acc[tt * rBins + rr] > v) isMax = false;
      }
      if (isMax) peaks.push({ v, th: (t * tStep * Math.PI) / 180, r: ri * rStep - r0 });
    }
  }
  peaks.sort((a, b) => b.v - a.v);
  const lines = [];
  for (const p of peaks) {
    if (lines.length >= 10) break;
    if (lines.some((l) => Math.abs(l.r - p.r) < 10 && angleDiff(l.th, p.th) < (10 * Math.PI / 180))) continue;
    lines.push(p);
  }
  const raw = [];
  for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++) {
    if (angleDiff(lines[i].th, lines[j].th) < (18 * Math.PI / 180)) continue;
    const pt = intersect(lines[i], lines[j]);
    if (!pt || pt.x < -4 || pt.y < -4 || pt.x > width + 4 || pt.y > height + 4) continue;
    if (!nearStrong(strong, width, height, pt, 5)) continue;
    raw.push(pt);
  }
  const cluster = Math.max(10, Math.round(Math.min(width, height) * 0.04));
  const verts = [];
  for (const c of raw) {
    const hit = verts.find((v) => Math.hypot(v.x - c.x, v.y - c.y) < cluster);
    if (hit) { hit.x = (hit.x * hit.n + c.x) / (hit.n + 1); hit.y = (hit.y * hit.n + c.y) / (hit.n + 1); hit.n++; }
    else verts.push({ x: c.x, y: c.y, n: 1 });
  }
  const kept = verts.filter((v) => v.n >= 1).slice(0, 24);
  const edges = [];
  const seen = new Set();
  for (let i = 0; i < kept.length; i++) for (let j = i + 1; j < kept.length; j++) {
    const len = Math.hypot(kept[i].x - kept[j].x, kept[i].y - kept[j].y);
    if (len < Math.min(width, height) * 0.08) continue;
    const on = lines.find((l) => pointLineDist(kept[i], l) < 8 && pointLineDist(kept[j], l) < 8);
    if (!on) continue;
    const key = i + '-' + j;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push([i, j]);
  }
  return { vertices: kept.map((v) => ({ x: v.x, y: v.y })), edges };
}

/** Zeichnet das Bild verkleinert und rechnet die Ecken in die Originalpixel zurück. */
export function detectFromImageData(imageData, maxSide = 420) {
  const { width, height, data } = imageData;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  if (scale > 0.99) return detectOutline(data, width, height);
  const w = Math.max(2, Math.round(width * scale));
  const h = Math.max(2, Math.round(height * scale));
  const small = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(height - 1, Math.round(y / scale));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(width - 1, Math.round(x / scale));
      const s = (sy * width + sx) * 4, d = (y * w + x) * 4;
      small[d] = data[s]; small[d + 1] = data[s + 1]; small[d + 2] = data[s + 2]; small[d + 3] = 255;
    }
  }
  const found = detectOutline(small, w, h);
  return {
    vertices: found.vertices.map((v) => ({ x: v.x / scale, y: v.y / scale })),
    edges: found.edges,
  };
}
