// Lokaler Speicher für den Abgleich. Vor einem Ersetzen bleibt eine Sicherung in den Einstellungen.
import * as db from './db.js';

const CHILD = ['photos', 'notes', 'aufmass', 'sketches', 'sheets', 'offers'];

export async function bundleProject(id) {
  const project = await db.get('projects', id);
  if (!project) return null;
  const rows = {};
  for (const name of CHILD) rows[name] = await db.byProject(name, id).catch(() => []);
  return { project, ...rows, catalog: [] };
}

async function writeChildren(bundle) {
  await db.put('projects', bundle.project);
  for (const name of CHILD) for (const row of bundle[name] || []) await db.put(name, row);
}

export function idbSyncStore() {
  return {
    async snapshot() {
      const projects = await db.all('projects');
      const bundles = [];
      for (const p of projects) {
        const bundle = await bundleProject(p.id);
        if (bundle) bundles.push(bundle);
      }
      return { projects: bundles, tombstones: await db.getSetting('tombstones', []) };
    },
    async bases() { return db.getSetting('syncBases', {}); },
    async setBases(next) { await db.setSetting('syncBases', next); },
    async write(bundle) {
      await db.deleteProject(bundle.project.id);
      await writeChildren(bundle);
      const tombs = (await db.getSetting('tombstones', [])).filter((t) => t.id !== bundle.project.id);
      await db.setSetting('tombstones', tombs);
    },
    async remove(id) { await db.deleteProject(id); },
    async tombstone(tomb) {
      const tombs = (await db.getSetting('tombstones', [])).filter((t) => t.id !== tomb.id);
      tombs.push(tomb);
      await db.setSetting('tombstones', tombs);
      await db.deleteProject(tomb.id);
    },
    async backup(id) {
      const bundle = await bundleProject(id);
      if (bundle) await db.setSetting('syncBackup:' + id, { at: Date.now(), bundle });
    },
  };
}
