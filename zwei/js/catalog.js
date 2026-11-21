// Leistungskatalog, Mengen aus der Skizze und Angebotsentwurf. Nur Baudoku 2.
import { cleanPartName, evaluateFaces, fmtNum, toMeters } from './plan.js';

const EXCLUDE = 'Nicht enthalten: Gerüst und besondere Absturzsicherung, Kran und besondere Hebetechnik, Schadstoffsanierung, unvorhersehbare Untergrundsanierung, besondere Erschwernisse und außergewöhnliche Baustellenlogistik.';

export const SEEDS = [
  item('01', 'Blende montieren', 'm', 68, 'length', 'Liefern und montieren einer gekanteten Blende aus beschichtetem Aluminiumblech, Abwicklung bis 300 mm, Blechdicke 1,0 mm, einschließlich üblicher Befestigungsmittel und erforderlicher Blechverbindungen, auf vorhandener geeigneter Unterkonstruktion. Erneuerung oder Herstellung der Unterkonstruktion nicht enthalten. ' + EXCLUDE),
  item('02', 'Dachrinne demontieren', 'm', 12, 'length', 'Vorhandene außenliegende Dachrinne einschließlich Rinnenhaltern demontieren und zur bauseitigen Sammelstelle auf der Baustelle verbringen. Demontage von Fallrohren, Abtransport und Entsorgungsgebühren sind nicht enthalten. ' + EXCLUDE),
  item('03', 'Dachrinne montieren', 'm', 58, 'length', 'Liefern und montieren einer halbrunden Dachrinne aus Titanzink, Nenngröße 333, einschließlich üblicher Rinnenhalter, Befestigungen und Lötverbindungen, an vorhandener geeigneter Befestigungsgrundlage. Rinnenwinkel, Einhangstutzen, Dehnungsausgleicher und Fallrohre sind nicht enthalten. ' + EXCLUDE),
  item('04', 'Schweißbahn Oberlage', 'm²', 32, 'area', 'Liefern und fachgerecht aufschweißen einer beschieferten Polymerbitumen-Schweißbahn als Oberlage auf vorhandener geeigneter bituminöser Unterlage, einschließlich fachgerechter Naht- und Stoßausbildung. Untergrundvorbereitung, weitere Abdichtungslagen sowie Anschlüsse und Durchdringungen sind nicht enthalten. Ausführung nur bei für das Verfahren geeignetem Dachaufbau. ' + EXCLUDE),
  item('05', 'Bitumenvoranstrich', 'm²', 5, 'area', 'Liefern und aufbringen eines zum vorgesehenen Abdichtungssystem passenden bituminösen Voranstrichs auf trockener, sauberer und geeigneter Fläche nach Herstellervorgabe. Grundlegende Reinigung, Trocknung und Untergrundinstandsetzung sind nicht enthalten. ' + EXCLUDE),
  item('06', 'Dampfsperre verlegen', 'm²', 22, 'area', 'Liefern und verlegen einer bituminösen Dampfsperrbahn mit Aluminiumeinlage auf vorbereitetem und geeignetem Untergrund, einschließlich Naht- und Stoßverbindungen. Material und Verlegeverfahren sind vor Ausführung auf Untergrund, Bauphysik und Dachsystem abzustimmen. Anschlüsse und Durchdringungen sind nicht enthalten. ' + EXCLUDE),
  item('07', 'EPS-Dämmung 160 mm', 'm²', 48, 'area', 'Liefern und verlegen druckbelastbarer EPS-Flachdachdämmplatten, Nenndicke 160 mm, WLS 035, einschließlich üblicher Zuschnitte und Verklebung mit systemgeeignetem Dämmstoffkleber im für den Testansatz angenommenen üblichen Umfang. Gefälledämmung und Sonderbefestigungen sind nicht enthalten. Eignung, Druckfestigkeit, Brandschutz, Windsogsicherung und erforderliche Dämmstärke sind projektbezogen zu prüfen; diese Testposition ersetzt keinen Nachweis. ' + EXCLUDE),
  item('08', 'Attikaabdeckung', 'm', 85, 'length', 'Liefern und montieren einer gekanteten Attikaabdeckung aus Aluminiumblech, Blechdicke 2,0 mm, Abwicklung bis 500 mm, einschließlich üblicher Halter, Befestigungen und systemgerechter Stoßverbindungen auf vorhandener geeigneter Unterkonstruktion. Ecken, Sonderformteile sowie Herstellung oder Sanierung der Unterkonstruktion sind nicht enthalten. ' + EXCLUDE),
  item('09', 'Lüfter eindichten', 'Stück', 115, 'count', 'Vorhandenen geeigneten Dachlüfter bis DN 150 im Bereich einer bituminösen Dachabdichtung systemgerecht eindichten, einschließlich örtlicher Vorbereitung des Anschlussbereichs und erforderlicher Anschlussmaterialien. Lieferung oder Austausch des Lüfters sowie eine Sanierung des umgebenden Dachaufbaus sind nicht enthalten. Anschlussausbildung entsprechend vorhandenem Lüfter und Abdichtungssystem prüfen. ' + EXCLUDE),
  item('10', 'Dachablauf eindichten', 'Stück', 135, 'count', 'Vorhandenen geeigneten Dachablauf im Bereich einer bituminösen Dachabdichtung systemgerecht an die Flächenabdichtung anschließen, einschließlich örtlicher Vorbereitung und erforderlicher Anschlussmaterialien. Lieferung oder Austausch des Ablaufs, Rohranschlüsse und Sanierung des umgebenden Dachaufbaus sind nicht enthalten. Kompatibilität und Anschlussausbildung vor Ausführung prüfen. ' + EXCLUDE),
];

function item(nr, short, unit, price, source, text) {
  return {
    id: 'cat-seed-' + nr,
    nr,
    title: nr + '.' + short,
    short,
    text,
    unit,
    price,
    source,
    active: true,
    seeded: true,
  };
}

export function mergeSeed(existing) {
  const list = Array.isArray(existing) ? existing.map((x) => ({ ...x })) : [];
  if (list.some((x) => x.seeded || String(x.id || '').startsWith('cat-seed-'))) return list;
  return list.concat(SEEDS.map((s) => ({ ...s })));
}

export function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}
export function fmtQty(n, unit) {
  if (unit === 'Stück') return String(Math.round(Number(n) || 0));
  return fmtNum(round2(n));
}
export function fmtEUR(n) {
  return round2(n).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' EUR';
}
export function uid(prefix = 'id') {
  const n = (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  return prefix + '-' + n;
}
export function uniqueServices(list) {
  const seen = new Set();
  const out = [];
  for (const s of list || []) {
    const id = s && s.catalogId;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ catalogId: id });
  }
  return out;
}
function byId(catalog) {
  return new Map((catalog || []).map((c) => [c.id, c]));
}
export function serviceIds(obj) {
  return uniqueServices(obj?.services).map((s) => s.catalogId);
}

export function dimensionCaption(edge, catalog) {
  if (!edge?.labelMode) return '';
  const map = byId(catalog);
  const measure = edge.measure && edge.measure.source !== 'derived' && isFinite(+edge.measure.value)
    ? `${fmtNum(edge.measure.value)} ${edge.measure.unit || 'm'}` : '';
  const letter = edge.label || '';
  const part = cleanPartName(edge.name);
  const shorts = (edge.serviceLabels || []).length ? edge.serviceLabels : serviceIds(edge).map((id) => map.get(id)?.short).filter(Boolean);
  const mode = edge.labelMode;
  if (mode === 'letter') return [letter, measure].filter(Boolean).join(' ');
  if (mode === 'part') return [part || letter, measure].filter(Boolean).join(' · ');
  if (mode === 'short') return [shorts.join(', ') || part || letter, measure].filter(Boolean).join(' · ');
  if (mode === 'both') return [letter, part, measure].filter(Boolean).join(' · ');
  return '';
}

const AREA_KIND = {
  measured: 'Fläche aus eingegebenen Maßen',
  projection: 'Grundriss / Projektion',
  slope: 'geneigte Dachfläche',
};

function metersOf(edge) {
  if (!edge?.measure || edge.measure.source === 'derived' || !isFinite(+edge.measure.value)) return null;
  return toMeters(edge.measure.value, edge.measure.unit || 'm');
}

export function quantitiesFromDocs(docs, catalog) {
  const map = byId(catalog);
  const groups = new Map();
  const gaps = [];
  const add = (spec) => {
    const key = [spec.catalogId, spec.unit, spec.basis, spec.areaKind || ''].join('|');
    if (!groups.has(key)) {
      const cat = map.get(spec.catalogId);
      groups.set(key, {
        key, catalogId: spec.catalogId, unit: spec.unit, basis: spec.basis, areaKind: spec.areaKind || '',
        title: cat?.title || spec.catalogId, short: cat?.short || '', entries: [],
      });
    }
    groups.get(key).entries.push(spec.entry);
  };
  for (const src of docs || []) {
    const doc = src.doc || {};
    const title = src.title || 'Skizze';
    for (const e of doc.edges || []) {
      const ids = serviceIds(e);
      if (!ids.length) continue;
      const len = metersOf(e);
      const part = cleanPartName(e.name);
      for (const id of ids) {
        const cat = map.get(id);
        if (!cat) { gaps.push({ catalogId: id, objectId: e.id, reason: 'missing-catalog' }); continue; }
        if (cat.unit === 'm') {
          if (len == null) { gaps.push({ catalogId: id, objectId: e.id, reason: 'length' }); continue; }
          add({ catalogId: id, unit: 'm', basis: 'length', entry: { label: `${part || 'Linie ' + e.label} (${title})`, value: round2(len), objectId: e.id, objectKind: 'line', partName: part, sourceId: src.id } });
        } else if (cat.unit === 'm²') {
          const width = e.widthM == null || e.widthM === '' ? null : toMeters(e.widthM, e.widthUnit || 'm');
          if (len == null || width == null || width <= 0) {
            gaps.push({ catalogId: id, objectId: e.id, reason: 'width', message: 'Für eine Quadratmeterleistung an einer Linie ist eine Breite nötig. Die Meterzahl wird nicht als Fläche verwendet.' });
            continue;
          }
          const area = round2(len * width);
          add({ catalogId: id, unit: 'm²', basis: 'area-width', entry: { label: `${part || 'Linie ' + e.label} (${title})`, value: area, detail: `${part || e.label} (${title}): ${fmtNum(len)} m × ${fmtNum(width)} m = ${fmtNum(area)} m²`, objectId: e.id, objectKind: 'line', partName: part, sourceId: src.id } });
        } else {
          gaps.push({ catalogId: id, objectId: e.id, reason: 'unit', message: 'Eine Linie liefert keine Stückzahl.' });
        }
      }
    }
    const faces = evaluateFaces(doc);
    const meta = doc.faceMeta || {};
    for (const f of faces) {
      const info = meta[f.sig];
      if (!info) continue;
      const ids = serviceIds(info);
      const kind = info.areaKind || 'measured';
      const part = cleanPartName(info.name);
      for (const id of ids) {
        const cat = map.get(id);
        if (!cat) continue;
        if (cat.unit !== 'm²') { gaps.push({ catalogId: id, objectId: f.sig, reason: 'unit' }); continue; }
        if (!f.ok || !isFinite(+f.ev?.area)) { gaps.push({ catalogId: id, objectId: f.sig, reason: 'area' }); continue; }
        const area = round2(f.ev.area);
        add({
          catalogId: id, unit: 'm²', basis: 'area', areaKind: kind,
          entry: { label: `${part || 'Fläche'} (${title}, ${AREA_KIND[kind] || kind})`, value: area, objectId: f.sig, objectKind: 'face', partName: part, sourceId: src.id, areaKind: kind },
        });
      }
    }
    for (const p of doc.pieces || []) {
      const ids = serviceIds(p);
      const part = cleanPartName(p.name);
      for (const id of ids) {
        const cat = map.get(id);
        if (!cat) continue;
        if (cat.unit !== 'Stück') { gaps.push({ catalogId: id, objectId: p.id, reason: 'unit' }); continue; }
        add({ catalogId: id, unit: 'Stück', basis: 'count', entry: { label: `${part || 'Stück'} (${title})`, value: 1, objectId: p.id, objectKind: 'piece', partName: part, sourceId: src.id } });
      }
    }
  }
  const out = [...groups.values()].map((g) => {
    const total = g.unit === 'Stück' ? g.entries.reduce((s, e) => s + e.value, 0) : round2(g.entries.reduce((s, e) => s + e.value, 0));
    const bits = g.entries.map((e) => e.detail || `${e.label}: ${fmtQty(e.value, g.unit)} ${g.unit === 'Stück' ? '' : g.unit}`.replace(/\s+$/, ''));
    const kind = g.areaKind ? ` · ${AREA_KIND[g.areaKind] || g.areaKind}` : '';
    const formula = `${g.title}${kind}: ${bits.join(' + ')} = ${fmtQty(total, g.unit)} ${g.unit}`;
    return { ...g, total, formula };
  });
  return { groups: out, gaps };
}

export function syncServiceRows(rows, groups) {
  const manual = (rows || []).filter((r) => !r.catalogId);
  const prev = (rows || []).filter((r) => r.catalogId);
  const next = [];
  for (const g of groups) {
    const old = prev.find((r) => r.serviceKey === g.key);
    next.push({
      ...(old || { id: 'svc-' + g.key, order: Date.now(), pos: '' }),
      catalogId: g.catalogId,
      serviceKey: g.key,
      bez: g.title,
      short: g.short,
      menge: g.total,
      einheit: g.unit,
      expr: fmtQty(g.total, g.unit),
      formula: g.formula,
      sources: g.entries,
      basis: g.basis,
      areaKind: g.areaKind,
      entfallen: false,
      fromService: true,
      manual: false,
    });
  }
  for (const old of prev) {
    if (groups.some((g) => g.key === old.serviceKey)) continue;
    next.push({ ...old, menge: 0, entfallen: true, expr: '0', formula: `${old.bez || 'Leistung'}: entfallen, keine zugeordnete Menge mehr`, sources: [] });
  }
  return [...manual, ...next];
}

export function blankOffer(projectId, id) {
  return {
    id: id || uid('off'),
    projectId,
    status: 'draft',
    vatRate: 19,
    singleRate: true,
    header: { firma: '', kunde: '', anschrift: '', nummer: '', datum: '', betreff: '', intro: '', outro: '', gueltig: '' },
    items: [],
    snapshot: null,
  };
}
export function effectiveQty(item) {
  if (!item) return 0;
  if (item.qtyMode === 'manual') return item.manualQty == null || item.manualQty === '' ? 0 : +item.manualQty;
  return +item.linkedQty || 0;
}
export function lineNet(item) {
  return round2(effectiveQty(item) * (+item.price || 0));
}
export function totals(offer) {
  const rate = offer?.vatRate == null ? 19 : +offer.vatRate;
  const net = round2((offer?.items || []).filter((i) => i.state === 'included').reduce((s, i) => s + lineNet(i), 0));
  const vat = round2(net * rate / 100);
  return { net, vat, gross: round2(net + vat), rate };
}
function clone(v) { return JSON.parse(JSON.stringify(v)); }

export function refreshOffer(offer, groups, catalog) {
  const base = clone(offer);
  if (base.status === 'final') return { offer: base, changes: [] };
  const map = byId(catalog);
  const items = base.items;
  const changes = [];
  const seen = new Set();
  for (const g of groups) {
    if (!g.total) continue;
    seen.add(g.key);
    let item = items.find((i) => i.serviceKey === g.key);
    const cat = map.get(g.catalogId);
    if (!item) {
      items.push({
        id: uid('oi'), serviceKey: g.key, catalogId: g.catalogId, state: 'suggested',
        short: cat?.short || g.short, text: cat?.text || '', title: cat?.title || g.title,
        unit: g.unit, price: cat?.price || 0, customized: {}, qtyMode: 'linked', manualQty: null,
        linkedQty: g.total, sources: g.entries, formula: g.formula, order: items.length,
      });
      changes.push(`${cat?.title || g.title}: neu ${fmtQty(g.total, g.unit)} ${g.unit}`);
    } else {
      const prev = item.linkedQty;
      item.linkedQty = g.total;
      item.sources = g.entries;
      item.formula = g.formula;
      item.unit = g.unit;
      if (item.state === 'dropped') item.state = 'suggested';
      if (item.qtyMode !== 'manual' && prev != null && Math.abs(+prev - g.total) >= 0.001) {
        changes.push(`${item.title || item.short}: ${fmtQty(prev, item.unit)} ${item.unit} → ${fmtQty(g.total, g.unit)} ${g.unit}`);
      }
    }
  }
  for (const item of items) {
    if (!item.serviceKey || seen.has(item.serviceKey)) continue;
    if (item.state === 'excluded') { item.linkedQty = 0; item.sources = []; continue; }
    if (item.linkedQty) changes.push(`${item.title || item.short}: Menge entfallen`);
    item.linkedQty = 0;
    item.sources = [];
    item.state = 'dropped';
  }
  return { offer: base, changes };
}
export function includeSuggested(offer) {
  const next = clone(offer);
  next.items.forEach((i) => { if (i.state === 'suggested') i.state = 'included'; });
  return next;
}
export function setItemState(offer, itemId, state) {
  const next = clone(offer);
  const item = next.items.find((i) => i.id === itemId);
  if (item) item.state = state;
  return next;
}
export function patchItem(offer, itemId, patch) {
  const next = clone(offer);
  const item = next.items.find((i) => i.id === itemId);
  if (!item) return next;
  item.customized = { ...(item.customized || {}) };
  if ('short' in patch) { item.short = patch.short; item.customized.short = true; }
  if ('text' in patch) { item.text = patch.text; item.customized.text = true; }
  if ('price' in patch) { item.price = +patch.price; item.customized.price = true; }
  return next;
}
export function adoptCatalog(offer, itemId, catalog) {
  const next = clone(offer);
  const item = next.items.find((i) => i.id === itemId);
  const cat = (catalog || []).find((c) => c.id === item?.catalogId);
  if (!item || !cat) return next;
  item.short = cat.short; item.text = cat.text; item.price = cat.price; item.title = cat.title; item.customized = {};
  return next;
}
export function writeBackCatalog(catalog, item) {
  return (catalog || []).map((c) => c.id === item.catalogId ? { ...c, short: item.short, text: item.text, price: +item.price, title: c.nr ? `${c.nr}.${item.short}` : c.title } : c);
}
export function setManualQty(offer, itemId, qty) {
  const next = clone(offer);
  const item = next.items.find((i) => i.id === itemId);
  if (!item) return next;
  item.qtyMode = 'manual';
  item.manualQty = qty;
  return next;
}
export function addManualItem(offer, partial = {}) {
  const next = clone(offer);
  next.items.push({
    id: uid('oi'), serviceKey: null, catalogId: null, state: 'included',
    short: partial.short || 'Manuelle Position', text: partial.text || '', title: partial.short || 'Manuelle Position',
    unit: partial.unit || 'psch', price: partial.price || 0, customized: { short: true, text: true, price: true },
    qtyMode: 'manual', manualQty: partial.qty ?? 1, linkedQty: null, sources: [], formula: '', order: next.items.length,
  });
  return next;
}
export function moveItem(offer, itemId, dir) {
  const next = clone(offer);
  const items = [...next.items].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const i = items.findIndex((x) => x.id === itemId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= items.length) return next;
  const ids = items.map((x) => x.id);
  [ids[i], ids[j]] = [ids[j], ids[i]];
  next.items.forEach((it) => { it.order = ids.indexOf(it.id); });
  return next;
}
export function finalizeOffer(offer, at = new Date().toISOString()) {
  const next = clone(offer);
  const sum = totals(next);
  next.status = 'final';
  next.snapshot = {
    at, vatRate: next.vatRate, singleRate: true, header: next.header,
    items: next.items.filter((i) => i.state === 'included').map((i) => ({ ...i, qty: effectiveQty(i), net: lineNet(i) })),
    net: sum.net, vat: sum.vat, gross: sum.gross,
  };
  return next;
}
export function reviseOffer(offer) {
  const next = clone(offer);
  next.id = uid('off');
  next.status = 'draft';
  next.parentId = offer.id;
  next.snapshot = null;
  return next;
}
export function uncheckedTestPrices(offer, catalog = SEEDS) {
  const seeds = new Map(SEEDS.map((s) => [s.id, s]));
  return (offer?.items || []).filter((i) => i.state === 'included' && seeds.has(i.catalogId) && Number(i.price) === Number(seeds.get(i.catalogId).price)).map((i) => i.title || i.short);
}
