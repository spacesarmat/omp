// Precompute the best release for titles people are watching, and tell the cache
// popularity job (cacheNodes.noteInterest) once a day. The cache flag still decides
// whether a node is asked to fill anything. This only adds interest rows.
import { cacheEnabled } from './cacheNodes.mjs';
import { blendScore, coldScore, learnedScore, releasesToWarm } from './watchRank.mjs';

function candidate(infohash, title, season, episode, seeds, dhtSeeds, sizeBytes, stats) {
  return {
    infohash,
    title: title || '',
    season: season || 0,
    episode: episode || 0,
    seeds: seeds || 0,
    dhtSeeds: dhtSeeds || 0,
    sizeBytes: sizeBytes || 0,
    stats: stats || null,
  };
}

function scoredRow(row, deviceClass, voice, mods) {
  const mod = mods[row.infohash];
  if (mod && mod.banned) return null;
  const samples = row.stats && row.stats.samples > 0 ? row.stats.samples : 0;
  const learned = samples > 0 ? learnedScore(row.stats, deviceClass, row.title) : null;
  const score = blendScore(learned, coldScore(row.seeds, row.dhtSeeds), samples);
  let reason = samples >= 3 ? 'community' : samples > 0 ? 'blend' : row.dhtSeeds > 0 && !(row.seeds > 0) ? 'dht' : 'seeds';
  let rank = score;
  if (mod && mod.pinned) {
    reason = 'pinned';
    rank += 1000;
  }
  return {
    infohash: row.infohash,
    title: row.title,
    season: row.season,
    episode: row.episode,
    score: Math.round(rank * 100),
    reason,
    voice: voice || '',
    seeds: row.seeds > 0 ? row.seeds : row.dhtSeeds,
    sizeBytes: row.sizeBytes,
    banned: false,
  };
}

/** One best release per season and episode. A season pack (episode 0) also fills `focus`. */
export function chooseBests(pack, deviceClass, voice, focus) {
  const byHash = {};
  const stats = (pack && pack.stats) || [];
  const seen = (pack && pack.seen) || [];
  const mods = (pack && pack.mods) || {};
  for (let i = 0; i < stats.length; i++) {
    const row = stats[i];
    byHash[row.infohash] = candidate(row.infohash, row.title, row.season, row.episode, 0, 0, 0, row);
  }
  for (let i = 0; i < seen.length; i++) {
    const row = seen[i];
    const cur = byHash[row.infohash] || candidate(row.infohash, row.title, row.season, row.episode, 0, 0, 0, null);
    cur.title = cur.title || row.title;
    cur.seeds = row.seeds > cur.seeds ? row.seeds : cur.seeds;
    cur.dhtSeeds = row.dhtSeeds > cur.dhtSeeds ? row.dhtSeeds : cur.dhtSeeds;
    cur.sizeBytes = row.sizeBytes > cur.sizeBytes ? row.sizeBytes : cur.sizeBytes;
    if (!cur.season) cur.season = row.season;
    if (!cur.episode) cur.episode = row.episode;
    byHash[row.infohash] = cur;
  }
  const best = {};
  const put = (season, episode, row) => {
    const key = season + ':' + episode;
    const prev = best[key];
    if (!prev || row.score > prev.score) {
      best[key] = {
        infohash: row.infohash,
        title: row.title,
        season,
        episode,
        score: row.score,
        reason: row.reason,
        voice: row.voice,
        seeds: row.seeds,
        sizeBytes: row.sizeBytes,
      };
    }
  };
  const keys = Object.keys(byHash);
  for (let i = 0; i < keys.length; i++) {
    const scored = scoredRow(byHash[keys[i]], deviceClass, voice, mods);
    if (!scored) continue;
    put(scored.season, scored.episode, scored);
    if (scored.episode === 0 && focus && focus.episode > 0) put(focus.season || scored.season, focus.episode, scored);
  }
  return Object.keys(best).map((k) => best[k]);
}

/**
 * Recompute watch_best and, when cache nodes are on, noteInterest for releases
 * that have not been handed to the cache in the last day.
 */
export async function runWatchFollow(repo, cacheRepo, settings, now) {
  const at = now || Date.now();
  const groups = await repo.followGroups(at);
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    const pack = await repo.releasesForTitle(g.titleKey, g.deviceClass);
    const voices = await repo.voicesFor([g.titleKey]);
    const list = chooseBests(pack, g.deviceClass, voices[g.titleKey] || '', { season: g.season, episode: g.episode });
    for (let j = 0; j < list.length; j++) {
      const best = list[j];
      await repo.writeBest(
        {
          titleKey: g.titleKey,
          season: best.season || g.season,
          episode: best.episode || g.episode,
          deviceClass: g.deviceClass,
          infohash: best.infohash,
          title: best.title || g.title,
          score: best.score,
          reason: best.reason,
          voice: best.voice,
          seeds: best.seeds,
          sizeBytes: best.sizeBytes,
        },
        at,
      );
    }
  }
  let warmed = 0;
  if (cacheRepo && cacheEnabled(settings) && typeof cacheRepo.noteInterest === 'function') {
    const due = await repo.dueWarm(at);
    const rows = releasesToWarm(due);
    const wanted = {};
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      await cacheRepo.noteInterest(
        { infohash: row.infohash, title: row.title, event: 'play', seeders: row.seeds, sizeBytes: row.sizeBytes },
        at,
      );
      wanted[row.infohash] = true;
      warmed += 1;
    }
    for (let i = 0; i < due.length; i++) {
      if (wanted[due[i].infohash]) await repo.markWarmed(due[i], at);
    }
  }
  try {
    await repo.prune(at);
  } catch (e) {
    /* pruning is best effort */
  }
  return { titles: groups.length, warmed };
}

export function startWatchFollow(repo, cacheRepo, readSettings) {
  if (!repo || typeof repo.followGroups !== 'function') return () => {};
  let stopped = false;
  const tick = () => {
    if (stopped) return;
    Promise.resolve()
      .then(() => readSettings())
      .then((settings) => runWatchFollow(repo, cacheRepo, settings, Date.now()))
      .then(
        (r) => {
          if (r && (r.titles || r.warmed)) process.stderr.write('watch-follow titles=' + r.titles + ' warmed=' + r.warmed + '\n');
        },
        () => process.stderr.write('watch-follow failed\n'),
      );
  };
  const first = setTimeout(tick, 2 * 60 * 1000);
  const timer = setInterval(tick, 15 * 60 * 1000);
  if (first.unref) first.unref();
  if (timer.unref) timer.unref();
  return () => {
    stopped = true;
    clearTimeout(first);
    clearInterval(timer);
  };
}
