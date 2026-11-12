// Flächen aus zugeordneten Maßen. Rechnet nur mit vorhandenen Angaben, erfindet keine Längen.
import { dist, polyArea, homography, applyH } from './geom.js';

export const ROLES = [
  { id: '', label: '–' },
  { id: 'traufe', label: 'Traufe' },
  { id: 'first', label: 'First' },
  { id: 'ortgang', label: 'Ortgang' },
  { id: 'breite', label: 'Dachbreite' },
  { id: 'schraege', label: 'schräge Dachlänge' },
  { id: 'hoehe', label: 'Höhe/Hilfsmaß' },
  { id: 'kante', label: 'Kante' },
];
export const roleLabel = (id) => ROLES.find((r) => r.id === id)?.label || '';
export const isLengthUnit = (u) => ['m', 'lfm'].includes(String(u || '').trim());
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
export function fmtM(n) {
  return Number(n).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
export function nextEdgeLabel(edges) {
  const used = new Set((edges || []).map((e) => e.label));
  for (let i = 0; i < 26; i++) { const l = String.fromCharCode(97 + i); if (!used.has(l)) return l; }
  return 'k' + ((edges || []).length + 1);
}
export function nextFaceLabel(faces) {
  const used = new Set((faces || []).map((f) => f.label));
  let n = 1; while (used.has('F' + n)) n++; return 'F' + n;
}
const vert = (sketch, id) => (sketch.vertices || []).find((v) => v.id === id);
export function edgePx(sketch, edge) {
  const a = vert(sketch, edge.v1), b = vert(sketch, edge.v2);
  if (!a || !b) return 0;
  return dist([a.x, a.y], [b.x, b.y]);
}

/** 'homography' | 'ref' | null. Perspektivfotos ohne Referenzrechteck gelten nicht als maßstäblich. */
export function reliableScale(sketch) {
  const s = sketch.scale || {};
  if (s.mode === 'homography' && s.persp && s.persp.pts?.length === 4 && +s.persp.w > 0 && +s.persp.h > 0) return 'homography';
  if (sketch.viewKind === 'top' && s.mode === 'ref' && s.refEdgeId && +s.refLengthM > 0) return 'ref';
  return null;
}
export function scaleWarning(sketch) {
  const mode = reliableScale(sketch);
  if (sketch.viewKind === 'perspective' && mode !== 'homography') {
    return 'Perspektivfoto: ohne Referenzrechteck (Entzerrung) werden keine Maße aus dem Bild abgeleitet. Längen eingeben oder eine Aufmaßposition zuweisen.';
  }
  if (!mode && sketch.viewKind !== 'top') {
    return 'Keine bestätigte Draufsicht: aus dem Bild werden keine Maße erfunden. Referenzlänge, Entzerrung oder eingegebene Werte verwenden.';
  }
  if (mode || sketch.viewKind === 'top') {
    return 'Ein Maßstab aus Draufsicht oder Entzerrung ergibt die Grundriss-/Projektionsfläche, nicht automatisch die geneigte Dachfläche.';
  }
  return 'Für maßstäbliche Angaben eine Referenzlänge setzen oder Maße von Hand eingeben.';
}
function metersMapper(sketch) {
  const mode = reliableScale(sketch);
  if (mode === 'homography') {
    const { w, h, pts } = sketch.scale.persp;
    const H = homography(pts, [[0, 0], [w, 0], [w, h], [0, h]]);
    if (!H) return null;
    return (p) => applyH(H, p);
  }
  if (mode === 'ref') {
    const edge = (sketch.edges || []).find((e) => e.id === sketch.scale.refEdgeId);
    const px = edge ? edgePx(sketch, edge) : 0;
    if (!(px > 0)) return null;
    const s = +sketch.scale.refLengthM / px;
    return (p) => [p[0] * s, p[1] * s];
  }
  return null;
}
export function scaledEdgeLength(sketch, edge) {
  const map = metersMapper(sketch);
  if (!map) return null;
  const a = vert(sketch, edge.v1), b = vert(sketch, edge.v2);
  if (!a || !b) return null;
  const m = dist(map([a.x, a.y]), map([b.x, b.y]));
  return isFinite(m) && m > 0 ? m : null;
}
export function resolveEdgeLength(sketch, edge, aufmassById) {
  if (edge.aufmassId && aufmassById) {
    const r = aufmassById.get(edge.aufmassId);
    if (r && isLengthUnit(r.einheit) && r.menge != null && isFinite(+r.menge) && +r.menge > 0) {
      return { m: +r.menge, source: 'aufmass', aufmassId: r.id, pos: r.pos, bez: r.bez };
    }
  }
  if (edge.lengthM != null && edge.lengthM !== '' && isFinite(+edge.lengthM) && +edge.lengthM > 0) {
    return { m: +edge.lengthM, source: edge.lengthSource || 'manual' };
  }
  if (sketch.scale?.mode === 'ref' && sketch.scale.refEdgeId === edge.id && +sketch.scale.refLengthM > 0 && sketch.viewKind === 'top') {
    return { m: +sketch.scale.refLengthM, source: 'ref' };
  }
  const sc = scaledEdgeLength(sketch, edge);
  if (sc != null) return { m: sc, source: reliableScale(sketch) };
  return null;
}
function edgeLine(edge, len) {
  const role = edge.role === 'schraege' ? 'gemessene schräge Dachlänge' : roleLabel(edge.role);
  const base = `${edge.label} = ${fmtM(len.m)} m`;
  return role ? `${base}, ${role}` : base;
}
function packEdge(edge, len) {
  return { id: edge.id, label: edge.label, role: edge.role || '', m: len.m, line: edgeLine(edge, len), source: len.source };
}
function fail(face, shapeLabel, missing) {
  return { ok: false, missing, faceLabel: face.label, shapeLabel, areaKind: face.areaMode === 'sloped' ? 'sloped' : 'projection', areaKindLabel: face.areaMode === 'sloped' ? 'Geneigte Dachfläche' : 'Grundriss-/Projektionsfläche', isDeduction: !!face.isDeduction, edges: [], formula: '', substitution: '', result: null, unit: 'm²', parts: [], deductions: [] };
}
function okCalc(face, shapeLabel, areaKind, edges, formula, substitution, result, extra = {}) {
  const kind = areaKind === 'sloped' ? 'sloped' : 'projection';
  return {
    ok: true, missing: [], faceLabel: face.label, shapeLabel, areaKind: kind,
    areaKindLabel: kind === 'sloped' ? 'Geneigte Dachfläche' : 'Grundriss-/Projektionsfläche',
    isDeduction: !!face.isDeduction, edges, formula, substitution, result: round2(result), unit: 'm²',
    parts: extra.parts || [], deductions: extra.deductions || [],
  };
}
function needLen(sketch, id, aufmassById) {
  const e = (sketch.edges || []).find((x) => x.id === id);
  if (!e) return null;
  const len = resolveEdgeLength(sketch, e, aufmassById);
  return len ? { edge: e, ...len } : { edge: e, missing: true };
}
function pitchCos(deg) {
  const a = +deg;
  if (!(a > 0 && a < 89)) return null;
  return Math.cos(a * Math.PI / 180);
}
function applySlope(face, edges, planArea, allowSlopeEdge) {
  const slopeEdge = edges.find((e) => e.role === 'schraege');
  if (face.areaMode !== 'sloped') {
    if (slopeEdge) return { error: `Kante ${slopeEdge.label} ist eine gemessene schräge Dachlänge und kein Grundrissmaß. Für die geneigte Fläche den Modus „geneigt“ wählen.` };
    return { area: planArea, pitch: null };
  }
  if (allowSlopeEdge && (face.slopeSource === 'edge' || (face.slopeSource !== 'pitch' && slopeEdge))) {
    if (!slopeEdge) return { error: `Für die geneigte Fläche ${face.label} fehlt eine Kante mit der Rolle „schräge Dachlänge“, oder die Dachneigung.` };
    return { area: planArea, pitch: null, viaSlopeEdge: true };
  }
  const c = pitchCos(face.pitchDeg);
  if (c == null) {
    return { error: `Für die geneigte Fläche ${face.label} fehlt die Dachneigung in Grad${allowSlopeEdge ? ' oder eine gemessene schräge Dachlänge' : ''}.` };
  }
  return { area: planArea / c, pitch: +face.pitchDeg };
}

function computeRect(sketch, face, aufmassById) {
  const a = needLen(sketch, face.edgeA, aufmassById);
  const b = needLen(sketch, face.edgeB, aufmassById);
  if (!a?.edge || !b?.edge) return fail(face, 'Rechteck', [`Für Rechteck ${face.label} zwei Kanten (a und b) zuweisen.`]);
  if (a.missing || b.missing) {
    const miss = [a, b].filter((x) => x.missing).map((x) => x.edge.label).join(' und ');
    return fail(face, 'Rechteck', [`Für Rechteck ${face.label} fehlt das Maß der Kante ${miss}.`]);
  }
  const edges = [packEdge(a.edge, a), packEdge(b.edge, b)];
  const plan = a.m * b.m;
  const slope = applySlope(face, edges, plan, true);
  if (slope.error) return fail(face, 'Rechteck', [slope.error]);
  const formula = slope.pitch ? 'A = a x b / cos(alpha)' : 'A = a x b';
  const subst = slope.pitch
    ? `${fmtM(a.m)} m x ${fmtM(b.m)} m / cos(${fmtM(slope.pitch)}°) = ${fmtM(slope.area)} m²`
    : `${fmtM(a.m)} m x ${fmtM(b.m)} m = ${fmtM(slope.area)} m²`;
  return okCalc(face, 'Rechteck', face.areaMode === 'sloped' ? 'sloped' : 'projection', edges, formula, subst, slope.area);
}
function computeTri(sketch, face, aufmassById) {
  const base = needLen(sketch, face.baseEdgeId, aufmassById);
  const height = needLen(sketch, face.heightEdgeId, aufmassById);
  if (base?.edge && height?.edge && !base.missing && !height.missing) {
    const edges = [packEdge(base.edge, base), packEdge(height.edge, height)];
    const plan = base.m * height.m / 2;
    const slope = applySlope(face, edges, plan, false);
    if (slope.error) return fail(face, 'Dreieck', [slope.error]);
    const formula = slope.pitch ? 'A = a x h / 2 / cos(alpha)' : 'A = a x h / 2';
    const subst = `${fmtM(base.m)} m x ${fmtM(height.m)} m / 2${slope.pitch ? ` / cos(${fmtM(slope.pitch)}°)` : ''} = ${fmtM(slope.area)} m²`;
    return okCalc(face, 'Dreieck', face.areaMode === 'sloped' ? 'sloped' : 'projection', edges, formula, subst, slope.area);
  }
  const ids = face.edgeIds?.length ? face.edgeIds : (sketch.edges || []).filter((e) => (face.vertexIds || []).length && [e.v1, e.v2].every((v) => face.vertexIds.includes(v))).map((e) => e.id);
  const lens = ids.map((id) => needLen(sketch, id, aufmassById)).filter((x) => x?.edge);
  if (lens.length >= 3 && lens.slice(0, 3).every((x) => !x.missing)) {
    const [A, B, C] = lens.slice(0, 3);
    const area = heron(A.m, B.m, C.m);
    if (area == null) return fail(face, 'Dreieck', [`Die Seiten ${A.edge.label}, ${B.edge.label}, ${C.edge.label} bilden kein Dreieck.`]);
    const edges = [A, B, C].map((x) => packEdge(x.edge, x));
    const slope = applySlope(face, edges, area, false);
    if (slope.error) return fail(face, 'Dreieck', [slope.error]);
    const formula = slope.pitch ? 'A = Heron(a, b, c) / cos(alpha)' : 'A = Heron(a, b, c)';
    const subst = `s = (${fmtM(A.m)} + ${fmtM(B.m)} + ${fmtM(C.m)}) / 2, A = ${fmtM(slope.area)} m²`;
    return okCalc(face, 'Dreieck', face.areaMode === 'sloped' ? 'sloped' : 'projection', edges, formula, subst, slope.area);
  }
  const baseName = base?.edge?.label || 'a';
  return fail(face, 'Dreieck', [`Für Dreieck ${face.label} fehlt die Höhe zur Basis ${baseName} (oder alle drei Seitenlängen).`]);
}
function heron(a, b, c) {
  const s = (a + b + c) / 2;
  const x = s * (s - a) * (s - b) * (s - c);
  if (x < -1e-6) return null;
  return Math.sqrt(Math.max(0, x));
}
function computeTrap(sketch, face, aufmassById) {
  const a = needLen(sketch, face.baseEdgeId, aufmassById);
  const c = needLen(sketch, face.baseEdgeId2, aufmassById);
  const h = needLen(sketch, face.heightEdgeId, aufmassById);
  const names = { a: a?.edge?.label || 'a', c: c?.edge?.label || 'c', h: h?.edge?.label || 'h' };
  if (!a?.edge || !c?.edge || !h?.edge) return fail(face, 'Trapez', [`Für Trapez ${face.label} die beiden parallelen Seiten und die Höhe zuweisen.`]);
  if (a.missing || c.missing || h.missing) {
    if (h.missing) return fail(face, 'Trapez', [`Für Trapez ${face.label} fehlt die Höhe zwischen den parallelen Seiten ${names.a} und ${names.c}.`]);
    const miss = [a, c].filter((x) => x.missing).map((x) => x.edge.label).join(' und ');
    return fail(face, 'Trapez', [`Für Trapez ${face.label} fehlt das Maß der Seite ${miss}.`]);
  }
  const edges = [packEdge(a.edge, a), packEdge(c.edge, c), packEdge(h.edge, h)];
  const plan = (a.m + c.m) / 2 * h.m;
  const slope = applySlope(face, edges, plan, false);
  if (slope.error) return fail(face, 'Trapez', [slope.error]);
  const formula = slope.pitch ? 'A = (a + c) / 2 x h / cos(alpha)' : 'A = (a + c) / 2 x h';
  const subst = `(${fmtM(a.m)} m + ${fmtM(c.m)} m) / 2 x ${fmtM(h.m)} m${slope.pitch ? ` / cos(${fmtM(slope.pitch)}°)` : ''} = ${fmtM(slope.area)} m²`;
  return okCalc(face, 'Trapez', face.areaMode === 'sloped' ? 'sloped' : 'projection', edges, formula, subst, slope.area);
}
function computePoly(sketch, face, aufmassById) {
  const mode = reliableScale(sketch);
  if (!mode) {
    return fail(face, 'Vieleck', [`Für Vieleck ${face.label} reichen die Seitenlängen nicht. Bitte in Rechteck, Dreieck oder Trapez zerlegen, oder eine Höhe bzw. Diagonale angeben.`]);
  }
  const map = metersMapper(sketch);
  if (!map) return fail(face, 'Vieleck', [`Für Vieleck ${face.label} ist der Maßstab nicht zuverlässig. Referenzlänge auf einer Draufsicht oder ein Referenzrechteck setzen.`]);
  const pts = (face.vertexIds || []).map((id) => vert(sketch, id)).filter(Boolean).map((v) => map([v.x, v.y]));
  if (pts.length < 3) return fail(face, 'Vieleck', [`Für Vieleck ${face.label} mindestens drei Eckpunkte setzen.`]);
  const plan = polyArea(pts);
  if (!(plan > 0)) return fail(face, 'Vieleck', [`Für Vieleck ${face.label} ist die Fläche aus den Eckpunkten nicht bestimmbar.`]);
  const edges = [];
  const slope = face.areaMode === 'sloped' ? applySlope(face, edges, plan, false) : { area: plan, pitch: null };
  if (slope.error) return fail(face, 'Vieleck', [slope.error]);
  const formula = slope.pitch ? 'A = Projektion / cos(alpha)' : 'A = Flächenformel aus maßstäblichen Eckpunkten';
  const subst = slope.pitch
    ? `${fmtM(plan)} m² / cos(${fmtM(slope.pitch)}°) = ${fmtM(slope.area)} m²`
    : `Eckpunkte in m, A = ${fmtM(plan)} m²`;
  return okCalc(face, 'Vieleck', face.areaMode === 'sloped' ? 'sloped' : 'projection', edges, formula, subst, slope.area);
}
function computeComposite(sketch, face, aufmassById) {
  const ids = face.partFaceIds || [];
  if (ids.length < 2 && !(face.partFaceIds || []).length) return fail(face, 'zusammengesetzt', [`Für ${face.label} mindestens zwei Teilflächen wählen.`]);
  const parts = [], deductions = [], missing = [];
  for (const id of ids) {
    const part = (sketch.faces || []).find((f) => f.id === id);
    if (!part || part.id === face.id) continue;
    const calc = computeFace(sketch, part, aufmassById);
    if (!calc.ok) { missing.push(...calc.missing); continue; }
    const row = { pos: '', name: `${part.isDeduction ? 'Abzug' : 'Dachfläche'} ${part.label}`, calc };
    if (part.isDeduction) deductions.push(row); else parts.push(row);
  }
  if (missing.length) return fail(face, 'zusammengesetzt', missing);
  if (!parts.length) return fail(face, 'zusammengesetzt', [`Für ${face.label} ist keine Teilfläche mit vollständigem Rechenweg vorhanden.`]);
  const kinds = new Set([...parts, ...deductions].map((p) => p.calc.areaKind));
  if (kinds.size > 1) return fail(face, 'zusammengesetzt', [`Für ${face.label} Projektionsfläche und geneigte Fläche nicht mischen. Jede Teilfläche einzeln lassen oder gleiche Art wählen.`]);
  const sumP = parts.reduce((s, p) => s + p.calc.result, 0);
  const sumD = deductions.reduce((s, p) => s + p.calc.result, 0);
  const result = sumP - sumD;
  const pTxt = parts.map((p) => `${fmtM(p.calc.result)} m²`).join(' + ');
  const dTxt = deductions.map((p) => `${fmtM(p.calc.result)} m²`).join(' - ');
  const subst = `${pTxt}${dTxt ? ' - ' + dTxt : ''} = ${fmtM(result)} m²`;
  const edges = parts.flatMap((p) => p.calc.edges || []);
  return okCalc(face, 'zusammengesetzt', [...kinds][0], edges, 'A = Summe Teilflächen - Summe Abzüge', subst, result, { parts, deductions });
}

export function computeFace(sketch, face, aufmassById) {
  if (!face) return fail({ label: '?', isDeduction: false, areaMode: 'projection' }, 'Fläche', ['Keine Fläche.']);
  if (face.isComposite) return computeComposite(sketch, face, aufmassById);
  if (face.shape === 'rect') return computeRect(sketch, face, aufmassById);
  if (face.shape === 'tri') return computeTri(sketch, face, aufmassById);
  if (face.shape === 'trap') return computeTrap(sketch, face, aufmassById);
  if (face.shape === 'poly') return computePoly(sketch, face, aufmassById);
  return fail(face, 'Fläche', [`Für ${face.label} eine Flächenart wählen (Rechteck, Dreieck, Trapez oder Vieleck).`]);
}

export function formatCalcText({ pos, name, calc }) {
  if (!calc) return '';
  const head = `Position ${pos || '–'} – ${name || 'Fläche'}${calc.shapeLabel ? ', ' + calc.shapeLabel : ''}`;
  if (!calc.ok) return [head, ...(calc.missing || ['Angaben unvollständig.'])].join('\n');
  const lines = [head, calc.areaKindLabel];
  const ownEdges = calc.shapeLabel === 'zusammengesetzt' ? [] : (calc.edges || []);
  ownEdges.forEach((e) => lines.push(e.line));
  if (calc.parts?.length) {
    lines.push('Teilflächen:');
    calc.parts.forEach((p) => lines.push(formatCalcText({ pos: p.pos, name: p.name, calc: p.calc }).split('\n').map((l) => '  ' + l).join('\n')));
  }
  if (calc.deductions?.length) {
    lines.push('Abzüge:');
    calc.deductions.forEach((p) => lines.push(formatCalcText({ pos: p.pos, name: p.name, calc: p.calc }).split('\n').map((l) => '  ' + l).join('\n')));
  }
  lines.push('Formel: ' + calc.formula);
  lines.push('Rechnung: ' + calc.substitution);
  return lines.join('\n');
}

/** Summe nur aus ausdrücklich gewählten m²-Flächen derselben Art. */
export function sumSelected(rows) {
  if (!rows?.length) return { ok: false, missing: ['Keine Flächen ausgewählt.'] };
  if (rows.some((r) => String(r.einheit || '').trim() !== 'm²' || !isFinite(+r.menge))) {
    return { ok: false, missing: ['Nur fertige Flächen in m² summieren. Längen und Flächen nicht mischen.'] };
  }
  const kinds = new Set(rows.map((r) => r.calc?.areaKind || 'unknown'));
  if (kinds.size > 1) return { ok: false, missing: ['Projektionsfläche und geneigte Dachfläche nicht in eine Summe mischen.'] };
  const parts = [], deductions = [];
  rows.forEach((r) => {
    const calc = r.calc?.ok ? r.calc : { ok: true, result: +r.menge, shapeLabel: r.einheit, areaKindLabel: '', areaKind: [...kinds][0], edges: [], formula: r.expr || fmtM(r.menge), substitution: fmtM(r.menge) + ' m²', parts: [], deductions: [], isDeduction: !!r.calc?.isDeduction, faceLabel: '' };
    const row = { pos: r.pos, name: r.bez || r.pos, calc };
    if (r.calc?.isDeduction) deductions.push(row); else parts.push(row);
  });
  const sumP = parts.reduce((s, p) => s + p.calc.result, 0);
  const sumD = deductions.reduce((s, p) => s + p.calc.result, 0);
  const result = round2(sumP - sumD);
  const pTxt = parts.map((p) => `${p.pos} ${fmtM(p.calc.result)} m²`).join(' + ');
  const dTxt = deductions.map((p) => `${p.pos} ${fmtM(p.calc.result)} m²`).join(' - ');
  return {
    ok: true, missing: [], faceLabel: '', shapeLabel: 'Auswahl', areaKind: [...kinds][0],
    areaKindLabel: [...kinds][0] === 'sloped' ? 'Geneigte Dachfläche' : 'Grundriss-/Projektionsfläche',
    isDeduction: false, edges: [], formula: 'A = Summe der ausgewählten Flächen',
    substitution: `${pTxt}${dTxt ? ' - ' + dTxt : ''} = ${fmtM(result)} m²`,
    result, unit: 'm²', parts, deductions,
  };
}
