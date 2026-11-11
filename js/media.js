// GPS, Reverse-Geocoding, Zeit-/Ortsstempel, Live-Kamera
import { fmtDateTime, fmtCoord, fmtNum, loadImg, canvasToBlob, esc, toast } from './util.js';

/* ---------- GPS ---------- */
let last = null, watchId = null, lastErr = '';
const listeners = new Set();
export const geoState = () => ({ fix: last, err: lastErr, supported: 'geolocation' in navigator });
export function onGeo(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function setFix(p) { last = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, alt: p.coords.altitude, t: p.timestamp || Date.now() }; lastErr = ''; listeners.forEach(f => f()); }
function setErr(e) { lastErr = e && e.code === 1 ? 'Standortzugriff verweigert' : (e && e.message) || 'GPS nicht verfügbar'; listeners.forEach(f => f()); }
export function startGeo() {
  if (!navigator.geolocation || watchId !== null) return;
  try { watchId = navigator.geolocation.watchPosition(setFix, setErr, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 }); } catch (e) { setErr(e); }
}
export function stopGeo() { if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; } }
/** aktuelle Position (max. maxAge ms alt) – wartet max. ~8 s */
export function getFix(maxAge = 60000) {
  if (last && Date.now() - last.t < maxAge) return Promise.resolve(last);
  return new Promise(res => {
    if (!navigator.geolocation) return res(null);
    let done = false; const fin = v => { if (!done) { done = true; res(v); } };
    setTimeout(() => fin(last && Date.now() - last.t < 600000 ? last : null), 9000);
    navigator.geolocation.getCurrentPosition(p => { setFix(p); fin(last); }, e => { setErr(e); fin(last && Date.now() - last.t < 600000 ? last : null); },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 });
  });
}

/* ---------- Reverse-Geocoding (OpenStreetMap Nominatim, nur online) ---------- */
const geoCache = new Map();
export async function reverseGeocode(lat, lon) {
  if (!navigator.onLine || lat == null) return '';
  const key = lat.toFixed(4) + ',' + lon.toFixed(4);
  if (geoCache.has(key)) return geoCache.get(key);
  try {
    const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 5000);
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1&accept-language=de`, { signal: ctl.signal, headers: { 'Accept': 'application/json' } });
    clearTimeout(to);
    if (!r.ok) return '';
    const j = await r.json(); const a = j.address || {};
    const street = [a.road || a.pedestrian || a.footway || a.path || '', a.house_number || ''].join(' ').trim();
    const city = [a.postcode || '', a.city || a.town || a.village || a.municipality || a.hamlet || ''].join(' ').trim();
    const s = [street, city].filter(Boolean).join(', ') || (j.display_name || '').split(',').slice(0, 3).join(',');
    geoCache.set(key, s); return s;
  } catch (e) { return ''; }
}

/* ---------- Bildverarbeitung ---------- */
function fitSize(w, h, max) { const k = Math.min(1, max / Math.max(w, h)); return [Math.round(w * k), Math.round(h * k)]; }
export function drawToCanvas(img, max) {
  const [w, h] = fitSize(img.naturalWidth || img.width, img.naturalHeight || img.height, max);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(img, 0, 0, w, h); return c;
}
export function stampLines(meta) {
  const lines = [];
  lines.push({ t: [meta.projectName, meta.firma].filter(Boolean).join('  ·  '), bold: true });
  lines.push({ t: 'Aufnahme: ' + fmtDateTime(meta.time, true) + (meta.source === 'gallery' ? ' (Bilddatum)' : '') });
  if (meta.lat != null) lines.push({ t: 'GPS: ' + fmtCoord(meta.lat, meta.lon) + (meta.acc != null ? `  (±${fmtNum(meta.acc, 0)} m)` : '') });
  else lines.push({ t: 'GPS: nicht verfügbar' });
  if (meta.address) lines.push({ t: meta.address });
  return lines;
}
/** Stempel ins Bild brennen */
export function drawStamp(ctx, w, h, meta) {
  const lines = stampLines(meta);
  const fs = Math.round(Math.max(13, Math.min(w, h * 1.4) * 0.024));
  const pad = Math.round(fs * 0.6), lh = Math.round(fs * 1.32);
  const bandH = lines.length * lh + pad * 2;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.58)'; ctx.fillRect(0, h - bandH, w, bandH);
  ctx.fillStyle = '#e8590c'; ctx.fillRect(0, h - bandH, Math.max(4, fs * 0.3), bandH);
  ctx.textBaseline = 'top'; ctx.fillStyle = '#fff';
  ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 2;
  lines.forEach((l, i) => {
    ctx.font = `${l.bold ? '700 ' : ''}${fs}px system-ui, -apple-system, Roboto, Arial, sans-serif`;
    let t = l.t; while (ctx.measureText(t).width > w - pad * 3 && t.length > 4) t = t.slice(0, -2);
    if (t !== l.t) t = t.slice(0, -1) + '…';
    ctx.fillText(t, pad * 1.6, h - bandH + pad + i * lh);
  });
  ctx.restore();
}
/** erzeugt gestempelte Version + Vorschaubild aus dem Original */
export async function processImage(originalBlob, meta) {
  const img = await loadImg(originalBlob);
  try {
    const c = drawToCanvas(img, 2560);
    drawStamp(c.getContext('2d'), c.width, c.height, meta);
    const stamped = await canvasToBlob(c, 'image/jpeg', 0.86);
    const t = drawToCanvas(c, 480);
    const thumb = await canvasToBlob(t, 'image/jpeg', 0.75);
    return { stamped, thumb, width: img.naturalWidth, height: img.naturalHeight };
  } finally { URL.revokeObjectURL(img._url); }
}

/* ---------- Live-Kamera (getUserMedia) ---------- */
export async function liveCamera(onShot) {
  if (!navigator.mediaDevices?.getUserMedia) { toast('Live-Kamera nicht verfügbar (HTTPS erforderlich?)'); return false; }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } }, audio: false });
  } catch (e) {
    toast(e.name === 'NotAllowedError' ? 'Kamerazugriff verweigert' : 'Kamera konnte nicht gestartet werden'); return false;
  }
  startGeo();
  const el = document.createElement('div'); el.className = 'cam';
  el.innerHTML = `<video playsinline autoplay muted></video><div class="info"><span class="gi">GPS …</span><span class="cnt">0 Fotos</span></div><div class="flash"></div>
    <div class="bar"><button class="btn sm" data-a="close" style="background:transparent;color:#fff;border-color:#fff">Fertig</button>
    <button class="shutter" data-a="shot" aria-label="Auslösen"></button><span style="width:90px"></span></div>`;
  document.body.appendChild(el);
  const video = el.querySelector('video'); video.srcObject = stream;
  let n = 0;
  const upd = () => { const g = geoState(); el.querySelector('.gi').textContent = g.fix ? `GPS ±${fmtNum(g.fix.acc, 0)} m` : (g.err || 'GPS wird gesucht …'); };
  const off = onGeo(upd); upd();
  return new Promise(resolve => {
    el.addEventListener('click', async e => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'close') { stream.getTracks().forEach(t => t.stop()); off(); el.remove(); resolve(true); }
      if (a === 'shot') {
        if (!video.videoWidth) return;
        const c = document.createElement('canvas'); c.width = video.videoWidth; c.height = video.videoHeight;
        c.getContext('2d').drawImage(video, 0, 0);
        const f = el.querySelector('.flash'); f.style.opacity = .8; setTimeout(() => f.style.opacity = 0, 120);
        const blob = await canvasToBlob(c, 'image/jpeg', 0.92);
        n++; el.querySelector('.cnt').textContent = `${n} Foto${n > 1 ? 's' : ''}`;
        onShot(blob);
      }
    });
  });
}
