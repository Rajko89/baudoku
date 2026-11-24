// Reine Entscheidungen für Projekt-Export und -Import. Keine fest eingebauten Konten.

export function projectTime(project) {
  const n = Number(project?.updatedAt ?? project?.updated ?? project?.created ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function stampProject(project, deviceId, now = Date.now()) {
  return { ...project, updated: now, updatedAt: now, deviceId: deviceId || project?.deviceId || '' };
}

/** Ohne vorhandenes Projekt anlegen. Sonst nachfragen. Ersetzen nur, wenn die Datei neuer ist. */
export function decideImport(existing, incoming) {
  if (!existing) return { action: 'create', incomingNewer: true, allowReplace: false };
  const incomingNewer = projectTime(incoming) > projectTime(existing);
  return { action: 'ask', incomingNewer, allowReplace: incomingNewer };
}

/** Fehlende Katalog-IDs ergänzen, vorhandene Einträge nicht anfassen. */
export function mergeCatalog(local, incoming) {
  const have = new Set((local || []).map((c) => c?.id).filter(Boolean));
  const added = [];
  for (const item of incoming || []) {
    if (!item?.id || have.has(item.id)) continue;
    have.add(item.id);
    added.push(item);
  }
  return { added, catalog: [...(local || []), ...added] };
}

export function formatStamp(ts) {
  const d = new Date(Number(ts) || 0);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function conflictTitle(name, deviceName, ts) {
  return `${name || 'Projekt'} (Konflikt ${deviceName || 'Gerät'} ${formatStamp(ts)})`;
}
