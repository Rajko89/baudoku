// Flächen nur aus eingetragenen Maßen und ausdrücklich festgelegten Winkeln oder Parallelitäten.
// Zeichenkoordinaten liefern keine Längen und keine rechten Winkel.

export function emptyDoc() {
  return { next: 1, nodes: [], edges: [], strokes: [], texts: [], rights: [], parallels: [], seq: [], chains: [] };
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

export function snapTarget(doc, x, y, radius) {
  let best = null;
  const consider = (cand, d) => { if (d <= radius && (!best || d < best.d)) best = { ...cand, d }; };
  for (const n of doc.nodes) consider({ x: n.x, y: n.y, kind: 'node', nodeId: n.id }, Math.hypot(n.x - x, n.y - y));
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
  const e1 = { id: nid(doc, 'e'), a: e.a, b: n.id, label: e.label, measure: null, chain: e.chain || null };
  const e2 = { id: nid(doc, 'e'), a: n.id, b: e.b, label: nextEdgeLabel(doc), measure: null, chain: e.chain || null };
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
export function addLine(doc, start, end) {
  const d = clone(doc);
  const a = place(d, start);
  const b = place(d, end);
  if (a !== b && !d.edges.some((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a))) {
    const id = nid(d, 'e');
    d.edges.push({ id, a, b, label: nextEdgeLabel(d), measure: null });
    d.seq = [...(d.seq || []), { type: 'edge', id }];
  }
  return d;
}
export function addStroke(doc, points) {
  const d = clone(doc);
  const id = nid(d, 's');
  d.strokes.push({ id, points: points.map((p) => [p[0], p[1]]) });
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
export function deleteText(doc, id) {
  const d = clone(doc);
  d.texts = d.texts.filter((t) => t.id !== id);
  d.seq = (d.seq || []).filter((s) => !(s.type === 'text' && s.id === id));
  return d;
}
export function setMeasure(doc, edgeId, value, unit) {
  const d = clone(doc);
  const e = edgeById(d, edgeId);
  if (!e) return d;
  if (value == null || value === '' || !isFinite(+value)) e.measure = null;
  else e.measure = { value: +value, unit: unit || 'm', source: 'user' };
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
  return edges.map((e, i) => ({ id: e.id, text: `${fmtNum(lens[i])} m`, derived: edgeMeters(e) == null }));
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
  steps.push('Formel: A = a x b');
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
    if (s.tool === 'line' && pts.length >= 2) doc = addLine(doc, { x: pts[0][0], y: pts[0][1] }, { x: pts[pts.length - 1][0], y: pts[pts.length - 1][1] });
    else if (pts.length >= 2) doc = addStroke(doc, pts);
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
    return a && b ? { tool: 'line', color: '#e8590c', width: 0.012, points: [[a.x, a.y], [b.x, b.y]] } : null;
  }).filter(Boolean);
  const pens = (doc.strokes || []).map((s) => ({ tool: 'pen', color: '#e8590c', width: 0.012, points: s.points }));
  return [...pens, ...lines];
}
