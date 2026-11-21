// Minimaler EXIF-Leser (JPEG): Aufnahmezeit + GPS, für Bilder aus der Galerie
export async function readExif(file) {
  try {
    const buf = await file.slice(0, 512 * 1024).arrayBuffer();
    const v = new DataView(buf);
    if (v.getUint16(0) !== 0xFFD8) return null;
    let off = 2;
    while (off < v.byteLength - 4) {
      const marker = v.getUint16(off);
      if ((marker & 0xFF00) !== 0xFF00) break;
      const len = v.getUint16(off + 2);
      if (marker === 0xFFE1 && v.getUint32(off + 4) === 0x45786966) return parseTiff(v, off + 10);
      off += 2 + len;
    }
  } catch (e) { /* ignore */ }
  return null;
}
function parseTiff(v, t) {
  const le = v.getUint16(t) === 0x4949;
  const g16 = o => v.getUint16(o, le), g32 = o => v.getUint32(o, le);
  const readIFD = o => { const n = g16(o), tags = {}; for (let i = 0; i < n; i++) { const e = o + 2 + i * 12; tags[g16(e)] = { type: g16(e + 2), count: g32(e + 4), vo: e + 8 }; } return tags; };
  const SZ = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
  const val = ({ type, count, vo }) => {
    const p = (SZ[type] || 1) * count > 4 ? t + g32(vo) : vo;
    if (type === 2) { let s = ''; for (let i = 0; i < count; i++) { const c = v.getUint8(p + i); if (!c) break; s += String.fromCharCode(c); } return s; }
    const out = [];
    for (let i = 0; i < count; i++) {
      if (type === 3) out.push(g16(p + i * 2));
      else if (type === 4) out.push(g32(p + i * 4));
      else if (type === 5) out.push(g32(p + i * 8) / g32(p + i * 8 + 4));
      else if (type === 10) out.push(v.getInt32(p + i * 8, le) / v.getInt32(p + i * 8 + 4, le));
      else out.push(v.getUint8(p + i));
    }
    return count === 1 ? out[0] : out;
  };
  const res = {};
  const i0 = readIFD(t + g32(t + 4));
  if (i0[0x8769]) { const ex = readIFD(t + val(i0[0x8769])); if (ex[0x9003]) res.dateTime = val(ex[0x9003]); }
  if (!res.dateTime && i0[0x0132]) res.dateTime = val(i0[0x0132]);
  if (i0[0x8825]) {
    const gp = readIFD(t + val(i0[0x8825]));
    if (gp[2] && gp[4]) {
      const la = val(gp[2]), lo = val(gp[4]);
      let lat = la[0] + la[1] / 60 + la[2] / 3600, lon = lo[0] + lo[1] / 60 + lo[2] / 3600;
      if (gp[1] && val(gp[1]) === 'S') lat = -lat;
      if (gp[3] && val(gp[3]) === 'W') lon = -lon;
      if (isFinite(lat) && isFinite(lon) && !(lat === 0 && lon === 0)) { res.lat = lat; res.lon = lon; }
      if (gp[0x1f]) { const a = val(gp[0x1f]); if (isFinite(a)) res.acc = a; }
    }
  }
  if (res.dateTime) {
    const m = res.dateTime.match(/(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/);
    if (m) res.time = new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
  }
  return res;
}
