// Datensicherung: Export/Import als ZIP (data.json + Bilder) oder JSON (ohne Bilder)
import * as db from './db.js';
import { uid } from './util.js';
const BLOBS = ['original', 'stamped', 'thumb'];
const ext = t => (t && t.includes('png') ? 'png' : t && t.includes('webp') ? 'webp' : 'jpg');

export async function exportZip(projectIds) {
  const zip = new window.JSZip();
  const out = { format: 'baudoku-backup', version: 3, exported: new Date().toISOString(), projects: [], photos: [], notes: [], aufmass: [], sketches: [], sheets: [] };
  for (const pid of projectIds) {
    const p = await db.get('projects', pid); if (!p) continue; out.projects.push(p);
    for (const ph of await db.byProject('photos', pid)) {
      const meta = { ...ph };
      for (const k of BLOBS) if (ph[k]) { const name = `photos/${ph.id}_${k}.${ext(ph[k].type)}`; zip.file(name, ph[k]); meta[k] = { file: name, type: ph[k].type }; } else delete meta[k];
      out.photos.push(meta);
    }
    out.notes.push(...await db.byProject('notes', pid));
    out.aufmass.push(...await db.byProject('aufmass', pid));
    for (const sk of await db.byProject('sketches', pid)) {
      const meta = { ...sk };
      if (sk.sourceImage) { const name = `sketches/${sk.id}_source.${ext(sk.sourceImage.type)}`; zip.file(name, sk.sourceImage); meta.sourceImage = { file: name, type: sk.sourceImage.type }; }
      out.sketches.push(meta);
    }
    out.sheets.push(...await db.byProject('sheets', pid));
  }
  zip.file('data.json', JSON.stringify(out, null, 1));
  return zip.generateAsync({ type: 'blob', compression: 'STORE', mimeType: 'application/zip' });
}

export async function importFile(file) {
  let data, zip = null;
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  if (head[0] === 0x50 && head[1] === 0x4b) { zip = await window.JSZip.loadAsync(file); const f = zip.file('data.json'); if (!f) throw new Error('data.json fehlt im ZIP'); data = JSON.parse(await f.async('string')); }
  else data = JSON.parse(await file.text());
  if (data.format !== 'baudoku-backup') throw new Error('Keine Baudoku-Sicherung');
  let n = 0;
  for (const p of data.projects) {
    const exists = await db.get('projects', p.id);
    const map = new Map(); const nid = id => { if (!id) return id; if (!exists) return id; if (!map.has(id)) map.set(id, uid()); return map.get(id); };
    const proj = { ...p, id: nid(p.id) }; if (exists) proj.name = p.name + ' (Import)';
    for (const ph of data.photos.filter(x => x.projectId === p.id)) {
      const rec = { ...ph, id: nid(ph.id), projectId: proj.id };
      for (const k of BLOBS) if (ph[k] && ph[k].file) { const f = zip && zip.file(ph[k].file); rec[k] = f ? new Blob([await f.async('arraybuffer')], { type: ph[k].type || 'image/jpeg' }) : null; }
      if (!rec.original) continue;
      if (!rec.stamped) rec.stamped = rec.original; if (!rec.thumb) rec.thumb = rec.stamped;
      if (rec.measure?.items) rec.measure.items = rec.measure.items.map(it => ({ ...it, aufmassId: it.aufmassId ? nid(it.aufmassId) : null }));
      await db.put('photos', rec);
    }
    for (const nt of data.notes.filter(x => x.projectId === p.id)) await db.put('notes', { ...nt, id: nid(nt.id), projectId: proj.id, photoId: nid(nt.photoId) || null });
    for (const r of data.aufmass.filter(x => x.projectId === p.id)) await db.put('aufmass', { ...r, id: nid(r.id), projectId: proj.id, photoId: nid(r.photoId) || null, sketchId: r.sketchId ? nid(r.sketchId) : null });
    for (const sk of (data.sketches || []).filter(x => x.projectId === p.id)) {
      const rec = { ...sk, id: nid(sk.id), projectId: proj.id };
      if (sk.sourceImage && sk.sourceImage.file) { const f = zip && zip.file(sk.sourceImage.file); rec.sourceImage = f ? new Blob([await f.async('arraybuffer')], { type: sk.sourceImage.type || 'image/jpeg' }) : null; }
      rec.edges = (rec.edges || []).map(e => ({ ...e, aufmassId: e.aufmassId ? nid(e.aufmassId) : null }));
      rec.faces = (rec.faces || []).map(f => ({ ...f, aufmassId: f.aufmassId ? nid(f.aufmassId) : null }));
      await db.put('sketches', rec);
    }
    for (const sh of (data.sheets || []).filter(x => x.projectId === p.id)) await db.put('sheets', { ...sh, id: nid(sh.id), projectId: proj.id });
    if (proj.coverPhotoId) proj.coverPhotoId = nid(proj.coverPhotoId);
    await db.put('projects', proj); n++;
  }
  return n;
}
