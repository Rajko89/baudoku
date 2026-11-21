// IndexedDB-Speicher (alles lokal auf dem Gerät)
const DB_NAME = 'baudoku-2', DB_VER = 4;
export const STORES = ['projects', 'photos', 'notes', 'aufmass', 'settings', 'sketches', 'sheets', 'catalog', 'offers'];
let dbp;
function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('projects')) d.createObjectStore('projects', { keyPath: 'id' });
      for (const s of ['photos', 'notes', 'aufmass', 'sketches', 'sheets']) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' }).createIndex('projectId', 'projectId');
      if (!d.objectStoreNames.contains('settings')) d.createObjectStore('settings', { keyPath: 'key' });
      if (!d.objectStoreNames.contains('catalog')) d.createObjectStore('catalog', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('offers')) d.createObjectStore('offers', { keyPath: 'id' }).createIndex('projectId', 'projectId');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
async function store(name, mode = 'readonly') { const d = await open(); return d.transaction(name, mode).objectStore(name); }
export async function put(name, obj) { const s = await store(name, 'readwrite'); await req(s.put(obj)); return obj; }
export async function get(name, id) { const s = await store(name); return req(s.get(id)); }
export async function del(name, id) { const s = await store(name, 'readwrite'); return req(s.delete(id)); }
export async function all(name) { const s = await store(name); return req(s.getAll()); }
export async function byProject(name, pid) { const s = await store(name); return req(s.index('projectId').getAll(pid)); }
export async function deleteProject(pid) {
  const d = await open();
  const names = ['projects', 'photos', 'notes', 'aufmass', 'sketches', 'sheets'].concat(d.objectStoreNames.contains('offers') ? ['offers'] : []);
  const t = d.transaction(names, 'readwrite');
  t.objectStore('projects').delete(pid);
  for (const s of names.filter((n) => n !== 'projects')) {
    const os = t.objectStore(s);
    const keys = await req(os.index('projectId').getAllKeys(pid));
    keys.forEach(k => os.delete(k));
  }
  return new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); });
}
export async function getSetting(key, def) { const r = await get('settings', key); return r ? r.value : def; }
export async function setSetting(key, value) { return put('settings', { key, value }); }
