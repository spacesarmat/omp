// In-memory counters for the admin «DHT» block. Nothing is written to Postgres.
// A restart forgets them. No token, no device id, no infohash.

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_ROWS = 8000;
const MAX_ERRORS = 10;

let rows = [];
let errors = [];

export function resetDhtStats() {
  rows = [];
  errors = [];
}

function intIn(value, min, max) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return min;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

/** A closed set. Anything else becomes a generic line, so a thrown message cannot land in the panel. */
function reasonOf(status, code) {
  if (status === 500) return 'ошибка биллинга';
  if (code === 'bad_token') return 'нет токена';
  if (code === 'bad_infohash') return 'плохой запрос';
  if (code === 'disabled') return 'sidecar выключен';
  if (code === 'rate') return 'лимит';
  if (code === 'read_only') return 'только чтение';
  if (code === 'down') return 'sidecar не ответил';
  return 'ошибка';
}

function knownCode(code) {
  return (
    code === 'bad_token' ||
    code === 'bad_infohash' ||
    code === 'disabled' ||
    code === 'rate' ||
    code === 'read_only' ||
    code === 'down'
  );
}

/** One finished /v1/dht-peers response. `now` is the timestamp (tests pass a clock). */
export function noteDhtRequest(row, now) {
  const at = Number(now) || Date.now();
  const status = intIn(row && row.status, 0, 599);
  const ms = intIn(row && row.ms, 0, 600000);
  const peers = status === 200 ? intIn(row && row.peers, 0, 100000) : 0;
  rows.push({ at, status, ms, peers });
  const cut = at - DAY_MS;
  if (rows.length > MAX_ROWS || (rows[0] && rows[0].at < cut)) {
    rows = rows.filter((r) => r.at >= cut).slice(-MAX_ROWS);
  }
  if (status !== 200) {
    const code = row && knownCode(row.reason) ? row.reason : '';
    errors.push({ at, status, reason: reasonOf(status, code) });
    if (errors.length > MAX_ERRORS) errors = errors.slice(errors.length - MAX_ERRORS);
  }
}

/** Counts for the last 24 hours and the last 10 errors in that window. Newest error first. */
export function dhtStatsView(now) {
  const at = Number(now) || Date.now();
  const cut = at - DAY_MS;
  const win = rows.filter((r) => r.at >= cut && r.at <= at);
  let msSum = 0;
  let withPeers = 0;
  for (let i = 0; i < win.length; i++) {
    msSum += win[i].ms;
    if (win[i].status === 200 && win[i].peers > 0) withPeers++;
  }
  const count = win.length;
  const recent = [];
  for (let i = errors.length - 1; i >= 0 && recent.length < MAX_ERRORS; i--) {
    if (errors[i].at >= cut && errors[i].at <= at) recent.push(errors[i]);
  }
  return {
    requests24h: count,
    withPeers24h: withPeers,
    peersSharePct: count ? Math.round((withPeers * 1000) / count) / 10 : 0,
    avgMs: count ? Math.round(msSum / count) : 0,
    errors: recent,
  };
}
