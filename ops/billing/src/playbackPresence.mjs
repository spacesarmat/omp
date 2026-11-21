const STATES = new Set(['playing', 'paused', 'finished']);
const PLATFORMS = new Set(['lg', 'androidtv', 'phone', 'desktop']);

function text(value, max) {
  return String(value || '').replace(/[\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function seconds(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

export function parsePresenceInput(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'bad_presence' };
  const state = text(raw.state, 16);
  const sessionId = text(raw.sessionId, 100);
  const hash = text(raw.hash, 40).toLowerCase();
  const platform = text(raw.platform, 16);
  const positionSec = seconds(raw.positionSec);
  const durationSec = seconds(raw.durationSec);
  if (!STATES.has(state) || !sessionId || !PLATFORMS.has(platform)) return { error: 'bad_presence' };
  if (!Number.isSafeInteger(raw.sessionSeq) || raw.sessionSeq <= 0) return { error: 'bad_presence' };
  if (!/^[0-9a-f]{40}$/.test(hash) || !Number.isInteger(raw.fileId) || raw.fileId < 0) return { error: 'bad_presence' };
  if (positionSec === null || durationSec === null) return { error: 'bad_presence' };
  return {
    state,
    sessionId,
    sessionSeq: raw.sessionSeq,
    hash,
    fileId: raw.fileId,
    title: text(raw.title, 180),
    episode: text(raw.episode, 180),
    positionSec,
    durationSec,
    deviceName: text(raw.deviceName, 80),
    platform,
  };
}

export function createPresenceStore(now = Date.now, ttlMs = 90000) {
  const accounts = new Map();
  const latest = new Map();
  const latestIds = new Map();
  const cleared = new Map();
  const historyAt = new Map();
  const listeners = new Set();
  const historyTtl = 24 * 60 * 60 * 1000;
  let lastPrune = -60000;

  function mapFor(root, accountId) {
    let rows = root.get(accountId);
    if (!rows) {
      rows = new Map();
      root.set(accountId, rows);
    }
    return rows;
  }

  function prune() {
    const at = now();
    lastPrune = at;
    let removed = 0;
    for (const [accountId, rows] of accounts) {
      for (const [deviceId, row] of rows) {
        if (at - row.updatedAt >= ttlMs) {
          rows.delete(deviceId);
          removed++;
        }
      }
      if (!rows.size) accounts.delete(accountId);
    }
    for (const [accountId, rows] of historyAt) {
      for (const [deviceId, stampedAt] of rows) {
        if (at - stampedAt < historyTtl) continue;
        rows.delete(deviceId);
        if (latest.get(accountId)) latest.get(accountId).delete(deviceId);
        if (latestIds.get(accountId)) latestIds.get(accountId).delete(deviceId);
        if (cleared.get(accountId)) cleared.get(accountId).delete(deviceId);
        removed++;
      }
      if (!rows.size) historyAt.delete(accountId);
    }
    for (const root of [latest, latestIds, cleared]) {
      for (const [accountId, rows] of root) if (!rows.size) root.delete(accountId);
    }
    return removed;
  }

  function maybePrune() {
    if (now() - lastPrune >= 60000) prune();
  }

  function list(accountId) {
    maybePrune();
    const rows = accounts.get(accountId);
    if (!rows) return [];
    const at = now();
    for (const [deviceId, row] of rows) {
      if (at - row.updatedAt >= ttlMs) rows.delete(deviceId);
    }
    return [...rows.values()].sort((a, b) => {
      if ((a.state === 'playing') !== (b.state === 'playing')) return a.state === 'playing' ? -1 : 1;
      if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
      return a.deviceId.localeCompare(b.deviceId);
    }).map((row) => ({ ...row }));
  }

  function notify(accountId) {
    const rows = list(accountId);
    for (const listener of [...listeners]) {
      try {
        listener(accountId, rows);
      } catch (e) {
        /* presence listeners cannot block playback state updates */
      }
    }
  }

  return {
    list,
    prune,
    put(accountId, deviceId, input) {
      maybePrune();
      const parsed = parsePresenceInput(input);
      if (parsed.error) return false;
      const removed = mapFor(cleared, accountId);
      if (parsed.sessionSeq <= (removed.get(deviceId) || 0)) return false;
      const rows = mapFor(accounts, accountId);
      const previous = rows.get(deviceId);
      const seen = mapFor(latest, accountId);
      const latestSeq = seen.get(deviceId) || 0;
      const knownId = mapFor(latestIds, accountId).get(deviceId) || '';
      if (parsed.sessionSeq < latestSeq || (!previous && latestSeq && parsed.sessionSeq === latestSeq && knownId !== parsed.sessionId)) return false;
      if (previous && (parsed.sessionSeq < previous.sessionSeq ||
        (parsed.sessionSeq === previous.sessionSeq && parsed.sessionId !== previous.sessionId))) return false;
      seen.set(deviceId, Math.max(latestSeq, parsed.sessionSeq));
      mapFor(latestIds, accountId).set(deviceId, parsed.sessionId);
      const at = now();
      mapFor(historyAt, accountId).set(deviceId, at);
      rows.set(deviceId, { ...parsed, deviceId, updatedAt: at });
      notify(accountId);
      return true;
    },
    clear(accountId, deviceId, sessionSeq) {
      maybePrune();
      if (!Number.isSafeInteger(sessionSeq) || sessionSeq <= 0) return false;
      const previous = accounts.get(accountId) && accounts.get(accountId).get(deviceId);
      const seen = mapFor(latest, accountId).get(deviceId) || 0;
      if (seen > sessionSeq) return false;
      const removed = mapFor(cleared, accountId);
      removed.set(deviceId, Math.max(removed.get(deviceId) || 0, sessionSeq));
      mapFor(historyAt, accountId).set(deviceId, now());
      const rows = accounts.get(accountId);
      if (!rows || !rows.delete(deviceId)) return false;
      notify(accountId);
      return true;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
