// Watch-quality tables (migration 009_watch_quality). Outside the billing state snapshot.
// watch_votes keeps a sha256 of account and device so one vote cannot be counted twice.
// The aggregate tables have no account id, no device id and no IP.
import { normalizeInfohash } from '../../cacheNodes.mjs';
import {
  deviceClassOf,
  parseFeed,
  parseSignalBody,
  renderFeed,
  titleKeyOf,
  removeDelta,
  voteDelta,
  voterHash,
} from '../../watchRank.mjs';

function num(v) {
  const n = Math.floor(Number(v) || 0);
  return n > 0 ? n : 0;
}

function statsOf(r) {
  return {
    samples: num(r.samples),
    completed: num(r.completed),
    switched: num(r.switched),
    ttffMs: num(r.ttff_ms),
    rebufferN: num(r.rebuffer_n),
    rebufferMs: num(r.rebuffer_ms),
    watchedSum: num(r.watched_sum),
    codecOk: num(r.codec_ok),
    codecFail: num(r.codec_fail),
    title: r.title || '',
    titleKey: r.title_key || '',
    season: num(r.season),
    episode: num(r.episode),
  };
}

const DAY = 24 * 60 * 60 * 1000;
const SEEN_KEEP = 30 * DAY;
const FOLLOW_KEEP = 180 * DAY;

export async function statsFor(query, hashes, deviceClass) {
  const list = [];
  const seen = {};
  for (let i = 0; i < hashes.length; i++) {
    const h = normalizeInfohash(hashes[i]);
    if (h && !seen[h]) {
      seen[h] = true;
      list.push(h);
    }
  }
  if (!list.length) return {};
  const res = await query(
    'SELECT infohash, sum(samples)::int AS samples, sum(completed)::int AS completed, sum(switched)::int AS switched,' +
      ' sum(ttff_ms)::bigint AS ttff_ms, sum(rebuffer_n)::int AS rebuffer_n, sum(rebuffer_ms)::bigint AS rebuffer_ms,' +
      ' sum(watched_sum)::int AS watched_sum, sum(codec_ok)::int AS codec_ok, sum(codec_fail)::int AS codec_fail,' +
      ' max(title) AS title, max(title_key) AS title_key, max(season) AS season, max(episode) AS episode' +
      ' FROM watch_release_stats WHERE device_class = $2 AND infohash = ANY($1::text[]) GROUP BY infohash',
    [list, deviceClassOf(deviceClass)],
  );
  const out = {};
  for (let i = 0; i < res.rows.length; i++) out[res.rows[i].infohash] = statsOf(res.rows[i]);
  return out;
}

export async function modsFor(query, hashes) {
  const list = [];
  const seen = {};
  for (let i = 0; i < hashes.length; i++) {
    const h = normalizeInfohash(hashes[i]);
    if (h && !seen[h]) {
      seen[h] = true;
      list.push(h);
    }
  }
  if (!list.length) return {};
  const res = await query(
    'SELECT infohash, pinned, banned, note FROM watch_mod WHERE infohash = ANY($1::text[])',
    [list],
  );
  const out = {};
  for (let i = 0; i < res.rows.length; i++) {
    const r = res.rows[i];
    out[r.infohash] = { pinned: r.pinned === true, banned: r.banned === true, note: r.note || '' };
  }
  return out;
}

export async function voicesFor(query, keys) {
  const list = [];
  const seen = {};
  for (let i = 0; i < keys.length; i++) {
    const k = titleKeyOf('', keys[i]) || String(keys[i] || '').slice(0, 80);
    if (k && !seen[k]) {
      seen[k] = true;
      list.push(k);
    }
  }
  if (!list.length) return {};
  const res = await query(
    'SELECT DISTINCT ON (title_key) title_key, voice, picks FROM watch_voice' +
      ' WHERE title_key = ANY($1::text[]) AND picks > 0 ORDER BY title_key, picks DESC, voice',
    [list],
  );
  const out = {};
  for (let i = 0; i < res.rows.length; i++) out[res.rows[i].title_key] = res.rows[i].voice || '';
  return out;
}

async function addStats(query, row, delta, now) {
  await query(
    'INSERT INTO watch_release_stats (infohash, file_index, device_class, title_key, title, season, episode,' +
      ' samples, completed, switched, ttff_ms, rebuffer_n, rebuffer_ms, watched_sum, codec_ok, codec_fail, updated_at)' +
      ' VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)' +
      ' ON CONFLICT (infohash, file_index, device_class) DO UPDATE SET' +
      ' title_key = CASE WHEN EXCLUDED.title_key <> \'\' THEN EXCLUDED.title_key ELSE watch_release_stats.title_key END,' +
      ' title = CASE WHEN EXCLUDED.title <> \'\' THEN EXCLUDED.title ELSE watch_release_stats.title END,' +
      ' season = CASE WHEN EXCLUDED.season > 0 THEN EXCLUDED.season ELSE watch_release_stats.season END,' +
      ' episode = CASE WHEN EXCLUDED.episode > 0 THEN EXCLUDED.episode ELSE watch_release_stats.episode END,' +
      ' samples = GREATEST(0, watch_release_stats.samples + EXCLUDED.samples),' +
      ' completed = GREATEST(0, watch_release_stats.completed + EXCLUDED.completed),' +
      ' switched = GREATEST(0, watch_release_stats.switched + EXCLUDED.switched),' +
      ' ttff_ms = GREATEST(0, watch_release_stats.ttff_ms + EXCLUDED.ttff_ms),' +
      ' rebuffer_n = GREATEST(0, watch_release_stats.rebuffer_n + EXCLUDED.rebuffer_n),' +
      ' rebuffer_ms = GREATEST(0, watch_release_stats.rebuffer_ms + EXCLUDED.rebuffer_ms),' +
      ' watched_sum = GREATEST(0, watch_release_stats.watched_sum + EXCLUDED.watched_sum),' +
      ' codec_ok = GREATEST(0, watch_release_stats.codec_ok + EXCLUDED.codec_ok),' +
      ' codec_fail = GREATEST(0, watch_release_stats.codec_fail + EXCLUDED.codec_fail),' +
      ' updated_at = EXCLUDED.updated_at',
    [
      row.infohash,
      row.fileIndex,
      row.deviceClass,
      row.titleKey,
      row.title,
      row.season,
      row.episode,
      delta.samples,
      delta.completed,
      delta.switched,
      delta.ttffMs,
      delta.rebufferN,
      delta.rebufferMs,
      delta.watchedSum,
      delta.codecOk,
      delta.codecFail,
      now,
    ],
  );
}

async function addVoice(query, titleKey, voice, delta, now) {
  if (!titleKey || !voice || !delta) return;
  await query(
    'INSERT INTO watch_voice (title_key, voice, picks, updated_at) VALUES ($1,$2,$3,$4)' +
      ' ON CONFLICT (title_key, voice) DO UPDATE SET' +
      ' picks = GREATEST(0, watch_voice.picks + EXCLUDED.picks), updated_at = EXCLUDED.updated_at',
    [titleKey, voice, delta, now],
  );
}

async function addCodecs(query, deviceClass, codecs, now) {
  for (let i = 0; i < codecs.length; i++) {
    await query(
      'INSERT INTO watch_codec (device_class, codec, reports, updated_at) VALUES ($1,$2,1,$3)' +
        ' ON CONFLICT (device_class, codec) DO UPDATE SET reports = watch_codec.reports + 1, updated_at = EXCLUDED.updated_at',
      [deviceClass, codecs[i], now],
    );
  }
}

function prevVote(row) {
  if (!row) return null;
  return {
    deviceClass: row.device_class,
    titleKey: row.title_key || '',
    voice: row.voice || '',
    completed: row.completed === true,
    switched: row.switched === true,
    ttffMs: num(row.ttff_ms),
    rebufferN: num(row.rebuffer_n),
    rebufferMs: num(row.rebuffer_ms),
    watchedPct: num(row.watched_pct),
    codecOk: row.codec_known === true ? row.codec_ok === true : null,
  };
}

export async function saveSignals(tx, voter, items, now) {
  if (!voter || !items.length) return 0;
  let n = 0;
  await tx(async (query) => {
    for (let i = 0; i < items.length; i++) {
      const row = items[i];
      await query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [voter + ':' + row.infohash + ':' + row.fileIndex]);
      const found = await query(
        'SELECT device_class, title_key, voice, ttff_ms, rebuffer_n, rebuffer_ms, watched_pct, completed, switched, codec_ok, codec_known' +
          ' FROM watch_votes WHERE voter = $1 AND infohash = $2 AND file_index = $3 FOR UPDATE',
        [voter, row.infohash, row.fileIndex],
      );
      const prev = prevVote(found.rows[0]);
      if (prev && prev.deviceClass !== row.deviceClass) {
        await addStats(query, Object.assign({}, row, { deviceClass: prev.deviceClass }), removeDelta(prev), now);
        await addStats(query, row, voteDelta(null, row), now);
      } else {
        await addStats(query, row, voteDelta(prev, row), now);
      }
      if (!prev || prev.voice !== row.voice || prev.titleKey !== row.titleKey) {
        if (prev && prev.voice) await addVoice(query, prev.titleKey, prev.voice, -1, now);
        if (row.voice) await addVoice(query, row.titleKey, row.voice, 1, now);
      }
      if (!prev && row.codecs && row.codecs.length) await addCodecs(query, row.deviceClass, row.codecs, now);
      await query(
        'INSERT INTO watch_votes (voter, infohash, file_index, device_class, title_key, season, episode,' +
          ' ttff_ms, rebuffer_n, rebuffer_ms, watched_pct, completed, switched, voice, codec_ok, codec_known, updated_at)' +
          ' VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)' +
          ' ON CONFLICT (voter, infohash, file_index) DO UPDATE SET' +
          ' device_class = EXCLUDED.device_class, title_key = EXCLUDED.title_key, season = EXCLUDED.season,' +
          ' episode = EXCLUDED.episode, ttff_ms = EXCLUDED.ttff_ms, rebuffer_n = EXCLUDED.rebuffer_n,' +
          ' rebuffer_ms = EXCLUDED.rebuffer_ms, watched_pct = EXCLUDED.watched_pct, completed = EXCLUDED.completed,' +
          ' switched = EXCLUDED.switched, voice = EXCLUDED.voice, codec_ok = EXCLUDED.codec_ok,' +
          ' codec_known = EXCLUDED.codec_known, updated_at = EXCLUDED.updated_at',
        [
          voter,
          row.infohash,
          row.fileIndex,
          row.deviceClass,
          row.titleKey,
          row.season,
          row.episode,
          row.ttffMs,
          row.rebufferN,
          row.rebufferMs,
          row.watchedPct,
          row.completed,
          row.switched,
          row.voice,
          row.codecOk === true,
          row.codecOk === true || row.codecOk === false,
          now,
        ],
      );
      if (row.follow && row.titleKey) {
        await query(
          'INSERT INTO watch_follow (voter, title_key, title, season, episode, device_class, infohash, updated_at)' +
            ' VALUES ($1,$2,$3,$4,$5,$6,$7,$8)' +
            ' ON CONFLICT (voter, title_key) DO UPDATE SET title = EXCLUDED.title, season = EXCLUDED.season,' +
            ' episode = EXCLUDED.episode, device_class = EXCLUDED.device_class, infohash = EXCLUDED.infohash,' +
            ' updated_at = EXCLUDED.updated_at',
          [voter, row.titleKey, row.title, row.season, row.episode, row.deviceClass, row.infohash, now],
        );
      }
      n += 1;
    }
  });
  return n;
}

export async function saveSeen(query, items, now) {
  const list = [];
  const seen = {};
  for (let i = 0; i < items.length && list.length < 40; i++) {
    const it = items[i];
    if (!it.infohash || seen[it.infohash]) continue;
    seen[it.infohash] = true;
    list.push(it);
  }
  if (!list.length) return;
  const at = [];
  for (let i = 0; i < list.length; i++) at.push(now);
  await query(
    'INSERT INTO watch_seen (infohash, title, title_key, season, episode, seeds, dht_seeds, size_bytes, updated_at)' +
      ' SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::int[], $5::int[], $6::int[], $7::int[], $8::bigint[], $9::bigint[])' +
      ' ON CONFLICT (infohash) DO UPDATE SET' +
      ' title = CASE WHEN EXCLUDED.title <> \'\' THEN EXCLUDED.title ELSE watch_seen.title END,' +
      ' title_key = CASE WHEN EXCLUDED.title_key <> \'\' THEN EXCLUDED.title_key ELSE watch_seen.title_key END,' +
      ' season = CASE WHEN EXCLUDED.season > 0 THEN EXCLUDED.season ELSE watch_seen.season END,' +
      ' episode = CASE WHEN EXCLUDED.episode > 0 THEN EXCLUDED.episode ELSE watch_seen.episode END,' +
      ' seeds = GREATEST(watch_seen.seeds, EXCLUDED.seeds),' +
      ' dht_seeds = GREATEST(watch_seen.dht_seeds, EXCLUDED.dht_seeds),' +
      ' size_bytes = GREATEST(watch_seen.size_bytes, EXCLUDED.size_bytes),' +
      ' updated_at = EXCLUDED.updated_at',
    [
      list.map((it) => it.infohash),
      list.map((it) => it.title || ''),
      list.map((it) => it.titleKey || ''),
      list.map((it) => it.season || 0),
      list.map((it) => it.episode || 0),
      list.map((it) => it.seeds || 0),
      list.map((it) => it.dhtSeeds || 0),
      list.map((it) => it.sizeBytes || 0),
      at,
    ],
  );
}

export async function probesFor(query, hashes) {
  const list = [];
  const seen = {};
  for (let i = 0; i < hashes.length; i++) {
    const h = normalizeInfohash(hashes[i]);
    if (h && !seen[h]) {
      seen[h] = true;
      list.push(h);
    }
  }
  if (!list.length) return {};
  const res = await query(
    'SELECT infohash, max(seeders)::int AS seeders, max(dht_seeds)::int AS dht_seeds' +
      ' FROM seed_probes WHERE infohash = ANY($1::text[]) GROUP BY infohash',
    [list],
  );
  const out = {};
  for (let i = 0; i < res.rows.length; i++) {
    out[res.rows[i].infohash] = { seeds: num(res.rows[i].seeders), dhtSeeds: num(res.rows[i].dht_seeds) };
  }
  return out;
}

export async function rankSearchXml(repo, xml, opts) {
  const o = opts || {};
  const parsed = parseFeed(xml);
  if (!parsed.items.length) return xml;
  const hashes = parsed.items.map((it) => it.infohash);
  const keys = parsed.items.map((it) => it.titleKey);
  const stats = await repo.statsFor(hashes, o.deviceClass);
  const mods = await repo.modsFor(hashes);
  const voices = await repo.voicesFor(keys);
  const probes = repo.probesFor ? await repo.probesFor(hashes) : {};
  const rendered = renderFeed(parsed, { stats, mods, voices, probes, deviceClass: o.deviceClass });
  if (!o.readOnly) {
    try {
      await repo.saveSeen(parsed.items, o.now || Date.now());
    } catch (e) {
      /* a missed seen row must not fail search */
    }
  }
  return rendered.xml;
}

export async function readBest(query, key) {
  const deviceClass = deviceClassOf(key.deviceClass);
  const titleKey = titleKeyOf(key.titleKey, '');
  if (!titleKey) return null;
  const season = num(key.season);
  const episode = num(key.episode);
  const exact = await query(
    'SELECT b.title_key, b.season, b.episode, b.device_class, b.infohash, b.title, b.score, b.reason, b.voice, b.seeds' +
      ' FROM watch_best b WHERE b.title_key = $1 AND b.season = $2 AND b.episode = $3 AND b.device_class = $4' +
      ' AND NOT EXISTS (SELECT 1 FROM watch_mod m WHERE m.infohash = b.infohash AND m.banned)',
    [titleKey, season, episode, deviceClass],
  );
  if (exact.rows[0]) return bestOf(exact.rows[0]);
  const loose = await query(
    'SELECT b.title_key, b.season, b.episode, b.device_class, b.infohash, b.title, b.score, b.reason, b.voice, b.seeds' +
      ' FROM watch_best b WHERE b.title_key = $1 AND b.device_class = $2 AND ($3 = 0 OR b.season = $3)' +
      ' AND NOT EXISTS (SELECT 1 FROM watch_mod m WHERE m.infohash = b.infohash AND m.banned)' +
      ' ORDER BY b.episode DESC LIMIT 1',
    [titleKey, deviceClass, season],
  );
  return loose.rows[0] ? bestOf(loose.rows[0]) : null;
}

function bestOf(r) {
  return {
    titleKey: r.title_key,
    season: num(r.season),
    episode: num(r.episode),
    deviceClass: r.device_class,
    infohash: r.infohash || '',
    title: r.title || '',
    score: num(r.score),
    reason: r.reason || '',
    voice: r.voice || '',
    seeds: num(r.seeds),
  };
}

export async function setMod(query, row, now) {
  const infohash = normalizeInfohash(row.infohash);
  if (!infohash) return false;
  const banned = row.banned === true;
  const pinned = row.pinned === true && !banned;
  const note = String(row.note || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (banned) await query('DELETE FROM watch_best WHERE infohash = $1', [infohash]);
  await query(
    'INSERT INTO watch_mod (infohash, pinned, banned, note, updated_at) VALUES ($1,$2,$3,$4,$5)' +
      ' ON CONFLICT (infohash) DO UPDATE SET pinned = EXCLUDED.pinned, banned = EXCLUDED.banned,' +
      ' note = EXCLUDED.note, updated_at = EXCLUDED.updated_at',
    [infohash, pinned, banned, note, now],
  );
  return true;
}

function like(q) {
  return '%' + String(q || '').replace(/[\\%_]/g, '\\$&') + '%';
}

export async function adminRows(query, q) {
  const text = String(q || '').trim().slice(0, 80);
  const res = await query(
    'SELECT s.infohash, s.file_index, s.device_class, s.title_key, s.title, s.season, s.episode,' +
      ' s.samples, s.completed, s.switched, s.ttff_ms, s.rebuffer_n, s.rebuffer_ms, s.watched_sum,' +
      ' s.codec_ok, s.codec_fail, s.updated_at, m.pinned, m.banned, m.note' +
      ' FROM watch_release_stats s LEFT JOIN watch_mod m ON m.infohash = s.infohash' +
      ' WHERE $1 = \'\' OR s.infohash = $2 OR s.title_key ILIKE $3 ESCAPE \'\\\' OR s.title ILIKE $3 ESCAPE \'\\\'' +
      ' ORDER BY s.samples DESC, s.updated_at DESC LIMIT 60',
    [text ? 'x' : '', normalizeInfohash(text) || text.toLowerCase(), like(text)],
  );
  const keys = [];
  const seen = {};
  for (let i = 0; i < res.rows.length; i++) {
    const k = res.rows[i].title_key || '';
    if (k && !seen[k]) {
      seen[k] = true;
      keys.push(k);
    }
  }
  const voices = keys.length
    ? await query(
        'SELECT title_key, voice, picks FROM watch_voice WHERE title_key = ANY($1::text[]) AND picks > 0 ORDER BY picks DESC LIMIT 200',
        [keys],
      )
    : { rows: [] };
  const codecs = await query('SELECT device_class, codec, reports FROM watch_codec ORDER BY reports DESC LIMIT 20');
  return {
    rows: res.rows.map((r) => ({
      infohash: r.infohash,
      fileIndex: num(r.file_index),
      deviceClass: r.device_class,
      titleKey: r.title_key || '',
      title: r.title || '',
      season: num(r.season),
      episode: num(r.episode),
      samples: num(r.samples),
      completed: num(r.completed),
      switched: num(r.switched),
      ttffMs: num(r.ttff_ms),
      rebufferN: num(r.rebuffer_n),
      rebufferMs: num(r.rebuffer_ms),
      watchedSum: num(r.watched_sum),
      codecOk: num(r.codec_ok),
      codecFail: num(r.codec_fail),
      pinned: r.pinned === true,
      banned: r.banned === true,
      note: r.note || '',
      updatedAt: num(r.updated_at),
    })),
    voices: voices.rows.map((r) => ({ titleKey: r.title_key, voice: r.voice, picks: num(r.picks) })),
    codecs: codecs.rows.map((r) => ({ deviceClass: r.device_class, codec: r.codec, reports: num(r.reports) })),
  };
}

export async function followGroups(query, now) {
  const res = await query(
    'SELECT title_key, max(title) AS title, season, max(episode) AS episode, device_class, count(*)::int AS watchers' +
      ' FROM watch_follow WHERE updated_at > $1 GROUP BY title_key, season, device_class' +
      ' ORDER BY count(*) DESC LIMIT 30',
    [now - 21 * DAY],
  );
  return res.rows.map((r) => ({
    titleKey: r.title_key,
    title: r.title || '',
    season: num(r.season),
    episode: num(r.episode),
    deviceClass: deviceClassOf(r.device_class),
    watchers: num(r.watchers),
  }));
}

export async function releasesForTitle(query, titleKey, deviceClass) {
  const stats = await query(
    'SELECT infohash, title, title_key, season, episode, samples, completed, switched, ttff_ms, rebuffer_n,' +
      ' rebuffer_ms, watched_sum, codec_ok, codec_fail FROM watch_release_stats' +
      ' WHERE title_key = $1 AND device_class = $2',
    [titleKey, deviceClass],
  );
  const seen = await query(
    'SELECT infohash, title, title_key, season, episode, seeds, dht_seeds, size_bytes FROM watch_seen WHERE title_key = $1',
    [titleKey],
  );
  const hashes = [];
  const have = {};
  for (let i = 0; i < stats.rows.length; i++) if (!have[stats.rows[i].infohash]) {
    have[stats.rows[i].infohash] = true;
    hashes.push(stats.rows[i].infohash);
  }
  for (let i = 0; i < seen.rows.length; i++) if (!have[seen.rows[i].infohash]) {
    have[seen.rows[i].infohash] = true;
    hashes.push(seen.rows[i].infohash);
  }
  const mods = await modsFor(query, hashes);
  return {
    stats: stats.rows.map((r) => Object.assign({ infohash: r.infohash }, statsOf(r))),
    seen: seen.rows.map((r) => ({
      infohash: r.infohash,
      title: r.title || '',
      titleKey: r.title_key || '',
      season: num(r.season),
      episode: num(r.episode),
      seeds: num(r.seeds),
      dhtSeeds: num(r.dht_seeds),
      sizeBytes: num(r.size_bytes),
    })),
    mods,
  };
}

export async function writeBest(query, row, now) {
  await query(
    'INSERT INTO watch_best (title_key, season, episode, device_class, infohash, title, score, reason, voice, seeds, size_bytes, updated_at, warmed_at)' +
      ' VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,0)' +
      ' ON CONFLICT (title_key, season, episode, device_class) DO UPDATE SET' +
      ' title = EXCLUDED.title, score = EXCLUDED.score, reason = EXCLUDED.reason, voice = EXCLUDED.voice,' +
      ' seeds = EXCLUDED.seeds, size_bytes = EXCLUDED.size_bytes, updated_at = EXCLUDED.updated_at,' +
      ' warmed_at = CASE WHEN watch_best.infohash = EXCLUDED.infohash THEN watch_best.warmed_at ELSE 0 END,' +
      ' infohash = EXCLUDED.infohash',
    [
      row.titleKey,
      row.season,
      row.episode,
      row.deviceClass,
      row.infohash,
      row.title || '',
      row.score,
      row.reason,
      row.voice || '',
      row.seeds || 0,
      row.sizeBytes || 0,
      now,
    ],
  );
}

export async function dueWarm(query, now) {
  const res = await query(
    'SELECT b.title_key, b.season, b.episode, b.device_class, b.infohash, b.title, b.seeds, b.size_bytes FROM watch_best b' +
      ' WHERE b.infohash <> \'\' AND b.seeds > 0 AND b.warmed_at < $1' +
      ' AND NOT EXISTS (SELECT 1 FROM watch_mod m WHERE m.infohash = b.infohash AND m.banned) LIMIT 40',
    [now - DAY],
  );
  return res.rows.map((r) => ({
    titleKey: r.title_key,
    season: num(r.season),
    episode: num(r.episode),
    deviceClass: r.device_class,
    infohash: r.infohash,
    title: r.title || '',
    seeds: num(r.seeds),
    sizeBytes: num(r.size_bytes),
  }));
}

export async function markWarmed(query, row, now) {
  await query(
    'UPDATE watch_best SET warmed_at = $5 WHERE title_key = $1 AND season = $2 AND episode = $3 AND device_class = $4',
    [row.titleKey, row.season, row.episode, row.deviceClass, now],
  );
}

export async function pruneWatch(query, now) {
  // Drop the vote and take its contribution back, so a later watch is not a second sample.
  await query(
    'WITH old AS (DELETE FROM watch_votes WHERE updated_at < $1 RETURNING *),' +
      ' voice_fix AS (' +
      ' UPDATE watch_voice v SET picks = GREATEST(0, v.picks - c.n), updated_at = $1' +
      ' FROM (SELECT title_key, voice, count(*)::int AS n FROM old WHERE voice <> \'\' GROUP BY title_key, voice) c' +
      ' WHERE v.title_key = c.title_key AND v.voice = c.voice RETURNING 1)' +
      ' UPDATE watch_release_stats s SET' +
      ' samples = GREATEST(0, s.samples - c.n),' +
      ' completed = GREATEST(0, s.completed - c.completed),' +
      ' switched = GREATEST(0, s.switched - c.switched),' +
      ' ttff_ms = GREATEST(0, s.ttff_ms - c.ttff_ms),' +
      ' rebuffer_n = GREATEST(0, s.rebuffer_n - c.rebuffer_n),' +
      ' rebuffer_ms = GREATEST(0, s.rebuffer_ms - c.rebuffer_ms),' +
      ' watched_sum = GREATEST(0, s.watched_sum - c.watched_sum),' +
      ' codec_ok = GREATEST(0, s.codec_ok - c.codec_ok),' +
      ' codec_fail = GREATEST(0, s.codec_fail - c.codec_fail),' +
      ' updated_at = $1' +
      ' FROM (' +
      ' SELECT infohash, file_index, device_class, count(*)::int AS n,' +
      ' sum(CASE WHEN completed THEN 1 ELSE 0 END)::int AS completed,' +
      ' sum(CASE WHEN switched THEN 1 ELSE 0 END)::int AS switched,' +
      ' sum(ttff_ms)::bigint AS ttff_ms, sum(rebuffer_n)::int AS rebuffer_n, sum(rebuffer_ms)::bigint AS rebuffer_ms,' +
      ' sum(watched_pct)::int AS watched_sum,' +
      ' sum(CASE WHEN codec_known AND codec_ok THEN 1 ELSE 0 END)::int AS codec_ok,' +
      ' sum(CASE WHEN codec_known AND NOT codec_ok THEN 1 ELSE 0 END)::int AS codec_fail' +
      ' FROM old GROUP BY infohash, file_index, device_class) c' +
      ' WHERE s.infohash = c.infohash AND s.file_index = c.file_index AND s.device_class = c.device_class',
    [now - FOLLOW_KEEP],
  );
  await query('DELETE FROM watch_follow WHERE updated_at < $1', [now - FOLLOW_KEEP]);
  await query('DELETE FROM watch_seen WHERE updated_at < $1', [now - SEEN_KEEP]);
}

export function createWatchRepo(store) {
  const query = (sql, params) => store.query(sql, params);
  const tx = store.withClient ? (fn) => store.withClient(fn) : async (fn) => fn(query);
  return {
    query,
    tx,
    statsFor: (hashes, deviceClass) => statsFor(query, hashes, deviceClass),
    probesFor: (hashes) => probesFor(query, hashes),
    modsFor: (hashes) => modsFor(query, hashes),
    voicesFor: (keys) => voicesFor(query, keys),
    saveSeen: (items, now) => saveSeen(query, items, now),
    saveSignals: (voter, items, now) => saveSignals(tx, voter, items, now),
    readBest: (key) => readBest(query, key),
    setMod: (row, now) => setMod(query, row, now),
    adminRows: (q) => adminRows(query, q),
    followGroups: (now) => followGroups(query, now),
    releasesForTitle: (titleKey, deviceClass) => releasesForTitle(query, titleKey, deviceClass),
    writeBest: (row, now) => writeBest(query, row, now),
    dueWarm: (now) => dueWarm(query, now),
    markWarmed: (row, now) => markWarmed(query, row, now),
    prune: (now) => pruneWatch(query, now),
  };
}

export { parseSignalBody, voterHash };
