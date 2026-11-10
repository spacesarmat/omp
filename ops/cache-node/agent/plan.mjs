// Pure planning for the cache agent. No network and no token.

export function prefixGoal(assignment) {
  const bytes = Math.floor(Number(assignment && assignment.prefixBytes) || 0);
  if (bytes > 0) return bytes;
  const percent = Math.floor(Number(assignment && assignment.prefixPercent) || 0);
  const size = Math.floor(Number(assignment && assignment.sizeBytes) || 0);
  if (percent > 0 && size > 0) return Math.ceil((size * percent) / 100);
  return 512 * 1024 * 1024;
}

/** Which torrents to add and which to drop. A failed TorrServer list must not call this with a guess. */
export function reconcile(localHashes, assignments) {
  const want = {};
  const add = [];
  const keep = [];
  const list = Array.isArray(assignments) ? assignments : [];
  for (let i = 0; i < list.length; i++) {
    const row = list[i];
    const hash = String(row && row.infohash || '').toLowerCase();
    if (!/^[a-f0-9]{40}$/.test(hash)) continue;
    want[hash] = row;
    if (!localHashes[hash]) add.push(row);
    else if (row.status !== 'cached') keep.push(row);
  }
  const remove = [];
  const keys = Object.keys(localHashes || {});
  for (let i = 0; i < keys.length; i++) {
    if (!want[keys[i]]) remove.push(keys[i]);
  }
  return { add, remove, keep };
}

function streamPath(pathname) {
  if (pathname === '/echo' || pathname === '/stream' || pathname === '/playlist') return true;
  if (pathname.indexOf('/stream/') === 0 || pathname.indexOf('/playlist/') === 0) return pathname.indexOf('..') < 0;
  return false;
}

/** Public path the agent may proxy to TorrServer. Anything else, including the torrent API, is refused. */
export function safeStreamTarget(urlPathAndQuery) {
  const raw = String(urlPathAndQuery || '');
  if (!raw || raw.length > 2048 || raw.indexOf('\\') >= 0) return '';
  let u;
  try {
    u = new URL(raw, 'http://cache.local');
  } catch (e) {
    return '';
  }
  if (u.username || u.password) return '';
  let decoded = u.pathname;
  try {
    decoded = decodeURIComponent(u.pathname);
  } catch (e) {
    return '';
  }
  if (decoded.indexOf('..') >= 0) return '';
  if (!streamPath(u.pathname)) return '';
  return u.pathname + u.search;
}
