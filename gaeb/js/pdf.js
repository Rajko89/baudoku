// A4-PDF eines Leistungsverzeichnisses. Keine festen Namen.

const M = 12;
const W = 210;
const H = 297;
const UNTEN = 16;
const SPALTEN = [
  ['oz', 22],
  ['text', 88],
  ['menge', 20],
  ['einheit', 14],
  ['ep', 20],
  ['gp', 22],
];

export function euroText(wert) {
  const n = Number(wert);
  if (!Number.isFinite(n)) return '';
  const neg = n < 0;
  const a = Math.abs(Math.round((n + Number.EPSILON) * 100));
  const cent = String(a % 100).padStart(2, '0');
  const ganz = String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${neg ? '-' : ''}${ganz},${cent}`;
}

export function zeilenBetrag(p) {
  const gp = p.gp == null || p.gp === '' ? null : Number(p.gp);
  if (Number.isFinite(gp)) return gp;
  if (p.positionsart === 'Bedarf') return null;
  const ep = p.ep == null || p.ep === '' ? null : Number(p.ep);
  const menge = p.menge == null || p.menge === '' ? null : Number(p.menge);
  if (!Number.isFinite(ep) || !Number.isFinite(menge)) return null;
  return Math.round((ep * menge + Number.EPSILON) * 100) / 100;
}

export function baueLvPdf(modell, optionen = {}) {
  const { jsPDF } = globalThis.jspdf || {};
  if (!jsPDF) throw new Error('PDF-Bibliothek ist nicht geladen.');
  const mitLangtext = optionen.mitLangtext !== false;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  doc.setProperties({ title: modell.kopf?.lvBez || 'Leistungsverzeichnis', creator: 'GAEB-Umwandler' });
  const kopf = modell.kopf || {};
  let y = 0;

  const seitenkopf = () => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(70);
    const links = [kopf.lvBez || 'Leistungsverzeichnis', kopf.phase ? `Phase ${kopf.phase}` : ''].filter(Boolean).join(' · ');
    doc.text(links.slice(0, 90), M, 8);
    const rechts = [kopf.datum, kopf.waehrung].filter(Boolean).join(' · ');
    if (rechts) doc.text(rechts, W - M, 8, { align: 'right' });
    doc.setDrawColor(180);
    doc.line(M, 10, W - M, 10);
    y = 16;
  };
  const neueSeite = () => { doc.addPage(); seitenkopf(); };
  const platz = (h) => { if (y + h > H - UNTEN) neueSeite(); };

  seitenkopf();
  doc.setTextColor(20);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  const titel = doc.splitTextToSize(kopf.lvBez || 'Leistungsverzeichnis', W - 2 * M);
  doc.text(titel, M, y);
  y += titel.length * 7;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const meta = [
    kopf.projekt && `Projekt: ${kopf.projekt}`,
    kopf.auftraggeber && `Auftraggeber: ${kopf.auftraggeber}`,
    kopf.datum && `Datum: ${kopf.datum}${kopf.uhrzeit ? ` ${kopf.uhrzeit}` : ''}`,
    (kopf.waehrung || kopf.waeBez) && `Währung: ${[kopf.waehrung, kopf.waeBez].filter(Boolean).join(' ')}`,
    kopf.phase && `Phase: ${kopf.phase}`,
  ].filter(Boolean);
  for (const zeile of meta) {
    const teile = doc.splitTextToSize(zeile, W - 2 * M);
    platz(teile.length * 5);
    doc.text(teile, M, y);
    y += teile.length * 5;
  }
  y += 2;
  const x = {};
  let lauf = M;
  for (const [name, breite] of SPALTEN) { x[name] = lauf; lauf += breite; }

  const kopfzeile = () => {
    platz(8);
    doc.setFillColor(15, 110, 86);
    doc.rect(M, y, W - 2 * M, 6, 'F');
    doc.setTextColor(255);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    const namen = { oz: 'OZ', text: 'Text', menge: 'Menge', einheit: 'Einheit', ep: 'EP', gp: 'GP' };
    for (const [name, breite] of SPALTEN) doc.text(namen[name], x[name] + 1, y + 4);
    doc.setTextColor(20);
    y += 8;
  };
  kopfzeile();

  let gesamt = 0;
  let hatPreis = false;
  for (const g of modell.lv || []) {
    const positionen = g.positionen || [];
    let summe = 0;
    let gruppeHat = false;
    for (const p of positionen) {
      const b = zeilenBetrag(p);
      if (b != null) { summe += b; gruppeHat = true; hatPreis = true; gesamt += b; }
    }
    const titelText = `${g.oz || ''}  ${g.titel || ''}`.trim();
    const titelZeilen = doc.splitTextToSize(titelText, W - 2 * M - (gruppeHat ? 28 : 0));
    platz(6 + titelZeilen.length * 4);
    doc.setFillColor(232, 244, 239);
    doc.rect(M, y - 3, W - 2 * M, titelZeilen.length * 4 + 3, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(titelZeilen, M + 1, y);
    if (gruppeHat) doc.text(euroText(summe), W - M - 1, y, { align: 'right' });
    y += titelZeilen.length * 4 + 2;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    for (const p of positionen) {
      const text = [p.kurztext || '', mitLangtext && p.langtext ? p.langtext : ''].filter(Boolean).join('\n');
      const zeilen = doc.splitTextToSize(text || ' ', SPALTEN[1][1] - 2);
      const block = Math.max(zeilen.length, 1) * 3.6 + 1.5;
      if (y + Math.min(block, 12) > H - UNTEN) { neueSeite(); kopfzeile(); }
      const start = y;
      doc.text(String(p.oz || ''), x.oz + 1, start);
      doc.text(zeilen, x.text + 1, start);
      const menge = p.menge == null || p.menge === '' ? '' : String(p.menge).replace('.', ',');
      doc.text(menge, x.menge + SPALTEN[2][1] - 1, start, { align: 'right' });
      doc.text(String(p.einheit || ''), x.einheit + 1, start);
      doc.text(p.ep == null || p.ep === '' ? '' : euroText(p.ep), x.ep + SPALTEN[4][1] - 1, start, { align: 'right' });
      const betrag = zeilenBetrag(p);
      doc.text(betrag == null ? '' : euroText(betrag), x.gp + SPALTEN[5][1] - 1, start, { align: 'right' });
      y = start + block;
      doc.setDrawColor(220);
      doc.line(M, y - 1, W - M, y - 1);
    }
  }
  if (hatPreis) {
    platz(10);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('Gesamtsumme', M, y + 4);
    doc.text(euroText(gesamt), W - M, y + 4, { align: 'right' });
  }
  const seiten = doc.getNumberOfPages();
  for (let i = 1; i <= seiten; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(90);
    doc.text(`${i} / ${seiten}`, W / 2, H - 8, { align: 'center' });
  }
  return doc.output('arraybuffer');
}
