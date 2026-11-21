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
  const listeners = new Set();

  function rowsFor(accountId) {
    let rows = accounts.get(accountId);
    if (!rows) {
      rows = new Map();
      accounts.set(accountId, rows);
    }
    return rows;
  }

  function list(accountId) {
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
    put(accountId, deviceId, input) {
      const parsed = parsePresenceInput(input);
      if (parsed.error) return false;
      const rows = rowsFor(accountId);
      const previous = rows.get(deviceId);
      if (previous && (parsed.sessionSeq < previous.sessionSeq ||
        (parsed.sessionSeq === previous.sessionSeq && parsed.sessionId !== previous.sessionId))) return false;
      rows.set(deviceId, { ...parsed, deviceId, updatedAt: now() });
      notify(accountId);
      return true;
    },
    clear(accountId, deviceId) {
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
