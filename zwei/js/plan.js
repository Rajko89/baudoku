// Flächen nur aus eingetragenen Maßen und ausdrücklich festgelegten Winkeln oder Parallelitäten.
// Zeichenkoordinaten liefern keine Längen und keine rechten Winkel.

export function emptyDoc() {
  return { next: 1, nodes: [], edges: [], strokes: [], texts: [], rights: [], parallels: [], seq: [], chains: [], shapes: [] };
}
function clone(d) { return JSON.parse(JSON.stringify(d)); }
function nid(d, p) { d.next = d.next || 1; return p + (d.next++); }
export function fmtNum(n) {
  return Number(n).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
export function toMeters(value, unit) {
  const v = +value;
  if (!isFinite(v)) return null;
  if (unit === 'cm') return v / 100;
  if (unit === 'mm') return v / 1000;
  return v;
}
export function nodeById(doc, id) { return doc.nodes.find((n) => n.id === id); }
export function edgeById(doc, id) { return doc.edges.find((e) => e.id === id); }
function nodeLabel(doc, id) {
  const i = doc.nodes.findIndex((n) => n.id === id);
  return i < 0 ? '?' : String.fromCharCode(65 + (i % 26));
}
function nextEdgeLabel(doc) {
  const used = new Set(doc.edges.map((e) => e.label).filter(Boolean));
  for (let i = 0; i < 26; i++) { const l = String.fromCharCode(97 + i); if (!used.has(l)) return l; }
  return 'k' + (doc.edges.length + 1);
}
function segIntersect(p, q, r, s) {
  const rx = q.x - p.x, ry = q.y - p.y, sx = s.x - r.x, sy = s.y - r.y;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((r.x - p.x) * sy - (r.y - p.y) * sx) / den;
  const u = ((r.x - p.x) * ry - (r.y - p.y) * rx) / den;
  if (t <= 0.02 || t >= 0.98 || u <= 0.02 || u >= 0.98) return null;
  return { x: p.x + t * rx, y: p.y + t * ry };
}

export function snapTarget(doc, x, y, radius, ignoreNodeId) {
  let best = null;
  const consider = (cand, d) => { if (d <= radius && (!best || d < best.d)) best = { ...cand, d }; };
  for (const n of doc.nodes) {
    if (n.id === ignoreNodeId) continue;
    consider({ x: n.x, y: n.y, kind: 'node', nodeId: n.id }, Math.hypot(n.x - x, n.y - y));
  }
  const edges = doc.edges.map((e) => ({ e, a: nodeById(doc, e.a), b: nodeById(doc, e.b) })).filter((x0) => x0.a && x0.b);
  for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) {
    const hit = segIntersect(edges[i].a, edges[i].b, edges[j].a, edges[j].b);
    if (!hit) continue;
    consider({ x: hit.x, y: hit.y, kind: 'cross', edgeIds: [edges[i].e.id, edges[j].e.id] }, Math.hypot(hit.x - x, hit.y - y));
  }
  return best;
}

function splitEdge(doc, edgeId, x, y) {
  const e = edgeById(doc, edgeId);
  if (!e) return null;
  const n = { id: nid(doc, 'n'), x, y };
  doc.nodes.push(n);
  const keptName = String(e.name || '').trim();
  const e1 = { id: nid(doc, 'e'), a: e.a, b: n.id, label: e.label, measure: null, chain: e.chain || null, free: !!e.free, ...(keptName ? { name: keptName } : {}) };
  const e2 = { id: nid(doc, 'e'), a: n.id, b: e.b, label: nextEdgeLabel(doc), measure: null, chain: e.chain || null, free: !!e.free, ...(keptName ? { name: keptName } : {}) };
  if (e.measure) {
    const chain = e.chain || nid(doc, 'c');
    e1.chain = chain; e2.chain = chain;
    doc.chains = doc.chains || [];
    if (!doc.chains.some((c) => c.id === chain)) doc.chains.push({ id: chain, value: e.measure.value, unit: e.measure.unit || 'm' });
  }
  doc.rights = (doc.rights || []).filter((r) => r.e1 !== edgeId && r.e2 !== edgeId);
  doc.edges = doc.edges.filter((x0) => x0.id !== edgeId).concat([e1, e2]);
  return n.id;
}
function place(doc, spec) {
  if (spec.nodeId && nodeById(doc, spec.nodeId)) return spec.nodeId;
  if (spec.kind === 'cross' && spec.edgeIds) {
    let id = null;
    for (const eid of [...spec.edgeIds]) {
      if (!edgeById(doc, eid)) continue;
      id = splitEdge(doc, eid, spec.x, spec.y);
    }
    if (id) return id;
  }
  const near = doc.nodes.find((n) => Math.hypot(n.x - spec.x, n.y - spec.y) < 1e-4);
  if (near) return near.id;
  const n = { id: nid(doc, 'n'), x: spec.x, y: spec.y };
  doc.nodes.push(n);
  return n.id;
}
function addRight(d, node, e1, e2) {
  if (!node || !e1 || !e2 || e1 === e2) return;
  if (!nodeById(d, node) || !edgeById(d, e1) || !edgeById(d, e2)) return;
  const key = [e1, e2].sort().join('|');
  d.rights = d.rights || [];
  if (d.rights.some((r) => r.node === node && [r.e1, r.e2].sort().join('|') === key)) return;
  d.rights.push({ id: nid(d, 'r'), node, e1, e2, fromSnap: true });
}
function lineDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
}
function absorbCollinear(doc, aId, bId) {
  const pa = nodeById(doc, aId), pb = nodeById(doc, bId);
  if (!pa || !pb) return false;
  for (const e of doc.edges) {
    const ea = nodeById(doc, e.a), eb = nodeById(doc, e.b);
    if (!ea || !eb || Math.hypot(eb.x - ea.x, eb.y - ea.y) < 0.01) continue;
    if (lineDist(pa, ea, eb) > 0.02 || lineDist(pb, ea, eb) > 0.02) continue;
    const dx = eb.x - ea.x, dy = eb.y - ea.y, l2 = dx * dx + dy * dy || 1;
    const project = (p) => ((p.x - ea.x) * dx + (p.y - ea.y) * dy) / l2;
    const lo = Math.min(project(pa), project(pb)), hi = Math.max(project(pa), project(pb));
    const overlap = Math.min(hi, 1) - Math.max(lo, 0);
    const grab = aId === e.a || aId === e.b ? aId : bId === e.a || bId === e.b ? bId : null;
    const extendsEnd = !!grab && (lo < -0.02 || hi > 1.02 || overlap > 0.02);
    if (!extendsEnd && overlap < 0.05) continue;
    if (!grab) {
      for (const id of [aId, bId]) {
        if (!doc.edges.some((ed) => ed.a === id || ed.b === id)) doc.nodes = doc.nodes.filter((n) => n.id !== id);
      }
      return true;
    }
    const destId = grab === aId ? bId : aId;
    const dest = nodeById(doc, destId), g = nodeById(doc, grab);
    if (!dest || !g) continue;
    g.x = dest.x; g.y = dest.y;
    if (destId !== e.a && destId !== e.b && !doc.edges.some((ed) => ed.a === destId || ed.b === destId)) {
      doc.nodes = doc.nodes.filter((n) => n.id !== destId);
    }
    return true;
  }
  return false;
}
export function addLine(doc, start, end, opts = {}) {
  const d = clone(doc);
  const a = place(d, start);
  const b = place(d, end);
  if (a === b) return d;
  if (d.edges.some((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a))) return d;
  if (absorbCollinear(d, a, b)) return d;
  const id = nid(d, 'e');
  const edge = { id, a, b, label: nextEdgeLabel(d), measure: null, free: !!opts.free };
  if (opts.color) edge.color = opts.color;
  if (opts.dash != null) edge.dash = !!opts.dash;
  d.edges.push(edge);
  d.seq = [...(d.seq || []), { type: 'edge', id }];
  if (!opts.free) for (const r of opts.rights || []) addRight(d, r.nodeId, id, r.edgeId);
  return d;
}
export function addStroke(doc, points, style = {}) {
  const d = clone(doc);
  const id = nid(d, 's');
  d.strokes.push({ id, points: points.map((p) => [p[0], p[1]]), width: style.width || 0.012, color: style.color || '#111111' });
  d.seq = [...(d.seq || []), { type: 'stroke', id }];
  return d;
}
export function addText(doc, x, y, text) {
  const d = clone(doc);
  const id = nid(d, 't');
  d.texts.push({ id, x, y, text: String(text || '') });
  d.seq = [...(d.seq || []), { type: 'text', id }];
  return d;
}
export function editText(doc, id, text) {
  const d = clone(doc);
  const t = d.texts.find((x) => x.id === id);
  if (t) t.text = String(text || '');
  return d;
}
export function moveText(doc, id, x, y) {
  const d = clone(doc);
  const t = d.texts.find((t0) => t0.id === id);
  if (t) { t.x = x; t.y = y; }
  return d;
}
export function setTextAngle(doc, id, ang) {
  const d = clone(doc);
  const t = d.texts.find((t0) => t0.id === id);
  if (t && isFinite(+ang)) t.ang = +ang;
  return d;
}
export function arrowLabelPlace(x1, y1, x2, y2, side = 1, font = 16, extra = 4) {
  const dx = x2 - x1, dy = y2 - y1;
  const show = uprightAngle(Math.atan2(dy, dx));
  const s = side === -1 ? -1 : 1;
  const ox = Math.sin(show) * s;
  const oy = -Math.cos(show) * s;
  const gap = Math.max(1, (+font || 16) / 2 + (+extra || 0));
  return { x: (x1 + x2) / 2 + ox * gap, y: (y1 + y2) / 2 + oy * gap, ang: show, ox, oy, gap };
}
export function uprightAngle(ang) {
  let a = +ang || 0;
  if (!isFinite(a)) return 0;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a <= -Math.PI) a += Math.PI * 2;
  if (a > Math.PI / 2 || a <= -Math.PI / 2) a += Math.PI;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a <= -Math.PI) a += Math.PI * 2;
  return a;
}
export function snapAngle(ang, guides = [], tol = 10 * Math.PI / 180) {
  let a = +ang || 0;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a <= -Math.PI) a += Math.PI * 2;
  const opts = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
  for (const g of guides || []) {
    let b = +g || 0;
    while (b > Math.PI) b -= Math.PI * 2;
    while (b <= -Math.PI) b += Math.PI * 2;
    opts.push(b, b + Math.PI, b - Math.PI);
  }
  let best = a, bd = tol;
  for (const target of opts) {
    let d = a - target;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    if (Math.abs(d) <= bd) { bd = Math.abs(d); best = target; }
  }
  while (best > Math.PI) best -= Math.PI * 2;
  while (best <= -Math.PI) best += Math.PI * 2;
  return best;
}
export function deleteText(doc, id) {
  const d = clone(doc);
  d.texts = d.texts.filter((t) => t.id !== id);
  d.seq = (d.seq || []).filter((s) => !(s.type === 'text' && s.id === id));
  return d;
}
function round2(n) { return Math.round((+n) * 100) / 100; }
export function setMeasure(doc, edgeId, value, unit) {
  const d = clone(doc);
  const e = edgeById(d, edgeId);
  if (!e) return d;
  if (value == null || value === '' || !isFinite(+value)) { e.measure = null; return d; }
  const u = unit || e.measure?.unit || e.total?.unit || 'm';
  e.measure = { value: round2(value), unit: u, source: 'user' };
  if (e.group && e.total && isFinite(+e.total.value)) {
    const others = d.edges.filter((x) => x.group === e.group && x.id !== e.id);
    let rest = +e.total.value - e.measure.value;
    if (rest < 0.01) rest = 0.01;
    const sumO = others.reduce((s, o) => s + (isFinite(+o.measure?.value) ? +o.measure.value : 0), 0);
    others.forEach((o) => {
      const share = sumO > 0 && isFinite(+o.measure?.value) ? +o.measure.value / sumO : 1 / (others.length || 1);
      o.measure = { value: round2(rest * share), unit: e.total.unit || u, source: 'user' };
    });
    const got = others.reduce((s, o) => s + (+o.measure.value || 0), 0) + e.measure.value;
    const drift = round2(+e.total.value - got);
    if (others[0] && Math.abs(drift) >= 0.01) others[0].measure.value = round2(others[0].measure.value + drift);
  }
  return d;
}
export function setEdgeStyle(doc, edgeId, patch = {}) {
  const d = clone(doc);
  const e = edgeById(d, edgeId);
  if (!e) return d;
  if (patch.color) e.color = patch.color;
  if (patch.dash != null) e.dash = !!patch.dash;
  return d;
}
export function cleanPartName(name) {
  return String(name || '').replace(/\s+/g, ' ').trim();
}
export function setEdgeName(doc, edgeId, name) {
  const d = clone(doc);
  const e = edgeById(d, edgeId);
  if (!e) return d;
  const t = cleanPartName(name);
  if (!t) delete e.name;
  else e.name = t;
  return d;
}
export function edgeTitle(edge) {
  const letter = edge?.label || '';
  const name = cleanPartName(edge?.name);
  if (!name) return letter;
  const has = edge.measure && edge.measure.source !== 'derived' && isFinite(+edge.measure.value);
  return has ? '' : `${name} (${letter})`;
}
export function namedMeasure(edge) {
  const name = cleanPartName(edge?.name);
  if (!name || !edge?.measure || edge.measure.source === 'derived' || !isFinite(+edge.measure.value)) return '';
  return `${name} ${fmtNum(edge.measure.value)} ${edge.measure.unit || 'm'}`;
}
function orderChain(doc, edges) {
  const deg = new Map();
  for (const e of edges) {
    deg.set(e.a, (deg.get(e.a) || 0) + 1);
    deg.set(e.b, (deg.get(e.b) || 0) + 1);
  }
  const ends = [...deg.entries()].filter(([, c]) => c === 1);
  if (ends.length !== 2) return null;
  const ordered = [];
  const used = new Set();
  let node = ends[0][0];
  while (ordered.length < edges.length) {
    const e = edges.find((ed) => !used.has(ed.id) && (ed.a === node || ed.b === node));
    if (!e) return null;
    const to = e.a === node ? e.b : e.a;
    ordered.push({ e, from: node, to });
    used.add(e.id);
    node = to;
  }
  return ordered;
}
function renumberGroup(doc, group, base) {
  const edges = doc.edges.filter((e) => e.group === group);
  const ordered = orderChain(doc, edges);
  if (!ordered) return;
  ordered.forEach((o, i) => { o.e.base = base; o.e.label = base + (ordered.length > 1 ? String(i + 1) : ''); });
}
export function splitEdgeAt(doc, edgeId, t = 0.5) {
  const d = clone(doc);
  const e = edgeById(d, edgeId);
  if (!e) return d;
  const a = nodeById(d, e.a), b = nodeById(d, e.b);
  if (!a || !b) return d;
  const tt = Math.min(0.85, Math.max(0.15, +t || 0.5));
  const n = { id: nid(d, 'n'), x: a.x + (b.x - a.x) * tt, y: a.y + (b.y - a.y) * tt };
  d.nodes.push(n);
  const base = e.base || String(e.label || 'a').replace(/\d+$/, '') || 'a';
  const group = e.group || nid(d, 'g');
  const total = e.total || (e.measure && isFinite(+e.measure.value) ? { value: +e.measure.value, unit: e.measure.unit || 'm' } : null);
  const parent = e.measure && isFinite(+e.measure.value) ? +e.measure.value : (total && !e.group ? +total.value : null);
  const m1 = parent == null ? null : { value: round2(parent * tt), unit: (e.measure || total).unit || 'm', source: 'user' };
  const m2 = parent == null ? null : { value: round2(parent - m1.value), unit: (e.measure || total).unit || 'm', source: 'user' };
  const shared = { free: !!e.free, color: e.color, dash: e.dash, group, base, total: total || (m1 ? { value: round2(m1.value + m2.value), unit: m1.unit } : null) };
  if (cleanPartName(e.name)) shared.name = cleanPartName(e.name);
  const e2id = nid(d, 'e');
  const e1 = { id: e.id, a: e.a, b: n.id, label: base + '1', measure: m1, ...shared };
  const e2 = { id: e2id, a: n.id, b: e.b, label: base + '2', measure: m2, ...shared };
  d.edges = d.edges.filter((x) => x.id !== e.id).concat([e1, e2]);
  d.rights = (d.rights || []).map((r) => {
    if (r.e1 !== e.id && r.e2 !== e.id) return r;
    if (r.node !== e.b) return r;
    return { ...r, e1: r.e1 === e.id ? e2id : r.e1, e2: r.e2 === e.id ? e2id : r.e2 };
  });
  d.seq = [...(d.seq || []).filter((s) => !(s.type === 'edge' && s.id === e.id)), { type: 'edge', id: e.id }, { type: 'edge', id: e2id }];
  renumberGroup(d, group, base);
  return d;
}
export function isSplitNode(doc, nodeId) {
  const es = (doc.edges || []).filter((e) => e.a === nodeId || e.b === nodeId);
  return es.length === 2 && !!es[0].group && es[0].group === es[1].group;
}
export function moveSplitPoint(doc, nodeId, x, y) {
  if (!isSplitNode(doc, nodeId)) return moveNode(doc, nodeId, x, y);
  const d = clone(doc);
  const es = d.edges.filter((e) => e.a === nodeId || e.b === nodeId);
  const nL = nodeById(d, es[0].a === nodeId ? es[0].b : es[0].a);
  const nR = nodeById(d, es[1].a === nodeId ? es[1].b : es[1].a);
  const node = nodeById(d, nodeId);
  if (!nL || !nR || !node) return d;
  const dx = nR.x - nL.x, dy = nR.y - nL.y, l2 = dx * dx + dy * dy || 1;
  let t = ((x - nL.x) * dx + (y - nL.y) * dy) / l2;
  t = Math.min(0.92, Math.max(0.08, t));
  node.x = nL.x + dx * t;
  node.y = nL.y + dy * t;
  if (es[0].measure && es[1].measure && isFinite(+es[0].measure.value) && isFinite(+es[1].measure.value)) {
    const pair = +es[0].measure.value + +es[1].measure.value;
    const unit = es[0].measure.unit || 'm';
    const left = es[0].a === nodeId || es[0].b === nodeId ? es[0] : es[1];
    const fromLeft = left.a === nL.id || left.b === nL.id ? left : es[1];
    const other = fromLeft === es[0] ? es[1] : es[0];
    fromLeft.measure = { value: round2(pair * t), unit, source: 'user' };
    other.measure = { value: round2(pair - fromLeft.measure.value), unit, source: 'user' };
  }
  return d;
}
export function collapseForCalc(doc) {
  const groups = new Map();
  for (const e of doc.edges || []) {
    if (!e.group) continue;
    if (!groups.has(e.group)) groups.set(e.group, []);
    groups.get(e.group).push(e);
  }
  const multi = [...groups.values()].filter((g) => g.length > 1);
  if (!multi.length) return doc;
  const d = clone(doc);
  for (const list of multi) {
    const ordered = orderChain(d, list.map((e) => edgeById(d, e.id)).filter(Boolean));
    if (!ordered) continue;
    const keep = ordered[0].e;
    const drop = new Set(ordered.slice(1).map((o) => o.e.id));
    const parts = ordered.map((o) => o.e);
    const allM = parts.every((e) => e.measure && isFinite(+e.measure.value));
    keep.a = ordered[0].from;
    keep.b = ordered[ordered.length - 1].to;
    keep.label = keep.base || String(keep.label || '').replace(/\d+$/, '') || keep.label;
    if (allM) {
      const unit = parts[0].measure.unit || 'm';
      const same = parts.every((e) => (e.measure.unit || 'm') === unit);
      const sum = same
        ? parts.reduce((s, e) => s + (+e.measure.value), 0)
        : parts.reduce((s, e) => s + (toMeters(e.measure.value, e.measure.unit || 'm') || 0), 0);
      keep.measure = { value: round2(sum), unit: same ? unit : 'm', source: 'user' };
    } else keep.measure = null;
    d.edges = d.edges.filter((e) => !drop.has(e.id));
    const mapId = (id) => (drop.has(id) ? keep.id : id);
    d.rights = (d.rights || []).map((r) => ({ ...r, e1: mapId(r.e1), e2: mapId(r.e2) })).filter((r) => r.e1 !== r.e2);
    d.parallels = (d.parallels || []).map((p) => ({ ...p, e1: mapId(p.e1), e2: mapId(p.e2) })).filter((p) => p.e1 !== p.e2);
    const liveN = new Set();
    d.edges.forEach((e) => { liveN.add(e.a); liveN.add(e.b); });
    d.nodes = d.nodes.filter((n) => liveN.has(n.id));
  }
  return d;
}
// Seitenlänge eines Symbols: 20 % der bisherigen Automatik (früher 11 % der kürzeren Blattseite).
export function symbolBox(iw, ih) {
  const w = Math.max(1, +iw || 1);
  const h = Math.max(1, +ih || 1);
  const side = Math.min(w, h) * 0.022;
  return { d: side / w, w: side / w, h: side / h };
}
// Standardlänge eines Hinweispfeils, als Anteil der kürzeren Blattseite.
export function arrowSpan(iw, ih) {
  const w = Math.max(1, +iw || 1);
  const h = Math.max(1, +ih || 1);
  const side = Math.min(w, h) * 0.12;
  return { dx: side / w, dy: 0 };
}
function near(a, b) { return Math.abs((+a || 0) - (+b || 0)) < 1e-6; }
// v1.7.1-Symbole auf die neue Standardgröße setzen. Der Mittelpunkt bleibt, freie Formen auch.
export function fitSymbols(doc, iw, ih) {
  const shapes = doc?.shapes || [];
  if (!shapes.some((s) => s && s.symbol)) return doc;
  const box = symbolBox(iw, ih);
  let changed = false;
  const next = shapes.map((s) => {
    if (!s?.symbol || s.kind === 'arrow') return s;
    if (s.kind === 'circle') {
      if (near(s.d, box.d) && near(s.w, box.w) && near(s.h, box.h)) return s;
      changed = true;
      return { ...s, d: box.d, w: box.w, h: box.h };
    }
    const cx = (+s.x || 0) + (+s.w || 0) / 2;
    const cy = (+s.y || 0) + (+s.h || 0) / 2;
    const x = cx - box.w / 2;
    const y = cy - box.h / 2;
    if (near(s.w, box.w) && near(s.h, box.h) && near(s.d, box.d) && near(s.x, x) && near(s.y, y)) return s;
    changed = true;
    return { ...s, x, y, w: box.w, h: box.h, d: box.d };
  });
  if (!changed) return doc;
  return { ...doc, shapes: next };
}
export function addShape(doc, shape) {
  const d = clone(doc);
  d.shapes = d.shapes || [];
  const id = nid(d, 'h');
  const kind = shape.kind === 'circle' ? 'circle' : shape.kind === 'arrow' ? 'arrow' : 'rect';
  const row = { id, kind, x: shape.x, y: shape.y, color: shape.color || '#111111', dash: !!shape.dash };
  if (kind === 'arrow') {
    row.x2 = +shape.x2;
    row.y2 = +shape.y2;
    row.text = String(shape.text || '');
  } else {
    row.w = shape.w;
    row.h = shape.h;
    row.d = shape.d;
    if (shape.symbol) row.symbol = true;
  }
  d.shapes.push(row);
  return d;
}
export function patchShape(doc, id, patch) {
  const d = clone(doc);
  const s = (d.shapes || []).find((x) => x.id === id);
  if (s) Object.assign(s, patch);
  return d;
}
export function deleteShape(doc, id) {
  const d = clone(doc);
  d.shapes = (d.shapes || []).filter((s) => s.id !== id);
  return d;
}
export function toggleRight(doc, nodeId) {
  const d = clone(doc);
  const edges = d.edges.filter((e) => e.a === nodeId || e.b === nodeId);
  if (edges.length !== 2) return { doc: d, error: 'Ein rechter Winkel braucht genau zwei Linien an diesem Punkt.' };
  const key = [edges[0].id, edges[1].id].sort().join('|');
  const i = (d.rights || []).findIndex((r) => [r.e1, r.e2].sort().join('|') === key && r.node === nodeId);
  if (i >= 0) d.rights.splice(i, 1);
  else d.rights.push({ id: nid(d, 'r'), node: nodeId, e1: edges[0].id, e2: edges[1].id });
  return { doc: d, error: null };
}
export function setParallel(doc, e1, e2) {
  const d = clone(doc);
  if (!e1 || !e2 || e1 === e2) return d;
  const key = [e1, e2].sort().join('|');
  d.parallels = d.parallels || [];
  if (!d.parallels.some((p) => [p.e1, p.e2].sort().join('|') === key)) d.parallels.push({ id: nid(d, 'p'), e1, e2 });
  return d;
}
function hasRight(doc, nodeId, e1, e2) {
  const key = [e1, e2].sort().join('|');
  return (doc.rights || []).some((r) => r.node === nodeId && [r.e1, r.e2].sort().join('|') === key);
}
function edgeMeters(e) {
  if (!e?.measure || e.measure.source === 'derived') return null;
  return toMeters(e.measure.value, e.measure.unit || 'm');
}
function edgeNotes(edges, lens) {
  return edges.map((e, i) => ({ id: e.id, text: `${fmtNum(lens[i])} m`, meters: lens[i], derived: edgeMeters(e) == null }));
}
function fail(missing, contradictions = []) {
  return { ok: false, missing, contradictions, area: null, steps: [...missing, ...contradictions], parts: [] };
}
function turn(a, b, c) {
  const ax = b.x - a.x, ay = b.y - a.y, bx = c.x - b.x, by = c.y - b.y;
  return ax * by - ay * bx;
}
function cycleEdges(doc, ids) {
  const out = [];
  for (let i = 0; i < ids.length; i++) {
    const a = ids[i], b = ids[(i + 1) % ids.length];
    const e = doc.edges.find((e0) => (e0.a === a && e0.b === b) || (e0.a === b && e0.b === a));
    if (!e) return null;
    out.push(e);
  }
  return out;
}
function heron(a, b, c) {
  const s = (a + b + c) / 2;
  const x = s * (s - a) * (s - b) * (s - c);
  if (x < -1e-6) return null;
  return Math.sqrt(Math.max(0, x));
}
function nearly(a, b) { return Math.abs(a - b) <= 0.005; }

function rectangleEval(doc, ids, edges) {
  const missing = [];
  const contradictions = [];
  for (let i = 0; i < 4; i++) {
    if (!hasRight(doc, ids[i], edges[(i + 3) % 4].id, edges[i].id)) missing.push(`Winkel bei Punkt ${nodeLabel(doc, ids[i])} nicht festgelegt`);
  }
  if (missing.length) return fail(missing);
  const lens = edges.map(edgeMeters);
  const label = (i) => edges[i].label || '?';
  for (const [i, j] of [[0, 2], [1, 3]]) {
    if (lens[i] != null && lens[j] != null && !nearly(lens[i], lens[j])) {
      contradictions.push(`Gegenüberliegende Seiten ${label(i)} (${fmtNum(lens[i])} m) und ${label(j)} (${fmtNum(lens[j])} m) sind verschieden. Das passt nicht zu einem Rechteck mit rechten Winkeln.`);
    }
  }
  if (contradictions.length) return fail([], contradictions);
  if (lens[0] == null && lens[2] != null) lens[0] = lens[2];
  if (lens[2] == null && lens[0] != null) lens[2] = lens[0];
  if (lens[1] == null && lens[3] != null) lens[1] = lens[3];
  if (lens[3] == null && lens[1] != null) lens[3] = lens[1];
  for (let i = 0; i < 4; i++) if (lens[i] == null) missing.push(`Strecke ${label(i)} fehlt`);
  if (missing.length) return fail(missing);
  const area = lens[0] * lens[1];
  const steps = ['Fläche F1, Rechteck'];
  edges.forEach((e, i) => steps.push(`${e.label} = ${fmtNum(lens[i])} m${edgeMeters(e) == null ? ' (abgeleitet)' : ''}`));
  steps.push(`Formel: A = ${edges[0].label} x ${edges[1].label}`);
  steps.push(`Rechnung: ${fmtNum(lens[0])} m x ${fmtNum(lens[1])} m = ${fmtNum(area)} m²`);
  return { ok: true, missing: [], contradictions: [], area, steps, parts: [{ label: 'F1', formula: 'A = a x b', result: area }], edgeNotes: edgeNotes(edges, lens) };
}

function triangleEval(doc, ids, edges) {
  const rights = [];
  for (let i = 0; i < 3; i++) if (hasRight(doc, ids[i], edges[(i + 2) % 3].id, edges[i].id)) rights.push(i);
  const lens = edges.map(edgeMeters);
  const missing = [];
  if (rights.length > 1) return fail([], ['Ein Dreieck kann nicht mehr als einen rechten Winkel haben.']);
  if (rights.length === 1) {
    const i = rights[0];
    const legA = edges[i], legB = edges[(i + 2) % 3], hyp = edges[(i + 1) % 3];
    const a = edgeMeters(legA), b = edgeMeters(legB), c = edgeMeters(hyp);
    if (a != null && b != null) {
      if (c != null && !nearly(c * c, a * a + b * b)) return fail([], [`Die Seiten erfüllen den Satz des Pythagoras nicht (${legA.label}² + ${legB.label}² ≠ ${hyp.label}²).`]);
      const area = a * b / 2;
      const steps = ['Fläche F1, rechtwinkliges Dreieck', `${legA.label} = ${fmtNum(a)} m`, `${legB.label} = ${fmtNum(b)} m`, 'Formel: A = a x b / 2', `Rechnung: ${fmtNum(a)} m x ${fmtNum(b)} m / 2 = ${fmtNum(area)} m²`];
      return { ok: true, missing: [], contradictions: [], area, steps, parts: [{ label: 'F1', formula: 'A = a x b / 2', result: area }] };
    }
    if (c != null && (a != null || b != null)) {
      const leg = a != null ? a : b;
      const other = a != null ? legB : legA;
      if (c <= leg) return fail([], ['Die Hypotenuse ist nicht länger als die Kathete. Das passt nicht zu einem rechtwinkligen Dreieck.']);
      const dlen = Math.sqrt(c * c - leg * leg);
      const area = leg * dlen / 2;
      const steps = ['Fläche F1, rechtwinkliges Dreieck', `${a != null ? legA.label : legB.label} = ${fmtNum(leg)} m`, `${other.label} = ${fmtNum(dlen)} m (abgeleitet)`, `${hyp.label} = ${fmtNum(c)} m`, 'Formel: A = a x b / 2', `Rechnung: ${fmtNum(leg)} m x ${fmtNum(dlen)} m / 2 = ${fmtNum(area)} m²`];
      return { ok: true, missing: [], contradictions: [], area, steps, parts: [{ label: 'F1', formula: 'A = a x b / 2', result: area }] };
    }
    if (a == null) missing.push(`Strecke ${legA.label} fehlt`);
    if (b == null) missing.push(`Strecke ${legB.label} fehlt`);
    return fail(missing);
  }
  edges.forEach((e, i) => { if (lens[i] == null) missing.push(`Strecke ${e.label} fehlt`); });
  if (missing.length) return fail(missing);
  const [a, b, c] = lens;
  if (a + b <= c + 1e-6 || a + c <= b + 1e-6 || b + c <= a + 1e-6) return fail([], ['Die drei Seiten bilden kein Dreieck (Dreiecksungleichung verletzt).']);
  const area = heron(a, b, c);
  const steps = ['Fläche F1, Dreieck', ...edges.map((e, i) => `${e.label} = ${fmtNum(lens[i])} m`), 'Formel: A = Heron(a, b, c)', `Rechnung: ${fmtNum(a)} m, ${fmtNum(b)} m, ${fmtNum(c)} m -> ${fmtNum(area)} m²`];
  return { ok: true, missing: [], contradictions: [], area, steps, parts: [{ label: 'F1', formula: 'A = Heron(a, b, c)', result: area }] };
}

function orthogonalEval(doc, ids, edges) {
  const missing = [];
  const nodes = ids.map((id) => nodeById(doc, id));
  const n = ids.length;
  const axis = [];
  let dir = 0;
  for (let i = 0; i < n; i++) {
    if (!hasRight(doc, ids[i], edges[(i + n - 1) % n].id, edges[i].id)) missing.push(`Winkel bei Punkt ${nodeLabel(doc, ids[i])} nicht festgelegt`);
    axis.push(dir);
    const sg = turn(nodes[i], nodes[(i + 1) % n], nodes[(i + 2) % n]);
    if (Math.abs(sg) < 1e-9) return fail(missing.length ? missing : [`Die Linien an Punkt ${nodeLabel(doc, ids[(i + 1) % n])} knicken nicht ab.`]);
    dir = sg > 0 ? (dir + 1) % 4 : (dir + 3) % 4;
  }
  if (missing.length) return fail(missing);
  const lens = edges.map(edgeMeters);
  const unknown = lens.map((v, i) => (v == null ? i : -1)).filter((i) => i >= 0);
  const signX = (ax) => (ax === 0 ? 1 : ax === 2 ? -1 : 0);
  const signY = (ax) => (ax === 1 ? 1 : ax === 3 ? -1 : 0);
  const sum = (pred, val) => axis.reduce((s, ax, i) => s + pred(ax) * val(i), 0);
  if (unknown.length > 2) {
    unknown.forEach((i) => missing.push(`Strecke ${edges[i].label} fehlt`));
    return fail(missing);
  }
  if (unknown.length === 2) {
    const [i, j] = unknown;
    const vx = (k) => signX(axis[k]), vy = (k) => signY(axis[k]);
    const bx = -sum(signX, (k) => lens[k] || 0);
    const by = -sum(signY, (k) => lens[k] || 0);
    const det = vx(i) * vy(j) - vy(i) * vx(j);
    if (Math.abs(det) < 1e-9) return fail([`Strecke ${edges[i].label} fehlt`, `Strecke ${edges[j].label} fehlt`]);
    lens[i] = (bx * vy(j) - by * vx(j)) / det;
    lens[j] = (vx(i) * by - vy(i) * bx) / det;
  } else if (unknown.length === 1) {
    const i = unknown[0];
    const bx = -sum(signX, (k) => (k === i ? 0 : lens[k]));
    const by = -sum(signY, (k) => (k === i ? 0 : lens[k]));
    const dx = signX(axis[i]), dy = signY(axis[i]);
    if (Math.abs(dx) > 0 && Math.abs(by) > 0.02 && Math.abs(bx) < 1e-6) return fail([], ['Die Maßkette schließt sich nicht.']);
    if (Math.abs(dy) > 0 && Math.abs(bx) > 0.02 && Math.abs(by) < 1e-6) return fail([], ['Die Maßkette schließt sich nicht.']);
    lens[i] = Math.abs(dx) > 0 ? bx / dx : by / dy;
  }
  if (lens.some((v) => v == null || v <= 0.001)) return fail([], ['Die Maßkette ergibt keine positive Länge. Summe der Teilmaße passt nicht zur Gesamtstrecke.']);
  const sx = sum(signX, (k) => lens[k]);
  const sy = sum(signY, (k) => lens[k]);
  if (Math.abs(sx) > 0.02 || Math.abs(sy) > 0.02) return fail([], ['Die Maßkette schließt sich nicht. Gegenüberliegende Seiten oder Teilmaße widersprechen sich.']);
  let x = 0, y = 0;
  const pts = [{ x: 0, y: 0 }];
  for (let i = 0; i < n; i++) {
    if (axis[i] === 0) x += lens[i];
    if (axis[i] === 1) y += lens[i];
    if (axis[i] === 2) x -= lens[i];
    if (axis[i] === 3) y -= lens[i];
    pts.push({ x, y });
  }
  const parts = sliceRects(pts);
  const steps = [`Fläche, rechtwinkliger Umriss, ${parts.length} Teilflächen`];
  edges.forEach((e, i) => steps.push(`${e.label} = ${fmtNum(lens[i])} m${edgeMeters(e) == null ? ' (abgeleitet)' : ''}`));
  parts.forEach((p) => steps.push(`${p.label}: ${p.formula} = ${fmtNum(p.result)} m²`));
  const sumA = parts.reduce((s, p) => s + p.result, 0);
  steps.push(`Formel: A = ${parts.map((p) => p.label).join(' + ')}`);
  steps.push(`Rechnung: ${parts.map((p) => fmtNum(p.result) + ' m²').join(' + ')} = ${fmtNum(sumA)} m²`);
  return { ok: true, missing: [], contradictions: [], area: sumA, steps, parts, edgeNotes: edgeNotes(edges, lens) };
}
function sliceRects(pts) {
  const ys = [...new Set(pts.map((p) => Math.round(p.y * 1000) / 1000))].sort((a, b) => a - b);
  const parts = [];
  for (let i = 0; i < ys.length - 1; i++) {
    const y0 = ys[i], y1 = ys[i + 1], ym = (y0 + y1) / 2;
    const xs = [];
    for (let k = 0; k < pts.length - 1; k++) {
      const a = pts[k], b = pts[k + 1];
      if (Math.abs(a.x - b.x) > 1e-6) continue;
      const lo = Math.min(a.y, b.y), hi = Math.max(a.y, b.y);
      if (ym > lo + 1e-6 && ym < hi - 1e-6) xs.push(a.x);
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const w = xs[k + 1] - xs[k], h = y1 - y0;
      if (w > 0.001 && h > 0.001) parts.push({ label: 'F' + (parts.length + 1), formula: `${fmtNum(w)} m x ${fmtNum(h)} m`, result: w * h });
    }
  }
  return parts;
}
function trapezoidEval(doc, ids, edges) {
  const pair = (doc.parallels || []).find((p) => edges.some((e) => e.id === p.e1) && edges.some((e) => e.id === p.e2));
  if (!pair) return fail(['Parallelität der beiden Grundseiten ist nicht festgelegt.']);
  const bases = edges.filter((e) => e.id === pair.e1 || e.id === pair.e2);
  const legs = edges.filter((e) => e.id !== pair.e1 && e.id !== pair.e2);
  const b1 = edgeMeters(bases[0]), b2 = edgeMeters(bases[1]);
  if (b1 == null) return fail([`Strecke ${bases[0].label} fehlt`]);
  if (b2 == null) return fail([`Strecke ${bases[1].label} fehlt`]);
  let height = null, hLabel = '';
  for (const leg of legs) {
    const i = edges.indexOf(leg);
    const atStart = hasRight(doc, ids[i], edges[(i + 3) % 4].id, edges[i].id);
    if (atStart && edgeMeters(leg) != null) { height = edgeMeters(leg); hLabel = leg.label; break; }
  }
  if (height == null) return fail(['Höhe zwischen den parallelen Seiten fehlt (rechter Winkel an einem Schenkel).']);
  const area = (b1 + b2) / 2 * height;
  const steps = ['Fläche F1, Trapez', `${bases[0].label} = ${fmtNum(b1)} m`, `${bases[1].label} = ${fmtNum(b2)} m`, `${hLabel} = ${fmtNum(height)} m, Höhe`, 'Formel: A = (a + c) / 2 x h', `Rechnung: (${fmtNum(b1)} m + ${fmtNum(b2)} m) / 2 x ${fmtNum(height)} m = ${fmtNum(area)} m²`];
  return { ok: true, missing: [], contradictions: [], area, steps, parts: [{ label: 'F1', formula: 'A = (a + c) / 2 x h', result: area }] };
}

export function evaluateCycle(doc, ids) {
  const edges = cycleEdges(doc, ids);
  if (!edges) return fail(['Die Fläche ist nicht geschlossen.']);
  if (ids.length === 3) return triangleEval(doc, ids, edges);
  if (ids.length === 4) {
    const rights = ids.filter((id, i) => hasRight(doc, id, edges[(i + 3) % 4].id, edges[i].id)).length;
    if ((doc.parallels || []).some((p) => edges.some((e) => e.id === p.e1) && edges.some((e) => e.id === p.e2)) && rights < 4) return trapezoidEval(doc, ids, edges);
    return rectangleEval(doc, ids, edges);
  }
  return orthogonalEval(doc, ids, edges);
}

function polyArea(nodes) {
  let s = 0;
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i], b = nodes[(i + 1) % nodes.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}
function pointIn(nodes, x, y) {
  let c = false;
  for (let i = 0, j = nodes.length - 1; i < nodes.length; j = i++) {
    const yi = nodes[i].y, yj = nodes[j].y, xi = nodes[i].x, xj = nodes[j].x;
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-12) + xi)) c = !c;
  }
  return c;
}
export function findCycles(doc) {
  const adj = new Map();
  for (const e of doc.edges) {
    if (!adj.has(e.a)) adj.set(e.a, []);
    if (!adj.has(e.b)) adj.set(e.b, []);
    adj.get(e.a).push(e);
    adj.get(e.b).push(e);
  }
  const seen = new Set();
  const cycles = [];
  const other = (e, n) => (e.a === n ? e.b : e.a);
  for (const e0 of doc.edges) for (const start of [e0.a, e0.b]) {
    if (seen.has(e0.id + '>' + start)) continue;
    const nodes = [start];
    let prev = start, curEdge = e0, cur = other(e0, start);
    let ok = false;
    for (let step = 0; step < doc.edges.length + 2; step++) {
      seen.add(curEdge.id + '>' + prev);
      nodes.push(cur);
      if (cur === start) { ok = true; break; }
      const opts = (adj.get(cur) || []).filter((e) => e.id !== curEdge.id);
      if (!opts.length) break;
      const p0 = nodeById(doc, prev), p1 = nodeById(doc, cur);
      const ang0 = Math.atan2(p0.y - p1.y, p0.x - p1.x);
      let best = null, bestD = 99;
      for (const e of opts) {
        const nx = other(e, cur);
        const p2 = nodeById(doc, nx);
        let diff = ang0 - Math.atan2(p2.y - p1.y, p2.x - p1.x);
        while (diff <= 0) diff += Math.PI * 2;
        if (diff < bestD) { bestD = diff; best = { e, nx }; }
      }
      if (!best) break;
      prev = cur; curEdge = best.e; cur = best.nx;
    }
    if (!ok || nodes.length < 4) continue;
    const ids = nodes.slice(0, -1);
    const sig = [...ids].sort().join(',');
    if (cycles.some((c) => c.sig === sig)) continue;
    cycles.push({ nodes: ids, sig, area: polyArea(ids.map((id) => nodeById(doc, id))) });
  }
  return cycles.filter((c) => c.area > 1e-6);
}
export function cycleAt(doc, x, y) {
  const hits = findCycles(doc).filter((c) => pointIn(c.nodes.map((id) => nodeById(doc, id)), x, y));
  hits.sort((a, b) => a.area - b.area);
  return hits[0] || null;
}
export function importLegacyStrokes(strokes) {
  let doc = emptyDoc();
  for (const s of strokes || []) {
    const pts = s.points || [];
    if (s.tool === 'line' && pts.length >= 2) doc = addLine(doc, { x: pts[0][0], y: pts[0][1] }, { x: pts[pts.length - 1][0], y: pts[pts.length - 1][1] }, { free: !!s.free, color: s.color, dash: s.dash });
    else if (pts.length >= 2) doc = addStroke(doc, pts, { width: s.width || 0.012, color: s.color || '#e8590c' });
  }
  return doc;
}
export function importLegacySketch(sketch, w, h) {
  const doc = emptyDoc();
  const ww = w || sketch.imgW || 1, hh = h || sketch.imgH || 1;
  const map = new Map();
  for (const v of sketch.vertices || []) {
    const id = nid(doc, 'n');
    doc.nodes.push({ id, x: v.x / ww, y: v.y / hh });
    map.set(v.id, id);
  }
  for (const e of sketch.edges || []) {
    const a = map.get(e.v1), b = map.get(e.v2);
    if (!a || !b) continue;
    const id = nid(doc, 'e');
    doc.edges.push({ id, a, b, label: e.label || nextEdgeLabel(doc), measure: e.lengthM ? { value: +e.lengthM, unit: 'm', source: 'user' } : null, role: e.role || '' });
    doc.seq.push({ type: 'edge', id });
  }
  doc.legacyFaces = (sketch.faces || []).map((f) => f.label).filter(Boolean);
  return doc;
}
export function legacyStrokes(doc) {
  const lines = (doc.edges || []).map((e) => {
    const a = nodeById(doc, e.a), b = nodeById(doc, e.b);
    return a && b ? { tool: 'line', color: e.color || (e.free ? '#7048e8' : '#1f2933'), width: 0.012, points: [[a.x, a.y], [b.x, b.y]], free: !!e.free, dash: e.dash != null ? !!e.dash : !!e.free } : null;
  }).filter(Boolean);
  const pens = (doc.strokes || []).map((s) => ({ tool: 'pen', color: s.color || '#e8590c', width: s.width || 0.012, points: s.points }));
  return [...pens, ...lines];
}

export const ANGLE_TOL = 10 * Math.PI / 180;

function wrapPi(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
export function angleSnap(doc, start, x, y, tol = ANGLE_TOL) {
  const sx = start.x, sy = start.y;
  const len = Math.hypot(x - sx, y - sy);
  if (len < 1e-6) return null;
  const ang = Math.atan2(y - sy, x - sx);
  const connected = [];
  if (start.nodeId && nodeById(doc, start.nodeId)) {
    for (const e of doc.edges) {
      if (e.a !== start.nodeId && e.b !== start.nodeId) continue;
      const o = nodeById(doc, e.a === start.nodeId ? e.b : e.a);
      if (!o) continue;
      const base = Math.atan2(o.y - sy, o.x - sx);
      connected.push({ edgeId: e.id, dirs: [base + Math.PI / 2, base - Math.PI / 2] });
    }
  }
  let best = null;
  const consider = (target, edgeId, pri) => {
    const ad = Math.abs(wrapPi(ang - target));
    if (ad > tol) return;
    if (!best || ad < best.ad - 1e-9 || (Math.abs(ad - best.ad) <= 1e-9 && pri < best.pri)) best = { ad, target, edgeId, pri };
  };
  for (const c of connected) for (const t of c.dirs) consider(t, c.edgeId, 0);
  for (const t of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) consider(t, null, 1);
  if (!best) return null;
  let edgeId = best.edgeId;
  if (!edgeId) {
    for (const c of connected) for (const t of c.dirs) if (Math.abs(wrapPi(best.target - t)) < 0.02) edgeId = c.edgeId;
  }
  return {
    x: sx + Math.cos(best.target) * len,
    y: sy + Math.sin(best.target) * len,
    right: edgeId ? { nodeId: start.nodeId, edgeId } : null,
  };
}
export function rightAtJoin(doc, from, to, tol = ANGLE_TOL) {
  const hits = [];
  const check = (nodeId, ox, oy) => {
    if (!nodeId) return;
    const n = nodeById(doc, nodeId);
    if (!n) return;
    const dir = Math.atan2(oy - n.y, ox - n.x);
    for (const e of doc.edges) {
      if (e.a !== nodeId && e.b !== nodeId) continue;
      const o = nodeById(doc, e.a === nodeId ? e.b : e.a);
      if (!o) continue;
      const along = Math.atan2(o.y - n.y, o.x - n.x);
      const abs = Math.abs(wrapPi(dir - along));
      if (Math.abs(abs - Math.PI / 2) <= tol) hits.push({ nodeId, edgeId: e.id });
    }
  };
  check(from?.nodeId, to.x, to.y);
  check(to?.nodeId, from.x, from.y);
  return hits;
}
export function moveNode(doc, id, x, y) {
  const d = clone(doc);
  const n = nodeById(d, id);
  if (n) { n.x = Math.max(0, Math.min(1, x)); n.y = Math.max(0, Math.min(1, y)); }
  return d;
}
function clamp01(v) { return Math.max(0, Math.min(1, v)); }
export function constrainEndpoint(doc, { nodeId, fixed, origin, x, y, free, radius, lock }) {
  let snap = snapTarget(doc, x, y, radius, nodeId);
  if (snap?.kind === 'node' && snap.nodeId === fixed.nodeId) snap = null;
  if (snap) return { x: snap.x, y: snap.y, snap };
  if (free) return { x: clamp01(x), y: clamp01(y), snap: null };
  const ang = Math.atan2(y - fixed.y, x - fixed.x);
  const delta = Math.abs(wrapPi(ang - origin));
  const along = delta <= ANGLE_TOL || Math.abs(delta - Math.PI) <= ANGLE_TOL;
  if (!free && !lock && !along) {
    const turned = angleSnap(doc, { x: fixed.x, y: fixed.y, nodeId: fixed.nodeId }, x, y);
    if (turned) return { x: clamp01(turned.x), y: clamp01(turned.y), snap: { x: turned.x, y: turned.y, kind: 'angle' }, right: turned.right };
  }
  const dx = Math.cos(origin), dy = Math.sin(origin);
  let t = (x - fixed.x) * dx + (y - fixed.y) * dy;
  if (Math.abs(t) < 0.02) t = t < 0 ? -0.02 : 0.02;
  return { x: clamp01(fixed.x + dx * t), y: clamp01(fixed.y + dy * t), snap: null };
}
export function placeEndpoint(doc, nodeId, pos) {
  if (pos.snap?.kind === 'node' && pos.snap.nodeId && pos.snap.nodeId !== nodeId) {
    const d = clone(doc);
    const fromId = nodeId, toId = pos.snap.nodeId;
    if (!nodeById(d, fromId) || !nodeById(d, toId)) return d;
    for (const e of d.edges) {
      if (e.a === fromId) e.a = toId;
      if (e.b === fromId) e.b = toId;
    }
    d.edges = d.edges.filter((e) => e.a !== e.b);
    const liveE = new Set(d.edges.map((e) => e.id));
    d.rights = (d.rights || []).filter((r) => liveE.has(r.e1) && liveE.has(r.e2)).map((r) => (r.node === fromId ? { ...r, node: toId } : r));
    d.parallels = (d.parallels || []).filter((p) => liveE.has(p.e1) && liveE.has(p.e2));
    d.seq = (d.seq || []).filter((s) => s.type !== 'edge' || liveE.has(s.id));
    if (!d.edges.some((e) => e.a === fromId || e.b === fromId)) d.nodes = d.nodes.filter((n) => n.id !== fromId);
    return d;
  }
  return moveNode(doc, nodeId, pos.x, pos.y);
}
export function deleteEdge(doc, edgeId) {
  const d = clone(doc);
  if (!edgeById(d, edgeId)) return d;
  d.edges = d.edges.filter((e) => e.id !== edgeId);
  const liveE = new Set(d.edges.map((e) => e.id));
  const liveN = new Set();
  d.edges.forEach((e) => { liveN.add(e.a); liveN.add(e.b); });
  d.nodes = d.nodes.filter((n) => liveN.has(n.id));
  d.rights = (d.rights || []).filter((r) => liveE.has(r.e1) && liveE.has(r.e2) && liveN.has(r.node));
  d.parallels = (d.parallels || []).filter((p) => liveE.has(p.e1) && liveE.has(p.e2));
  d.seq = (d.seq || []).filter((s) => s.type !== 'edge' || liveE.has(s.id));
  return d;
}
export function moveEdge(doc, edgeId, dx, dy) {
  const d = clone(doc);
  const e = edgeById(d, edgeId);
  if (!e) return d;
  for (const id of [e.a, e.b]) {
    const n = nodeById(d, id);
    if (n) { n.x = Math.max(0, Math.min(1, n.x + dx)); n.y = Math.max(0, Math.min(1, n.y + dy)); }
  }
  return d;
}
export function setFaceOffset(doc, sig, dx, dy) {
  const d = clone(doc);
  d.faceOffsets = d.faceOffsets || [];
  const row = { sig, dx, dy };
  const i = d.faceOffsets.findIndex((f) => f.sig === sig);
  if (i >= 0) d.faceOffsets[i] = row; else d.faceOffsets.push(row);
  return d;
}
function segDist(px, py, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
  let t = ((px - a.x) * dx + (py - a.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}
export function pointInPoly(nodes, x, y) { return pointIn(nodes, x, y); }
export function polylabel(points) {
  if (!points?.length) return { x: 0.5, y: 0.5 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  const dist = (x, y) => {
    let m = Infinity;
    for (let i = 0; i < points.length; i++) m = Math.min(m, segDist(x, y, points[i], points[(i + 1) % points.length]));
    return pointIn(points, x, y) ? m : -m;
  };
  let best = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  let bestD = dist(best.x, best.y);
  const w = Math.max(1e-6, maxX - minX), h = Math.max(1e-6, maxY - minY);
  const n = 24;
  for (let iy = 0; iy < n; iy++) for (let ix = 0; ix < n; ix++) {
    const x = minX + (ix + 0.5) / n * w, y = minY + (iy + 0.5) / n * h;
    const d = dist(x, y);
    if (d > bestD) { bestD = d; best = { x, y }; }
  }
  let step = Math.max(w, h) / n;
  for (let k = 0; k < 4; k++) {
    step /= 2;
    const x0 = best.x, y0 = best.y;
    for (let iy = -3; iy <= 3; iy++) for (let ix = -3; ix <= 3; ix++) {
      const x = x0 + ix * step, y = y0 + iy * step;
      const d = dist(x, y);
      if (d > bestD) { bestD = d; best = { x, y }; }
    }
  }
  return best;
}
function cycleCrosses(doc, ids) {
  const edges = cycleEdges(doc, ids);
  if (!edges) return false;
  for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) {
    if (j === i + 1 || (i === 0 && j === edges.length - 1)) continue;
    const a = nodeById(doc, edges[i].a), b = nodeById(doc, edges[i].b);
    const c = nodeById(doc, edges[j].a), d = nodeById(doc, edges[j].b);
    if (a && b && c && d && segIntersect(a, b, c, d)) return true;
  }
  return false;
}
export function evaluateFaces(doc) {
  const calc = collapseForCalc(doc);
  const out = [];
  for (const cyc of findCycles(calc)) {
    const edges = cycleEdges(calc, cyc.nodes);
    if (!edges || cycleCrosses(calc, cyc.nodes)) continue;
    const poly = cyc.nodes.map((id) => nodeById(calc, id)).filter(Boolean);
    if (poly.length < 3) continue;
    const pole = polylabel(poly);
    const off = (calc.faceOffsets || []).find((f) => f.sig === cyc.sig) || { dx: 0, dy: 0 };
    let x = pole.x + (off.dx || 0), y = pole.y + (off.dy || 0);
    if (!pointIn(poly, x, y)) { x = pole.x; y = pole.y; }
    const free = edges.some((e) => e.free);
    const ev = free ? fail(['Freie Linie – keine Berechnung']) : evaluateCycle(calc, cyc.nodes);
    let text = 'Maße fehlen';
    if (free) text = 'Freie Linie – keine Berechnung';
    else if (ev.contradictions?.length) text = 'Widerspruch';
    else if (ev.ok) text = `${fmtNum(ev.area)} m²`;
    out.push({ sig: cyc.sig, nodes: cyc.nodes, x, y, text, ev, free, ok: !!ev.ok && !free });
  }
  return out;
}
export function faceEvalAt(doc, x, y) {
  const calc = collapseForCalc(doc);
  const cyc = cycleAt(calc, x, y);
  if (!cyc) return null;
  return { nodes: cyc.nodes, sig: cyc.sig, ev: evaluateCycle(calc, cyc.nodes) };
}
const LETTER_BEZ = /^(seite\s+)?[a-z]\d*$/i;
export function partSummary(rows) {
  const groups = new Map();
  const order = [];
  for (const r of rows || []) {
    const unit = String(r.einheit || '').trim();
    if (!unit || /^m²$/i.test(unit) || /^m2$/i.test(unit)) continue;
    const raw = cleanPartName(r.bez);
    if (!raw || LETTER_BEZ.test(raw)) continue;
    if (r.menge == null || r.menge === '' || !isFinite(+r.menge)) continue;
    const key = `${raw.toLowerCase()}\0${unit.toLowerCase()}`;
    if (!groups.has(key)) {
      groups.set(key, { name: raw, unit, parts: [] });
      order.push(key);
    }
    groups.get(key).parts.push(Math.round(+r.menge * 100) / 100);
  }
  return order.map((key) => {
    const g = groups.get(key);
    if (g.parts.length < 2) return null;
    const sum = Math.round(g.parts.reduce((s, n) => s + n, 0) * 100) / 100;
    const bits = g.parts.map((n) => `${fmtNum(n)} ${g.unit}`);
    return { name: g.name, unit: g.unit, parts: g.parts, sum, text: `${g.name}: ${bits.join(' + ')} = ${fmtNum(sum)} ${g.unit}` };
  }).filter(Boolean);
}
export function sketchProposals(doc) {
  const labels = (doc.edges || []).map((e) => e.label);
  const dup = new Set(labels.filter((l, i) => l && labels.indexOf(l) !== i));
  const known = new Map();
  for (const f of evaluateFaces(doc)) {
    if (!f.ok) continue;
    for (const n of f.ev.edgeNotes || []) if (n.meters != null) known.set(n.id, n);
  }
  const sides = (doc.edges || []).map((e) => {
    const entered = e.measure && e.measure.source !== 'derived' && isFinite(+e.measure.value);
    const got = known.get(e.id);
    const part = cleanPartName(e.name);
    const ambiguous = !part && dup.has(e.label);
    const missing = !entered && !got;
    return {
      kind: 'side', id: e.id, bez: part || `Seite ${String(e.label || '?').toUpperCase()}`,
      value: entered ? +e.measure.value : (got ? Math.round(got.meters * 100) / 100 : null),
      unit: entered ? (e.measure.unit || 'm') : (got ? 'm' : null),
      missing, ambiguous, derived: !entered && !!got?.derived, free: !!e.free,
      take: !missing && !ambiguous,
    };
  });
  const areas = evaluateFaces(doc).map((f, i) => ({
    kind: 'area', sig: f.sig, bez: `Fläche ${f.ev.parts?.[0]?.label || ('F' + (i + 1))}`,
    value: f.ok ? Math.round(f.ev.area * 100) / 100 : null,
    unit: 'm²', missing: !f.ok, free: !!f.free, take: !!f.ok,
    hint: f.ok ? '' : (f.ev.steps || []).slice(0, 4).join(' · '),
    steps: f.ev.steps || [], parts: f.ev.parts || [],
  }));
  return { sides, areas };
}
