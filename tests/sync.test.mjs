import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideImport, mergeCatalog, projectTime } from '../zwei/js/transfer.js';
import { memoryStore, runSync } from '../zwei/js/sync.js';

let n = 0;
const makeId = () => 'neu-' + (++n);

function project(id, name, at, deviceId) {
  return { id, name, updatedAt: at, updated: at, deviceId, created: 1 };
}

test('Import fragt nach und ersetzt nur neuere Dateien', () => {
  assert.equal(decideImport(null, project('a', 'Haus', 10, 'pc')).action, 'create');
  const newer = decideImport(project('a', 'Haus', 10, 'pc'), project('a', 'Haus', 20, 'handy'));
  assert.equal(newer.action, 'ask');
  assert.equal(newer.allowReplace, true);
  const older = decideImport(project('a', 'Haus', 30, 'pc'), project('a', 'Haus', 20, 'handy'));
  assert.equal(older.allowReplace, false);
  assert.equal(projectTime({ updated: 5 }), 5);
});

test('Katalog ergänzt nur fehlende Einträge', () => {
  const local = [{ id: 'cat-seed-01', price: 70, short: 'geändert' }];
  const incoming = [{ id: 'cat-seed-01', price: 68, short: 'alt' }, { id: 'cat-seed-02', price: 12, short: 'Dachrinne' }];
  const merged = mergeCatalog(local, incoming);
  assert.equal(merged.added.length, 1);
  assert.equal(merged.catalog[0].price, 70);
  assert.equal(merged.catalog[1].id, 'cat-seed-02');
});

test('Zwei Geräte: neu, geändert, gelöscht, Konflikt', async () => {
  const drive = memoryStore('drive');
  const pc = memoryStore('Computer');
  const phone = memoryStore('Handy');
  pc.putProject(project('p1', 'Doppelhaus', 100, 'Computer'));
  await runSync(pc, drive, { deviceId: 'Computer', deviceName: 'Computer', now: 100, makeId });
  await runSync(phone, drive, { deviceId: 'Handy', deviceName: 'Handy', now: 100, makeId });
  assert.equal((await phone.snapshot()).projects[0].project.name, 'Doppelhaus');

  pc.putProject(project('p1', 'Doppelhaus Nord', 200, 'Computer'));
  await runSync(pc, drive, { deviceId: 'Computer', deviceName: 'Computer', now: 200, makeId });
  await runSync(phone, drive, { deviceId: 'Handy', deviceName: 'Handy', now: 200, makeId });
  assert.equal((await phone.snapshot()).projects[0].project.name, 'Doppelhaus Nord');

  await pc.tombstone({ id: 'p1', deletedAt: 300, deviceId: 'Computer', name: 'Doppelhaus Nord' });
  await runSync(pc, drive, { deviceId: 'Computer', deviceName: 'Computer', now: 300, makeId });
  await runSync(phone, drive, { deviceId: 'Handy', deviceName: 'Handy', now: 300, makeId });
  assert.equal((await phone.snapshot()).projects.length, 0);
  assert.equal(phone.backups.at(-1).project.name, 'Doppelhaus Nord');

  pc.putProject(project('p2', 'Reihenhaus', 400, 'Computer'));
  await runSync(pc, drive, { deviceId: 'Computer', deviceName: 'Computer', now: 400, makeId });
  await runSync(phone, drive, { deviceId: 'Handy', deviceName: 'Handy', now: 400, makeId });
  pc.putProject(project('p2', 'Reihenhaus Computer', 500, 'Computer'));
  phone.putProject(project('p2', 'Reihenhaus Handy', 600, 'Handy'));
  await runSync(pc, drive, { deviceId: 'Computer', deviceName: 'Computer', now: 500, makeId });
  await runSync(phone, drive, { deviceId: 'Handy', deviceName: 'Handy', now: 700, makeId });
  const names = (await phone.snapshot()).projects.map((b) => b.project.name).sort();
  assert.ok(names.includes('Reihenhaus Handy'));
  assert.ok(names.some((name) => name.startsWith('Reihenhaus Computer (Konflikt Computer')), names.join(' | '));
  const driveNames = (await drive.snapshot()).projects.map((b) => b.project.name);
  assert.ok(driveNames.includes('Reihenhaus Handy'));
  assert.ok(driveNames.some((name) => name.includes('Konflikt')));
});
