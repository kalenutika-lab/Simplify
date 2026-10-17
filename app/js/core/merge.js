// Sync merge: per record, the most recent edit (updatedAt) wins. Deletions are
// kept as small "deleted" markers so they reach the other device too.
// The result does not depend on which side is "local", so both devices converge.

function pick(a, b) {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
  // Same timestamp but different content: choose deterministically.
  if (!!a.deleted !== !!b.deleted) return a.deleted ? a : b;
  return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
}

export function mergeRecords(local, remote) {
  const byId = new Map();
  for (const r of local) byId.set(r.id, r);
  let localChanged = false;
  for (const r of remote) {
    const cur = byId.get(r.id);
    if (!cur) { byId.set(r.id, r); localChanged = true; continue; }
    const win = pick(cur, r);
    if (win !== cur && JSON.stringify(win) !== JSON.stringify(cur)) { byId.set(r.id, win); localChanged = true; }
  }
  const merged = [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
  const remoteIds = new Map(remote.map((r) => [r.id, r]));
  const remoteChanged = merged.length !== remote.length || merged.some((r) => JSON.stringify(remoteIds.get(r.id)) !== JSON.stringify(r));
  return { merged, localChanged, remoteChanged };
}

export function mergePrefs(local, remote) {
  if (!remote) return { merged: local, localChanged: false, remoteChanged: true };
  if (!local) return { merged: remote, localChanged: true, remoteChanged: false };
  if (local.updatedAt === remote.updatedAt) return { merged: local, localChanged: false, remoteChanged: JSON.stringify(local) !== JSON.stringify(remote) };
  return local.updatedAt > remote.updatedAt
    ? { merged: local, localChanged: false, remoteChanged: true }
    : { merged: remote, localChanged: true, remoteChanged: false };
}
