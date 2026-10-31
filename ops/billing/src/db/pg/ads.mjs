/**
 * Ad tables (schema migration 003_ads): uploaded banner images and the daily counters. Plain SQL on the
 * store's pool, outside the state snapshot: an impression must not rewrite the billing state.
 */

/** Add impressions and clicks to the day's rows (one statement, merged per key by the caller). */
export async function bumpAdStats(q, day, rows) {
  const list = (rows || []).filter((r) => r.impressions > 0 || r.clicks > 0);
  if (!list.length) return 0;
  const params = [];
  const tuples = list.map((r) => {
    params.push(day, r.banner, r.section, r.platform, r.impressions, r.clicks);
    const k = params.length;
    return '($' + (k - 5) + ', $' + (k - 4) + ', $' + (k - 3) + ', $' + (k - 2) + ', $' + (k - 1) + ', $' + k + ')';
  });
  await q.query(
    'INSERT INTO ad_stats (day, banner_id, section, platform, impressions, clicks) VALUES ' +
      tuples.join(', ') +
      ' ON CONFLICT (day, banner_id, section, platform) DO UPDATE SET impressions = ad_stats.impressions + EXCLUDED.impressions,' +
      ' clicks = ad_stats.clicks + EXCLUDED.clicks',
    params,
  );
  return list.length;
}

/** Rows since `fromDay` (YYYY-MM-DD, MSK), oldest first. */
export async function adStatsSince(q, fromDay) {
  const r = await q.query(
    'SELECT day, banner_id, section, platform, impressions, clicks FROM ad_stats WHERE day >= $1 ORDER BY day, banner_id, section, platform',
    [fromDay],
  );
  return r.rows.map((x) => ({
    day: x.day,
    banner: x.banner_id,
    section: x.section,
    platform: x.platform,
    impressions: Number(x.impressions) || 0,
    clicks: Number(x.clicks) || 0,
  }));
}

/** Retention: delete the days before `cutoffDay`. Returns the count. */
export async function pruneAdStats(q, cutoffDay) {
  const r = await q.query('DELETE FROM ad_stats WHERE day < $1', [cutoffDay]);
  return r.rowCount || 0;
}

/** Insert an image. The same id again (a re-upload of unused bytes) moves created_at forward so grace starts over. */
export async function putAdImage(q, img, now) {
  await q.query(
    'INSERT INTO ad_images (id, mime, bytes, size, created_at) VALUES ($1, $2, $3, $4, $5)' +
      ' ON CONFLICT (id) DO UPDATE SET created_at = EXCLUDED.created_at',
    [img.id, img.mime, img.bytes, img.bytes.length, Number(now) || Date.now()],
  );
  return img.id;
}

export async function getAdImage(q, id) {
  const r = await q.query('SELECT id, mime, bytes FROM ad_images WHERE id = $1', [String(id || '')]);
  return r.rows[0] || null;
}

/**
 * Delete images no banner uses, older than `graceMs` (a picture uploaded for a banner that is still being filled in
 * survives until the form is saved). Returns the count.
 */
export async function gcAdImages(q, keepIds, now, graceMs) {
  const before = (Number(now) || Date.now()) - (graceMs === undefined ? 24 * 60 * 60 * 1000 : graceMs);
  const r = await q.query('DELETE FROM ad_images WHERE NOT (id = ANY($1)) AND created_at < $2', [keepIds || [], before]);
  return r.rowCount || 0;
}
