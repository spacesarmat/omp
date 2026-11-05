// In-memory counters for the admin «DHT» block. Nothing is written to Postgres.
// A restart forgets them. No token, no device id, no infohash.
// One bucket per minute for the last 24 hours (1440 at most). Totals are sums of those
// buckets, so a busy day is not cut off after a fixed number of requests.

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const MAX_ERRORS = 10;

let buckets = Object.create(null);
let errors = [];
let latest = 0;

export function resetDhtStats() {
  buckets = Object.create(null);
  errors = [];
  latest = 0;
}

function intIn(value, min, max) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return min;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function minuteOf(at) {
  return Math.floor(at / MINUTE_MS);
}

/** Drop minutes that cannot overlap the last 24 hours ending at `now`. */
function prune(now) {
  const minKey = minuteOf(now - DAY_MS);
  const maxKey = minuteOf(now);
  const keys = Object.keys(buckets);
  for (let i = 0; i < keys.length; i++) {
    const k = Number(keys[i]);
    if (k < minKey || k > maxKey) delete buckets[keys[i]];
  }
}

function takeBucket(at) {
  const key = String(minuteOf(at));
  let row = buckets[key];
  if (!row) {
    row = { count: 0, withPeers: 0, sumMs: 0, errors: 0 };
    buckets[key] = row;
  }
  return row;
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
  const bucket = takeBucket(at);
  bucket.count++;
  bucket.sumMs += ms;
  if (status === 200 && peers > 0) bucket.withPeers++;
  if (status !== 200) {
    bucket.errors++;
    const code = row && knownCode(row.reason) ? row.reason : '';
    errors.push({ at, status, reason: reasonOf(status, code) });
    if (errors.length > MAX_ERRORS) errors = errors.slice(errors.length - MAX_ERRORS);
  }
  if (at > latest) latest = at;
  // Prune from the newest event, not this one: an older row must not wipe a later minute.
  prune(latest);
}

/** Counts for the last 24 hours and the last 10 errors in that window. Newest error first. */
export function dhtStatsView(now) {
  const at = Number(now) || Date.now();
  prune(at);
  const keys = Object.keys(buckets);
  let count = 0;
  let withPeers = 0;
  let msSum = 0;
  for (let i = 0; i < keys.length; i++) {
    const row = buckets[keys[i]];
    count += row.count;
    withPeers += row.withPeers;
    msSum += row.sumMs;
  }
  const cut = at - DAY_MS;
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
