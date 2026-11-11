// Geometrie: Längen, Flächen, Homographie (4-Punkt-Perspektiventzerrung)
export const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
export function polyLen(pts, closed = false) { let s = 0; for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]); if (closed && pts.length > 2) s += dist(pts[pts.length - 1], pts[0]); return s; }
export function polyArea(pts) { let s = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s) / 2; }
export function centroid(pts) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; const f = p[0] * q[1] - q[0] * p[1]; a += f; cx += (p[0] + q[0]) * f; cy += (p[1] + q[1]) * f; }
  if (Math.abs(a) < 1e-9) return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
  return [cx / (3 * a), cy / (3 * a)];
}
function solve(A, b) { // Gauss mit Pivotsuche
  const n = b.length; A = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-12) return null;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k = c; k <= n; k++) A[r][k] -= f * A[c][k]; }
  }
  return A.map((r, i) => r[n] / r[i]);
}
/** Homographie H mit H*src[i] ~ dst[i] (je 4 Punkte) */
export function homography(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const h = solve(A, b); return h ? [...h, 1] : null;
}
export function applyH(H, p) { const w = H[6] * p[0] + H[7] * p[1] + H[8]; return [(H[0] * p[0] + H[1] * p[1] + H[2]) / w, (H[3] * p[0] + H[4] * p[1] + H[5]) / w]; }
export const hW = (H, p) => H[6] * p[0] + H[7] * p[1] + H[8];
export function invert3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C; if (Math.abs(det) < 1e-15) return null;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}
/** 4 Punkte sortieren: oben-links, oben-rechts, unten-rechts, unten-links */
export function orderQuad(pts) {
  const c = [pts.reduce((s, p) => s + p[0], 0) / 4, pts.reduce((s, p) => s + p[1], 0) / 4];
  const s = [...pts].sort((p, q) => Math.atan2(p[1] - c[1], p[0] - c[0]) - Math.atan2(q[1] - c[1], q[0] - c[0]));
  let k = 0; s.forEach((p, i) => { if (p[0] + p[1] < s[k][0] + s[k][1]) k = i; });
  return [...s.slice(k), ...s.slice(0, k)]; // im Bild (y nach unten) = im Uhrzeigersinn: TL, TR, BR, BL
}
export function emptyMeasure() { return { mode: 'none', scale: null, persp: null, pitch: 0, items: [] }; }
/** Funktion Bildpunkt -> reale Koordinate in m (oder null, wenn nicht kalibriert) */
export function realMapper(m) {
  if (!m) return null;
  if (m.mode === 'persp' && m.persp && m.persp.pts?.length === 4 && m.persp.w > 0 && m.persp.h > 0) {
    const { w, h } = m.persp; const H = homography(m.persp.pts, [[0, 0], [w, 0], [w, h], [0, h]]);
    if (H) return p => applyH(H, p);
  }
  if (m.mode === 'scale' && m.scale && m.scale.len > 0) {
    const d = dist(m.scale.a, m.scale.b); if (d > 0) { const s = m.scale.len / d; return p => [p[0] * s, p[1] * s]; }
  }
  return null;
}
export function pitchFactor(m, item) { const a = +m.pitch || 0; return item.usePitch && a > 0 && a < 89 ? 1 / Math.cos(a * Math.PI / 180) : 1; }
/** Messwert eines Elements */
export function measureValue(m, item, mapper = realMapper(m)) {
  if (!mapper) return null;
  const pts = item.pts.map(mapper);
  if (item.type === 'line') return item.pts.length >= 2 ? { value: polyLen(pts) * pitchFactor(m, item), unit: 'm' } : null;
  if (item.type === 'area') return item.pts.length >= 3 ? { value: polyArea(pts) * pitchFactor(m, item), unit: 'm²', perim: polyLen(pts, true) } : null;
  return null;
}
