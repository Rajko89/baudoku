// Abgleich zweier Speicher über ein schmales Interface. Google Drive ist nur eine Umsetzung davon.
import { conflictTitle, projectTime } from './transfer.js';

function sideOf(bundle, tomb) {
  const at = bundle ? projectTime(bundle.project) : 0;
  const deletedAt = Number(tomb?.deletedAt || 0);
  if (bundle && at >= deletedAt) return { kind: 'present', at, bundle };
  if (tomb || deletedAt) return { kind: 'deleted', at: deletedAt, tomb };
  return { kind: 'absent', at: 0 };
}

function remapId(map, id, makeId) {
  if (!id) return id;
  if (!map.has(id)) map.set(id, makeId());
  return map.get(id);
}

export function forkBundle(bundle, { name, updatedAt, deviceId, makeId }) {
  const map = new Map();
  const projectId = makeId();
  map.set(bundle.project.id, projectId);
  const nid = (id) => remapId(map, id, makeId);
  const child = (row) => {
    if (!row) return row;
    const next = { ...row, id: nid(row.id), projectId };
    if ('photoId' in next) next.photoId = nid(next.photoId);
    if ('sketchId' in next) next.sketchId = nid(next.sketchId);
    if ('sheetId' in next) next.sheetId = nid(next.sheetId);
    if ('coverPhotoId' in next) next.coverPhotoId = nid(next.coverPhotoId);
    return next;
  };
  const project = {
    ...bundle.project,
    id: projectId,
    name,
    updated: updatedAt,
    updatedAt,
    deviceId,
    conflictOf: bundle.project.id,
  };
  if (project.coverPhotoId) project.coverPhotoId = nid(bundle.project.coverPhotoId);
  return {
    project,
    photos: (bundle.photos || []).map(child),
    notes: (bundle.notes || []).map(child),
    aufmass: (bundle.aufmass || []).map(child),
    sketches: (bundle.sketches || []).map(child),
    sheets: (bundle.sheets || []).map(child),
    offers: (bundle.offers || []).map(child),
    catalog: bundle.catalog || [],
  };
}

export function buildPlan({ local, remote, bases = {}, deviceId, deviceName, now, makeId }) {
  const ids = new Set([
    ...(local.projects || []).map((b) => b.project.id),
    ...(remote.projects || []).map((b) => b.project.id),
    ...(local.tombstones || []).map((t) => t.id),
    ...(remote.tombstones || []).map((t) => t.id),
  ]);
  const localB = new Map((local.projects || []).map((b) => [b.project.id, b]));
  const remoteB = new Map((remote.projects || []).map((b) => [b.project.id, b]));
  const localT = new Map((local.tombstones || []).map((t) => [t.id, t]));
  const remoteT = new Map((remote.tombstones || []).map((t) => [t.id, t]));
  const steps = [];
  const nextBases = { ...bases };
  const fresh = makeId || (() => 'id-' + Math.random().toString(36).slice(2));

  const pushPresent = (bundle) => steps.push({ op: 'write-remote', bundle });
  const pullPresent = (bundle) => {
    if (localB.has(bundle.project.id)) steps.push({ op: 'backup', id: bundle.project.id });
    steps.push({ op: 'write-local', bundle });
  };
  const pushDelete = (id, tomb) => steps.push({ op: 'tomb-remote', tomb: tomb || { id, deletedAt: now, deviceId, name: '' } });
  const pullDelete = (id, tomb) => {
    if (localB.has(id)) steps.push({ op: 'backup', id });
    steps.push({ op: 'delete-local', id });
    steps.push({ op: 'tomb-local', tomb });
  };
  const keepConflict = (bundle) => {
    const copy = forkBundle(bundle, {
      name: conflictTitle(bundle.project.name, bundle.project.deviceName || bundle.project.deviceId || deviceName, projectTime(bundle.project)),
      updatedAt: now + 1,
      deviceId,
      makeId: fresh,
    });
    steps.push({ op: 'write-local', bundle: copy });
    steps.push({ op: 'write-remote', bundle: copy });
    nextBases[copy.project.id] = copy.project.updatedAt;
  };

  for (const id of ids) {
    const ls = sideOf(localB.get(id), localT.get(id));
    const rs = sideOf(remoteB.get(id), remoteT.get(id));
    const base = Number(bases[id] || 0);
    const lCh = ls.at > base;
    const rCh = rs.at > base;
    if (!lCh && !rCh) {
      nextBases[id] = Math.max(base, ls.at, rs.at);
      continue;
    }
    if (lCh && rCh) {
      if (ls.kind === rs.kind && ls.at === rs.at) {
        nextBases[id] = ls.at;
        continue;
      }
      const localWins = ls.at >= rs.at;
      const win = localWins ? ls : rs;
      const lose = localWins ? rs : ls;
      if (lose.kind === 'present') keepConflict(lose.bundle);
      if (win.kind === 'present') {
        if (localWins) pushPresent(win.bundle);
        else pullPresent(win.bundle);
      } else {
        const tomb = win.tomb || { id, deletedAt: win.at, deviceId, name: '' };
        if (localWins) pushDelete(id, tomb);
        else pullDelete(id, tomb);
      }
      nextBases[id] = win.at;
      continue;
    }
    const src = lCh ? ls : rs;
    const dir = lCh ? 'push' : 'pull';
    if (src.kind === 'present') {
      if (dir === 'push') pushPresent(src.bundle);
      else pullPresent(src.bundle);
      nextBases[id] = src.at;
    } else if (src.kind === 'deleted') {
      const tomb = src.tomb || { id, deletedAt: src.at, deviceId, name: '' };
      if (dir === 'push') pushDelete(id, tomb);
      else pullDelete(id, tomb);
      nextBases[id] = src.at;
    }
  }
  return { steps, bases: nextBases };
}

export async function runSync(local, remote, ctx) {
  const plan = buildPlan({
    local: await local.snapshot(),
    remote: await remote.snapshot(),
    bases: await local.bases(),
    deviceId: ctx.deviceId,
    deviceName: ctx.deviceName,
    now: ctx.now || Date.now(),
    makeId: ctx.makeId,
  });
  for (const step of plan.steps) {
    if (step.op === 'backup') await local.backup(step.id);
    else if (step.op === 'write-local') await local.write(step.bundle);
    else if (step.op === 'write-remote') await remote.write(step.bundle);
    else if (step.op === 'delete-local') await local.remove(step.id);
    else if (step.op === 'tomb-local') await local.tombstone(step.tomb);
    else if (step.op === 'tomb-remote') await remote.tombstone(step.tomb);
  }
  await local.setBases(plan.bases);
  return plan;
}

export function memoryStore(deviceId) {
  const projects = new Map();
  const tombs = new Map();
  let bases = {};
  const backups = [];
  const bundleOf = (project, extra = {}) => ({ project, photos: [], notes: [], aufmass: [], sketches: [], sheets: [], offers: [], catalog: [], ...extra });
  return {
    deviceId,
    backups,
    putProject(project, extra = {}) {
      const bundle = extra.project ? extra : bundleOf(project, extra);
      projects.set(bundle.project.id, bundle);
      tombs.delete(bundle.project.id);
      return bundle;
    },
    async snapshot() {
      return { projects: [...projects.values()], tombstones: [...tombs.values()] };
    },
    async bases() { return { ...bases }; },
    async setBases(next) { bases = { ...next }; },
    async write(bundle) { projects.set(bundle.project.id, bundle); tombs.delete(bundle.project.id); },
    async remove(id) { projects.delete(id); },
    async tombstone(tomb) { tombs.set(tomb.id, tomb); projects.delete(tomb.id); },
    async backup(id) {
      const cur = projects.get(id);
      if (cur) backups.push(JSON.parse(JSON.stringify(cur)));
    },
  };
}
