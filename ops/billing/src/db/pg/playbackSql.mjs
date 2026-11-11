// Playback position per account, title and episode (schema migration 008_playback_progress).
// Outside the billing state snapshot. One row per account, title key and episode key.

const KEEP = 200;

function num(v) {
  const n = Math.floor(Number(v) || 0);
  return n > 0 ? n : 0;
}

function rowOf(r) {
  if (!r) return null;
  return {
    positionSec: num(r.position_sec),
    durationSec: num(r.duration_sec),
    updatedAt: num(r.updated_at),
    deviceId: typeof r.device_id === 'string' ? r.device_id : '',
    label: typeof r.label === 'string' ? r.label : '',
    title: typeof r.title === 'string' ? r.title : '',
    episodeKey: typeof r.episode_key === 'string' ? r.episode_key : '',
  };
}

export async function loadProgress(query, accountId, titleKey, episodeKey) {
  const params = [accountId, titleKey];
  let sql =
    'SELECT position_sec, duration_sec, updated_at, device_id, label, title, episode_key' +
    ' FROM playback_progress WHERE account_id = $1 AND title_key = $2';
  if (episodeKey) {
    sql += ' AND episode_key = $3';
    params.push(episodeKey);
  }
  sql += ' ORDER BY updated_at DESC LIMIT 1';
  const res = await query(sql, params);
  return rowOf(res.rows[0]);
}

export async function saveProgress(query, accountId, row, now) {
  await query(
    'INSERT INTO playback_progress (account_id, title_key, episode_key, position_sec, duration_sec, title, label, device_id, updated_at)' +
      ' VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)' +
      ' ON CONFLICT (account_id, title_key, episode_key) DO UPDATE SET' +
      ' position_sec = EXCLUDED.position_sec, duration_sec = EXCLUDED.duration_sec,' +
      ' title = EXCLUDED.title, label = EXCLUDED.label, device_id = EXCLUDED.device_id, updated_at = EXCLUDED.updated_at',
    [
      accountId,
      row.titleKey,
      row.episodeKey,
      num(row.positionSec),
      num(row.durationSec),
      String(row.title || '').slice(0, 180),
      String(row.label || '').slice(0, 80),
      String(row.deviceId || '').slice(0, 80),
      now,
    ],
  );
  await query(
    'DELETE FROM playback_progress AS p USING (' +
      ' SELECT title_key, episode_key FROM playback_progress WHERE account_id = $1 ORDER BY updated_at DESC OFFSET $2' +
      ' ) AS old WHERE p.account_id = $1 AND p.title_key = old.title_key AND p.episode_key = old.episode_key',
    [accountId, KEEP],
  );
}

export function createPlaybackStore(store) {
  const query = (sql, params) => store.query(sql, params);
  return {
    load: (accountId, titleKey, episodeKey) => loadProgress(query, accountId, titleKey, episodeKey),
    save: (accountId, row, now) => saveProgress(query, accountId, row, now),
  };
}
