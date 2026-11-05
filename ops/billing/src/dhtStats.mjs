// Admin «DHT» counters for the last 24 hours.
// One bucket per minute (1440 at most). Totals are sums of those buckets, so a busy day is not cut off.
// Latency is a histogram (upper edges in milliseconds), not a list of samples.
// Persistence is optional: Postgres table dht_minute / dht_recent_error when the store has `dht`.
// A restart reloads that table. Nothing else is stored.
// Never a token, a device id, or an infohash. Error text is a fixed label (see reasonOf).

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const MAX_ERRORS = 10;
const SLOT_MINUTES = 10;
const FLUSH_MS = 1000;
const IDLE_PRUNE_MS = 60 * 1000;
const SHUTDOWN_MS = 2000;
/** After a failed save. Each step is longer, then it stays at the last one. Read-only does not retry. */
const RETRY_MS = [1000, 2000, 5000, 15000, 30000];

/** Upper edge of each latency bin, milliseconds. A sample of N lands in the first edge that is >= N. */
const LAT_EDGES = [
  5, 10, 20, 30, 40, 50, 75, 100, 150, 200, 250, 300, 400, 500, 750,
  1000, 1500, 2000, 3000, 5000, 8000, 12000, 20000, 30000, 60000, 120000, 300000, 600000,
];

const REASONS = {
  probe: 'проверка',
  bad_token: 'нет токена',
  bad_infohash: 'плохой запрос',
  disabled: 'sidecar выключен',
  rate: 'лимит',
  read_only: 'только чтение',
  down: 'sidecar не ответил',
};

let buckets = Object.create(null);
let errors = [];
let latest = 0;
let repo = null;
let loaded = true;
let loadPromise = null;
let dirtyMinutes = new Set();
let errorsDirty = false;
let dirty = false;
let flushTimer = null;
let retryTimer = null;
let idleTimer = null;
let flushing = null;
let saveFails = 0;

function clearFlushTimer() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
}

function clearRetryTimer() {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
}

function clearIdleTimer() {
  if (idleTimer) clearInterval(idleTimer);
  idleTimer = null;
}

export function resetDhtStats() {
  buckets = Object.create(null);
  errors = [];
  latest = 0;
  dirtyMinutes = new Set();
  errorsDirty = false;
  dirty = false;
  saveFails = 0;
  clearFlushTimer();
  clearRetryTimer();
  clearIdleTimer();
}

/** Attach or detach the Postgres adapter. Memory counters stay until resetDhtStats or a load. */
export function bindDhtStats(next) {
  clearIdleTimer();
  repo = next && typeof next.load === 'function' && typeof next.save === 'function' ? next : null;
  loaded = !repo;
  loadPromise = null;
}

function emptyHist() {
  const hist = [];
  for (let i = 0; i < LAT_EDGES.length; i++) hist.push(0);
  return hist;
}

function normalizeHist(raw) {
  const hist = emptyHist();
  if (!raw || typeof raw.length !== 'number') return hist;
  const n = Math.min(raw.length, hist.length);
  for (let i = 0; i < n; i++) {
    const v = Math.floor(Number(raw[i]));
    hist[i] = Number.isFinite(v) && v > 0 ? v : 0;
  }
  return hist;
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

function latBin(ms) {
  for (let i = 0; i < LAT_EDGES.length; i++) if (ms <= LAT_EDGES[i]) return i;
  return LAT_EDGES.length - 1;
}

function knownCode(code) {
  return Object.prototype.hasOwnProperty.call(REASONS, code);
}

/** A closed set. Anything else becomes a generic line, so a thrown message cannot land in the panel. */
function reasonOf(status, code) {
  if (code === 'probe') return REASONS.probe;
  if (status === 500) return 'ошибка биллинга';
  if (knownCode(code)) return REASONS[code];
  return 'ошибка';
}

function scheduleFlush() {
  if (!repo || !loaded) return;
  dirty = true;
  // A backoff retry already owns the next write. A new count stays dirty until that attempt.
  if (flushing || flushTimer || retryTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushDhtStats();
  }, FLUSH_MS);
  if (flushTimer.unref) flushTimer.unref();
}

function scheduleRetry() {
  if (!repo || !loaded || retryTimer) return;
  const wait = RETRY_MS[Math.min(saveFails, RETRY_MS.length - 1)];
  saveFails += 1;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void flushDhtStats();
  }, wait);
  if (retryTimer.unref) retryTimer.unref();
}

/** Quiet process: drop minutes older than 24h even when no new request arrives. */
function armIdlePrune() {
  if (idleTimer || !repo || !loaded) return;
  idleTimer = setInterval(() => {
    void flushDhtStats(Date.now());
  }, IDLE_PRUNE_MS);
  if (idleTimer.unref) idleTimer.unref();
}

/** Drop minutes that cannot overlap the last 24 hours ending at `now`. */
function prune(now) {
  const minKey = minuteOf(now - DAY_MS);
  const maxKey = minuteOf(now);
  const keys = Object.keys(buckets);
  let dropped = false;
  for (let i = 0; i < keys.length; i++) {
    const k = Number(keys[i]);
    if (k < minKey || k > maxKey) {
      delete buckets[keys[i]];
      dirtyMinutes.delete(keys[i]);
      dropped = true;
    }
  }
  if (dropped) scheduleFlush();
  const cut = now - DAY_MS;
  if (errors.some((e) => e.at < cut || e.at > now)) {
    errors = errors.filter((e) => e.at >= cut && e.at <= now);
    errorsDirty = true;
    scheduleFlush();
  }
}

function takeBucket(at) {
  const key = String(minuteOf(at));
  let row = buckets[key];
  if (!row) {
    row = { count: 0, withPeers: 0, sumMs: 0, errors: 0, errors4xx: 0, errors5xx: 0, hist: emptyHist() };
    buckets[key] = row;
  }
  if (!row.hist || row.hist.length !== LAT_EDGES.length) row.hist = normalizeHist(row.hist);
  return { key, row };
}

function rowFromSnap(src) {
  return {
    count: intIn(src.count, 0, 1e12),
    withPeers: intIn(src.withPeers, 0, 1e12),
    sumMs: intIn(src.sumMs, 0, 1e15),
    errors: intIn(src.errors, 0, 1e12),
    errors4xx: intIn(src.errors4xx, 0, 1e12),
    errors5xx: intIn(src.errors5xx, 0, 1e12),
    hist: normalizeHist(src.hist),
  };
}

function addRow(into, extra) {
  into.count += extra.count;
  into.withPeers += extra.withPeers;
  into.sumMs += extra.sumMs;
  into.errors += extra.errors;
  into.errors4xx += extra.errors4xx || 0;
  into.errors5xx += extra.errors5xx || 0;
  const hist = normalizeHist(extra.hist);
  for (let i = 0; i < into.hist.length; i++) into.hist[i] += hist[i];
}

function safeError(e) {
  const text = e && typeof e.reason === 'string' ? e.reason : '';
  const safe = text === 'ошибка биллинга' || text === 'ошибка' || Object.values(REASONS).indexOf(text) >= 0;
  if (!safe) return null;
  return { at: intIn(e.at, 0, 1e15), status: intIn(e.status, 0, 599), reason: text };
}

/**
 * DB snapshot plus counts that arrived while the load was in flight (or after a failed load).
 * Replacing would drop those counts. Memory holds only the delta: flush waits until loaded.
 */
function applySnapshot(snap) {
  const pendingBuckets = buckets;
  const pendingErrors = errors.slice();
  buckets = Object.create(null);
  errors = [];
  latest = 0;
  dirtyMinutes = new Set();
  errorsDirty = false;
  dirty = false;
  const minutes = snap && Array.isArray(snap.minutes) ? snap.minutes : [];
  for (let i = 0; i < minutes.length; i++) {
    const src = minutes[i];
    const minute = Math.floor(Number(src.minute));
    if (!Number.isFinite(minute)) continue;
    buckets[String(minute)] = rowFromSnap(src);
    const at = minute * MINUTE_MS;
    if (at > latest) latest = at;
  }
  const list = snap && Array.isArray(snap.errors) ? snap.errors : [];
  for (let i = 0; i < list.length && errors.length < MAX_ERRORS; i++) {
    const row = safeError(list[i]);
    if (row) errors.push(row);
  }
  const pendingKeys = Object.keys(pendingBuckets);
  for (let i = 0; i < pendingKeys.length; i++) {
    const key = pendingKeys[i];
    const extra = pendingBuckets[key];
    if (!extra || !extra.count) continue;
    if (!buckets[key]) buckets[key] = extra;
    else addRow(buckets[key], extra);
    dirtyMinutes.add(key);
    const at = Number(key) * MINUTE_MS;
    if (at > latest) latest = at;
  }
  if (pendingErrors.length) {
    const merged = errors.concat(pendingErrors);
    merged.sort((a, b) => a.at - b.at);
    errors = merged.slice(Math.max(0, merged.length - MAX_ERRORS));
    errorsDirty = true;
  }
  if (dirtyMinutes.size || errorsDirty) dirty = true;
}

/** Load once. Later calls wait for the same load. A failure leaves memory as it is and retries next time. */
export async function readyDhtStats() {
  if (!repo || loaded) return;
  if (!loadPromise) {
    const run = repo
      .load()
      .then((snap) => {
        applySnapshot(snap);
        loaded = true;
        armIdlePrune();
        if (dirty || dirtyMinutes.size || errorsDirty) scheduleFlush();
      })
      .catch(() => {
        loadPromise = null;
        process.stderr.write('dht stats load failed\n');
      });
    loadPromise = run;
  }
  await loadPromise;
}

function serializeMinute(key, row) {
  return {
    minute: Number(key),
    count: row.count,
    withPeers: row.withPeers,
    sumMs: row.sumMs,
    errors: row.errors,
    errors4xx: row.errors4xx,
    errors5xx: row.errors5xx,
    hist: row.hist.slice(),
  };
}

/**
 * Write dirty minutes and, when the error list changed, the last 10 labels.
 * `now` is the clock for the 24h cutoff (tests pass one). The default is the wall clock,
 * the same cutoff the chart uses, so a quiet process still drops expired rows.
 */
export async function flushDhtStats(now) {
  clearFlushTimer();
  // This attempt replaces a pending backoff. A new failure schedules a fresh one.
  clearRetryTimer();
  if (!repo || !loaded) return;
  if (flushing) {
    await flushing;
    if (dirty || dirtyMinutes.size || errorsDirty) {
      // The clock from before the wait is stale. A request that finished during the
      // save can be a newer error or the next minute. Prune with the old clock drops both.
      return flushDhtStats(Math.max(latest || 0, Date.now()));
    }
    return;
  }
  const at = Number(now) || Date.now();
  // Same window as dhtStatsView: minutes older than 24h leave memory and then the table.
  // `at` is chosen after any wait, so it is not older than rows noted while the previous save ran.
  prune(at);
  clearFlushTimer();
  if (!dirty && !dirtyMinutes.size && !errorsDirty) return;
  const minutes = [];
  for (const key of dirtyMinutes) {
    const row = buckets[key];
    if (row) minutes.push(serializeMinute(key, row));
    dirtyMinutes.delete(key);
  }
  const savedErrors = errorsDirty ? errors.map((e) => ({ at: e.at, status: e.status, reason: e.reason })) : null;
  errorsDirty = false;
  dirty = false;
  const pruneBefore = minuteOf(at - DAY_MS);
  const pruneAfter = minuteOf(at);
  let failed = false;
  let retry = false;
  flushing = repo
    .save({ minutes, errors: savedErrors, pruneBefore, pruneAfter })
    .catch((e) => {
      failed = true;
      dirty = true;
      for (let i = 0; i < minutes.length; i++) dirtyMinutes.add(String(minutes[i].minute));
      if (savedErrors) errorsDirty = true;
      // Cutover refuses writes on purpose. Retrying would only fill the log.
      if (e && e.code === 'READ_ONLY') return;
      retry = true;
      process.stderr.write('dht stats save failed\n');
    })
    .finally(() => {
      flushing = null;
    });
  await flushing;
  if (failed) {
    if (retry) scheduleRetry();
    return;
  }
  saveFails = 0;
  if (dirty || dirtyMinutes.size || errorsDirty) scheduleFlush();
}

/** SIGTERM / SIGINT: write what is still in memory, then give up after `timeoutMs`. */
export async function shutdownDhtStats(timeoutMs) {
  const limit = Math.floor(Number(timeoutMs));
  const wait = Number.isFinite(limit) && limit > 0 ? Math.min(10000, limit) : SHUTDOWN_MS;
  let timer = null;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(resolve, wait);
  });
  const work = (async () => {
    await readyDhtStats();
    clearRetryTimer();
    await flushDhtStats(Date.now());
  })();
  try {
    await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** One finished /v1/dht-peers response, or the admin probe. `now` is the timestamp (tests pass a clock). */
export function noteDhtRequest(row, now) {
  const at = Number(now) || Date.now();
  const status = intIn(row && row.status, 0, 599);
  const ms = intIn(row && row.ms, 0, 600000);
  const peers = status === 200 ? intIn(row && row.peers, 0, 100000) : 0;
  const taken = takeBucket(at);
  const bucket = taken.row;
  bucket.count++;
  bucket.sumMs += ms;
  bucket.hist[latBin(ms)]++;
  if (status === 200 && peers > 0) bucket.withPeers++;
  if (status >= 500) bucket.errors5xx++;
  else if (status >= 400) bucket.errors4xx++;
  if (status !== 200) {
    bucket.errors++;
    const code = row && knownCode(row.reason) ? row.reason : '';
    errors.push({ at, status, reason: reasonOf(status, code) });
    if (errors.length > MAX_ERRORS) errors = errors.slice(errors.length - MAX_ERRORS);
    errorsDirty = true;
  }
  dirtyMinutes.add(taken.key);
  if (at > latest) latest = at;
  // Prune from the newest event, not this one: an older row must not wipe a later minute.
  prune(latest);
  scheduleFlush();
}

function addHist(into, hist) {
  for (let i = 0; i < into.length; i++) into[i] += hist[i] || 0;
}

function percentile(hist, p) {
  let total = 0;
  for (let i = 0; i < hist.length; i++) total += hist[i];
  if (!total) return 0;
  const rank = Math.ceil((p / 100) * total);
  let acc = 0;
  for (let i = 0; i < hist.length; i++) {
    acc += hist[i];
    if (acc >= rank) return LAT_EDGES[i];
  }
  return LAT_EDGES[LAT_EDGES.length - 1];
}

function buildSeries(now) {
  const end = minuteOf(now);
  const start = minuteOf(now - DAY_MS);
  const startSlot = Math.floor(start / SLOT_MINUTES) * SLOT_MINUTES;
  const endSlot = Math.floor(end / SLOT_MINUTES) * SLOT_MINUTES;
  const out = [];
  for (let s = startSlot; s <= endSlot; s += SLOT_MINUTES) {
    let requests = 0;
    let err = 0;
    for (let m = 0; m < SLOT_MINUTES; m++) {
      const key = s + m;
      if (key < start || key > end) continue;
      const row = buckets[String(key)];
      if (!row) continue;
      requests += row.count;
      err += row.errors;
    }
    out.push({ t: s * MINUTE_MS, requests, errors: err });
  }
  return out;
}

/**
 * Counts for the last 24 hours, 10-minute series (from the minute buckets), p50/p95,
 * and the last 10 errors in that window. Newest error first.
 * `errors24h` is every non-200. 4xx and 5xx are the split; other non-200 codes sit only in the total.
 */
export function dhtStatsView(now) {
  const at = Number(now) || Date.now();
  prune(at);
  const keys = Object.keys(buckets);
  let count = 0;
  let withPeers = 0;
  let msSum = 0;
  let errors4xx = 0;
  let errors5xx = 0;
  let err = 0;
  const hist = emptyHist();
  for (let i = 0; i < keys.length; i++) {
    const row = buckets[keys[i]];
    count += row.count;
    withPeers += row.withPeers;
    msSum += row.sumMs;
    errors4xx += row.errors4xx || 0;
    errors5xx += row.errors5xx || 0;
    err += row.errors;
    addHist(hist, row.hist || emptyHist());
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
    errors24h: err,
    errors4xx24h: errors4xx,
    errors5xx24h: errors5xx,
    p50Ms: percentile(hist, 50),
    p95Ms: percentile(hist, 95),
    series: buildSeries(at),
    errors: recent,
  };
}
