// PDF-Export (jsPDF, lokal gebündelt)
import { fmtDate, fmtDateTime, fmtNum, fmtCoord, loadImg } from './util.js';
import { drawToCanvas } from './media.js';
import { renderAnnotated, fmtVal } from './measure.js';
import { measureValue, realMapper } from './geom.js';
import { renderSketch } from './sketch.js';
import { computeFace, formatCalcText, scaleWarning } from './sketch-calc.js';

const M = 15, PW = 210, PH = 297, CW = PW - 2 * M;
const ACC = [232, 89, 12], DARK = [31, 41, 51], GREY = [91, 102, 114];

async function jpeg(blob, max = 1600, q = 0.82) {
  const img = await loadImg(blob); try { const c = drawToCanvas(img, max); return { data: c.toDataURL('image/jpeg', q), w: c.width, h: c.height }; } finally { URL.revokeObjectURL(img._url); }
}

export async function buildPdf({ project, photos, notes, aufmass, sketches = [], settings, opts, progress = () => { } }) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  doc.setProperties({ title: `Baudokumentation ${project.name}`, author: settings.bearbeiter || '', creator: 'Baudoku' });
  const photoNo = new Map(photos.map((p, i) => [p.id, i + 1]));
  let y = M;
  const newPage = () => { doc.addPage(); y = M; };
  const need = h => { if (y + h > PH - 18) newPage(); };
  const h1 = t => { need(16); doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(...DARK); doc.text(t, M, y + 6); doc.setDrawColor(...ACC); doc.setLineWidth(0.8); doc.line(M, y + 9, M + CW, y + 9); y += 15; };
  const txt = (t, size = 10, style = 'normal', color = [20, 24, 29]) => {
    doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(...color);
    const lines = doc.splitTextToSize(String(t ?? ''), CW); const lh = size * 0.42;
    lines.forEach(l => { need(lh + 1); doc.text(l, M, y + lh); y += lh; }); y += 1.5;
  };

  /* Deckblatt */
  doc.setFillColor(...DARK); doc.rect(0, 0, PW, 52, 'F');
  doc.setFillColor(...ACC); doc.rect(0, 52, PW, 2.5, 'F');
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'normal'); doc.setFontSize(11);
  doc.text(settings.firma || '', M, 18);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(26); doc.text('Baudokumentation', M, 34);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(12); doc.text(opts.includeAufmass ? 'Fotodokumentation · Notizen · Aufmaß' : 'Fotodokumentation · Notizen', M, 44);
  y = 68;
  doc.setTextColor(...DARK); doc.setFont('helvetica', 'bold'); doc.setFontSize(18);
  doc.splitTextToSize(project.name || 'Projekt', CW).forEach(l => { doc.text(l, M, y); y += 8; }); y += 4;
  const fields = [['Kunde', project.kunde], ['Adresse', project.adresse], ['Bauvorhaben-Nr.', project.bvnr], ['Datum', fmtDate(project.datum)], ['Bearbeiter', settings.bearbeiter], ['Erstellt am', fmtDateTime(Date.now())],
    ['Umfang', `${photos.length} Fotos · ${notes.length} Notizen · ${aufmass.length} Aufmaß-Positionen · ${sketches.length} Skizzen`]];
  doc.setFontSize(11);
  fields.forEach(([k, v]) => {
    if (!v) return; doc.setFont('helvetica', 'bold'); doc.setTextColor(...GREY); doc.text(k, M, y);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(20, 24, 29); const l = doc.splitTextToSize(String(v), CW - 45); doc.text(l, M + 45, y); y += 6.5 * l.length;
    doc.setDrawColor(225, 228, 232); doc.setLineWidth(0.2); doc.line(M, y - 4.3, M + CW, y - 4.3);
  });
  if (project.notiz) { y += 4; txt('Projektnotiz', 11, 'bold', GREY); txt(project.notiz, 10.5); }
  const cover = photos.find(p => p.id === project.coverPhotoId) || photos[0];
  if (cover && opts.includePhotos) {
    const j = await jpeg(cover.stamped || cover.original, 1400);
    const maxH = PH - 25 - y - 6; if (maxH > 50) { let w = CW, h = w * j.h / j.w; if (h > maxH) { h = maxH; w = h * j.w / j.h; } doc.addImage(j.data, 'JPEG', M + (CW - w) / 2, y + 6, w, h); }
  }

  /* Fotos: 2 pro Seite */
  if (opts.includePhotos && photos.length) {
    newPage(); h1('Fotodokumentation');
    const slotH = (PH - 18 - y) / 2 - 2;
    for (let i = 0; i < photos.length; i++) {
      const p = photos[i]; progress(`Foto ${i + 1}/${photos.length}`);
      const meta = [`Nr. ${i + 1}`, fmtDateTime(p.time, true), p.lat != null ? `GPS ${fmtCoord(p.lat, p.lon)}${p.acc != null ? ` (±${fmtNum(p.acc, 0)} m)` : ''}` : 'GPS: –', p.address].filter(Boolean).join('  ·  ');
      doc.setFontSize(9); const metaL = doc.splitTextToSize(meta, CW);
      doc.setFontSize(10.5); const capL = p.caption ? doc.splitTextToSize(p.caption, CW) : [];
      const textH = metaL.length * 3.9 + capL.length * 4.6 + 3;
      if (y + slotH > PH - 16) { newPage(); }
      const j = await jpeg(opts.stamped ? (p.stamped || p.original) : p.original, 1600);
      const imgMaxH = slotH - textH; let w = CW, h = w * j.h / j.w; if (h > imgMaxH) { h = imgMaxH; w = h * j.w / j.h; }
      doc.addImage(j.data, 'JPEG', M + (CW - w) / 2, y, w, h); doc.setDrawColor(200); doc.setLineWidth(0.2); doc.rect(M + (CW - w) / 2, y, w, h);
      let ty = y + h + 4.5;
      if (capL.length) { doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(20, 24, 29); capL.forEach(l => { doc.text(l, M, ty); ty += 4.6; }); }
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...GREY); metaL.forEach(l => { doc.text(l, M, ty); ty += 3.9; });
      y += slotH + 4;
    }
  }

  /* Notizen */
  if (opts.includeNotes && notes.length) {
    newPage(); h1('Notizen');
    [...notes].sort((a, b) => a.created - b.created).forEach(n => {
      need(14);
      const ref = n.photoId && photoNo.has(n.photoId) ? `  ·  zu Foto Nr. ${photoNo.get(n.photoId)}` : '';
      txt(fmtDateTime(n.created) + ref, 9.5, 'bold', GREY); txt(n.text, 10.5); y += 2.5;
      doc.setDrawColor(225, 228, 232); doc.setLineWidth(0.2); doc.line(M, y - 2, M + CW, y - 2);
    });
  }

  /* Aufmaß-Tabelle */
  if (opts.includeAufmass && aufmass.length) {
    newPage(); h1('Aufmaß');
    const C = [{ k: 'pos', t: 'Pos.', w: 16 }, { k: 'bez', t: 'Bezeichnung', w: 88 }, { k: 'menge', t: 'Menge', w: 28, r: true }, { k: 'einheit', t: 'Einheit', w: 16 }, { k: 'src', t: 'Quelle / Ansatz', w: CW - 148 }];
    const head = () => { doc.setFillColor(...DARK); doc.rect(M, y, CW, 8, 'F'); doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); let x = M; C.forEach(c => { doc.text(c.t, c.r ? x + c.w - 2 : x + 2, y + 5.4, { align: c.r ? 'right' : 'left' }); x += c.w; }); y += 8; };
    head();
    aufmass.forEach((r, i) => {
      const srcBits = [];
      if (r.photoId && photoNo.has(r.photoId)) srcBits.push(`Foto ${photoNo.get(r.photoId)}`);
      if (r.calc?.faceLabel) srcBits.push(r.calc.faceLabel);
      if (!srcBits.length && r.expr && parseFloat(String(r.expr).replace(',', '.')) !== +r.menge) srcBits.push(r.expr);
      const vals = { pos: r.pos || String(i + 1), bez: r.bez || '', menge: isFinite(r.menge) && r.menge !== null && r.menge !== '' ? fmtNum(+r.menge, 2) : '', einheit: r.einheit || '', src: srcBits.join(' · ') };
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
      const bl = doc.splitTextToSize(vals.bez, C[1].w - 4); const sl = doc.splitTextToSize(vals.src, C[4].w - 3); const rh = Math.max(bl.length, sl.length, 1) * 4.2 + 3;
      if (y + rh > PH - 18) { newPage(); head(); doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); }
      if (i % 2) { doc.setFillColor(243, 245, 247); doc.rect(M, y, CW, rh, 'F'); }
      doc.setTextColor(20, 24, 29); let x = M;
      C.forEach(c => { const v = c.k === 'bez' ? bl : c.k === 'src' ? sl : [vals[c.k]]; doc.text(v, c.r ? x + c.w - 2 : x + 2, y + 5, { align: c.r ? 'right' : 'left' }); x += c.w; });
      y += rh;
    });
    y += 2; txt('Positionen werden nicht pauschal addiert. Eine Gesamtfläche steht nur dort, wo sie ausdrücklich aus zusammengehörigen m²-Flächen gebildet wurde. Foto-Maße sind Schätzwerte.', 8.5, 'italic', GREY);
  }

  if (opts.includeSketches !== false && sketches.length) {
    const amById = new Map(aufmass.map(r => [r.id, r]));
    for (const sk of sketches) {
      progress(`Skizze ${sk.title || ''}`);
      newPage(); h1(`Skizze${sk.title ? ': ' + sk.title : ''}`);
      if (sk.sourceImage) {
        const img = await loadImg(sk.sourceImage);
        try {
          const c = renderSketch(img, sk, amById, 1600);
          const data = c.toDataURL('image/jpeg', 0.86);
          const maxH = 120;
          let w = CW, h = w * c.height / c.width; if (h > maxH) { h = maxH; w = h * c.width / c.height; }
          doc.addImage(data, 'JPEG', M + (CW - w) / 2, y, w, h); y += h + 4;
        } finally { URL.revokeObjectURL(img._url); }
      }
      txt(scaleWarning(sk), 8.5, 'italic', GREY);
      for (const face of sk.faces || []) {
        const calc = computeFace(sk, face, amById);
        const pos = aufmass.find(r => r.id === face.aufmassId)?.pos || '';
        const name = `${face.isDeduction ? 'Abzug' : 'Dachfläche'} ${face.label}`;
        formatCalcText({ pos, name, calc }).split('\n').forEach(line => txt(line, 10));
        y += 1.5;
      }
    }
  }

  /* Aufmaß-Bilder */
  if (opts.includeMeasureImgs) {
    const withM = photos.filter(p => p.measure && p.measure.items && p.measure.items.length);
    for (const p of withM) {
      progress(`Aufmaßbild Foto ${photoNo.get(p.id)}`);
      newPage(); h1(`Aufmaß – Foto Nr. ${photoNo.get(p.id)}${p.caption ? ': ' + p.caption : ''}`.slice(0, 90));
      const img = await loadImg(p.original);
      let data, cw, ch;
      try { const c = renderAnnotated(img, p.measure, 1800); data = c.toDataURL('image/jpeg', 0.85); cw = c.width; ch = c.height; } finally { URL.revokeObjectURL(img._url); }
      const m = p.measure; const mp = realMapper(m);
      const lines = m.items.length + 2; const maxH = PH - 20 - y - lines * 5.2 - 6;
      let w = CW, h = w * ch / cw; if (h > maxH) { h = maxH; w = h * cw / ch; }
      doc.addImage(data, 'JPEG', M + (CW - w) / 2, y, w, h); y += h + 6;
      const cal = m.mode === 'persp' && m.persp ? `Kalibrierung: Perspektive (Referenzrechteck ${fmtNum(m.persp.w, 2)} × ${fmtNum(m.persp.h, 2)} m)` : m.mode === 'scale' && m.scale ? `Kalibrierung: Maßstab (Referenzstrecke ${fmtNum(m.scale.len, 2)} m)` : 'Nicht kalibriert';
      txt(cal + (m.pitch ? ` · Dachneigung ${fmtNum(m.pitch, 1)}°` : ''), 9, 'normal', GREY);
      m.items.forEach(it => { const v = measureValue(m, it, mp); txt(`${it.name}: ${fmtVal(v)}${it.usePitch && m.pitch ? ' (neigungskorrigiert)' : ''}${v && v.perim ? ` · Umfang ${fmtNum(v.perim, 2)} m` : ''}`, 10); });
    }
  }

  /* Fußzeilen */
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...GREY);
    doc.setDrawColor(210); doc.setLineWidth(0.2); doc.line(M, PH - 11, PW - M, PH - 11);
    doc.text(`${project.name}${project.bvnr ? ' · BV ' + project.bvnr : ''}${settings.firma ? ' · ' + settings.firma : ''}`.slice(0, 110), M, PH - 7);
    doc.text(`Seite ${i} von ${n}`, PW - M, PH - 7, { align: 'right' });
  }
  return doc.output('blob');
}
