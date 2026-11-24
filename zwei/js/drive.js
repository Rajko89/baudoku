// Google Drive appDataFolder. Die Dateien sind für die App unsichtbar im Drive des Nutzers
// und erscheinen nicht in seiner normalen Ablage. Die Client-ID kommt aus den Einstellungen.

const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const API = 'https://www.googleapis.com/drive/v3';
const INDEX = 'baudoku-index.json';

function loadScript() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Google-Anmeldung konnte nicht geladen werden'));
    document.head.appendChild(s);
  });
}

export async function requestAccessToken(clientId) {
  await loadScript();
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (resp) => {
        if (resp && resp.access_token) resolve(resp.access_token);
        else reject(new Error(resp?.error || 'Anmeldung abgebrochen'));
      },
    });
    client.requestAccessToken({ prompt: '' });
  });
}

export function revokeToken(token) {
  const google = window.google;
  if (token && google?.accounts?.oauth2?.revoke) google.accounts.oauth2.revoke(token);
}

function authHeaders(token, extra = {}) {
  return { Authorization: 'Bearer ' + token, ...extra };
}

async function bufToB64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function b64ToBlob(b64, type) {
  const bin = atob(b64 || '');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: type || 'application/octet-stream' });
}

async function encodeBundle(bundle) {
  const photos = [];
  for (const ph of bundle.photos || []) {
    const meta = { ...ph };
    for (const key of ['original', 'stamped', 'thumb']) {
      if (ph[key] instanceof Blob) meta[key] = { base64: await bufToB64(ph[key]), type: ph[key].type || 'image/jpeg' };
    }
    photos.push(meta);
  }
  const sketches = [];
  for (const sk of bundle.sketches || []) {
    const meta = { ...sk };
    if (sk.sourceImage instanceof Blob) meta.sourceImage = { base64: await bufToB64(sk.sourceImage), type: sk.sourceImage.type || 'image/jpeg' };
    sketches.push(meta);
  }
  return { ...bundle, photos, sketches };
}
function decodeBundle(raw) {
  const photos = (raw.photos || []).map((ph) => {
    const meta = { ...ph };
    for (const key of ['original', 'stamped', 'thumb']) {
      if (ph[key]?.base64) meta[key] = b64ToBlob(ph[key].base64, ph[key].type);
    }
    return meta;
  });
  const sketches = (raw.sketches || []).map((sk) => {
    const meta = { ...sk };
    if (sk.sourceImage?.base64) meta.sourceImage = b64ToBlob(sk.sourceImage.base64, sk.sourceImage.type);
    return meta;
  });
  return { ...raw, photos, sketches };
}

export function driveStore(token) {
  const headers = () => authHeaders(token);
  async function find(name) {
    const url = `${API}/files?spaces=appDataFolder&fields=files(id,name)&q=${encodeURIComponent(`name='${name}' and trashed=false`)}`;
    const res = await fetch(url, { headers: headers() });
    if (!res.ok) throw new Error('Drive-Liste fehlgeschlagen');
    const data = await res.json();
    return data.files?.[0] || null;
  }
  async function download(fileId) {
    const res = await fetch(`${API}/files/${fileId}?alt=media`, { headers: headers() });
    if (!res.ok) throw new Error('Drive-Datei fehlt');
    return res.json();
  }
  async function upload(name, obj, fileId) {
    const boundary = 'baudoku-' + Math.random().toString(36).slice(2);
    const meta = { name, mimeType: 'application/json' };
    if (!fileId) meta.parents = ['appDataFolder'];
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(obj)}\r\n--${boundary}--`;
    const url = fileId
      ? `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`
      : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
    const res = await fetch(url, { method: fileId ? 'PATCH' : 'POST', headers: authHeaders(token, { 'Content-Type': 'multipart/related; boundary=' + boundary }), body });
    if (!res.ok) throw new Error('Drive-Schreiben fehlgeschlagen');
    return res.json();
  }
  async function index() {
    const file = await find(INDEX);
    if (!file) return { fileId: null, projects: [] };
    const data = await download(file.id);
    return { fileId: file.id, projects: data.projects || [] };
  }
  async function saveIndex(fileId, projects) {
    const saved = await upload(INDEX, { projects }, fileId);
    return saved.id;
  }
  return {
    async snapshot() {
      const idx = await index();
      const projects = [];
      const tombstones = [];
      for (const row of idx.projects) {
        if (row.deletedAt && row.deletedAt >= (row.updatedAt || 0)) tombstones.push(row);
        else if (row.fileId) projects.push(decodeBundle(await download(row.fileId)));
      }
      return { projects, tombstones };
    },
    async write(bundle) {
      const idx = await index();
      const name = `baudoku-project-${bundle.project.id}.json`;
      const existing = idx.projects.find((p) => p.id === bundle.project.id);
      const file = await upload(name, await encodeBundle(bundle), existing?.fileId);
      const row = { id: bundle.project.id, name: bundle.project.name, updatedAt: bundle.project.updatedAt || bundle.project.updated || 0, deviceId: bundle.project.deviceId || '', deletedAt: 0, fileId: file.id };
      const projects = idx.projects.filter((p) => p.id !== row.id).concat(row);
      await saveIndex(idx.fileId, projects);
    },
    async tombstone(tomb) {
      const idx = await index();
      const prev = idx.projects.find((p) => p.id === tomb.id) || { id: tomb.id };
      const row = { ...prev, deletedAt: tomb.deletedAt, name: tomb.name || prev.name || '', deviceId: tomb.deviceId || '' };
      const projects = idx.projects.filter((p) => p.id !== tomb.id).concat(row);
      await saveIndex(idx.fileId, projects);
    },
  };
}
