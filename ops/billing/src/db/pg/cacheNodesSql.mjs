// Cache nodes, assignments and interest (migration 007). Outside the billing state snapshot.
// token_hash is sha256 hex. Queries never select it into a response object.

function num(v) {
  const n = Math.floor(Number(v) || 0);
  return n > 0 ? n : 0;
}

function nodeOf(r) {
  return {
    id: r.id,
    name: r.name,
    url: r.url,
    region: r.region || '',
    capacityBytes: num(r.capacity_bytes),
    status: r.status,
    lastHeartbeat: r.last_heartbeat === null || r.last_heartbeat === undefined ? 0 : num(r.last_heartbeat),
    hasToken: typeof r.token_hash === 'string' && r.token_hash.length > 0,
    diskUsedBytes: num(r.disk_used_bytes),
    diskTotalBytes: num(r.disk_total_bytes),
    torrserverOk: r.torrserver_ok === true,
    prefixMb: num(r.prefix_mb),
    prefixPercent: num(r.prefix_percent),
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
  };
}

function assignmentOf(r) {
  return {
    id: r.id,
    nodeId: r.node_id,
    nodeName: r.node_name || '',
    infohash: r.infohash,
    title: r.title || '',
    magnet: r.magnet || '',
    sizeBytes: num(r.size_bytes),
    prefixBytes: num(r.prefix_bytes),
    prefixPercent: num(r.prefix_percent),
    status: r.status,
    pinned: r.pinned === true,
    source: r.source === 'manual' ? 'manual' : 'auto',
    score: num(r.score),
    error: r.error || '',
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
    removedAt: r.removed_at ? num(r.removed_at) : 0,
    nodeStatus: r.node_status || '',
    url: r.node_url || '',
    nodeUrl: r.node_url || '',
    lastHeartbeat: r.last_heartbeat ? num(r.last_heartbeat) : 0,
    hasToken: r.node_has_token === true || (typeof r.token_hash === 'string' && r.token_hash.length > 0),
  };
}

const NODE_COLS =
  'id, name, url, region, capacity_bytes, status, last_heartbeat, token_hash, disk_used_bytes, disk_total_bytes, torrserver_ok, prefix_mb, prefix_percent, created_at, updated_at';

export async function insertNode(query, row) {
  await query(
    'INSERT INTO cache_nodes (' + NODE_COLS + ') VALUES ($1,$2,$3,$4,$5,$6,NULL,$7,0,0,false,$8,$9,$10,$10)',
    [
      row.id,
      row.name,
      row.url,
      row.region || '',
      num(row.capacityBytes),
      'active',
      row.tokenHash,
      num(row.prefixMb),
      num(row.prefixPercent),
      row.now,
    ],
  );
}

export async function updateNode(query, row) {
  await query(
    'UPDATE cache_nodes SET name = $2, url = $3, region = $4, capacity_bytes = $5, prefix_mb = $6, prefix_percent = $7, updated_at = $8 WHERE id = $1',
    [row.id, row.name, row.url, row.region || '', num(row.capacityBytes), num(row.prefixMb), num(row.prefixPercent), row.now],
  );
}

export async function setNodeStatus(query, id, status, now) {
  await query('UPDATE cache_nodes SET status = $2, updated_at = $3 WHERE id = $1', [id, status, now]);
}

export async function setTokenHash(query, id, tokenHash, now) {
  await query('UPDATE cache_nodes SET token_hash = $2, updated_at = $3 WHERE id = $1', [id, tokenHash, now]);
}

export async function findByTokenHash(query, tokenHash) {
  const res = await query('SELECT ' + NODE_COLS + ' FROM cache_nodes WHERE token_hash = $1 AND token_hash <> \'\'', [tokenHash]);
  if (!res.rows[0]) return null;
  const row = nodeOf(res.rows[0]);
  row.tokenHash = res.rows[0].token_hash;
  return row;
}

export async function getNode(query, id) {
  const res = await query('SELECT ' + NODE_COLS + ' FROM cache_nodes WHERE id = $1', [id]);
  return res.rows[0] ? nodeOf(res.rows[0]) : null;
}

export async function listNodes(query) {
  const res = await query('SELECT ' + NODE_COLS + ' FROM cache_nodes ORDER BY created_at ASC');
  return res.rows.map(nodeOf);
}

export async function touchHeartbeat(query, id, row) {
  await query(
    'UPDATE cache_nodes SET last_heartbeat = $2, disk_used_bytes = $3, disk_total_bytes = $4, torrserver_ok = $5, updated_at = $2 WHERE id = $1',
    [id, row.now, num(row.diskUsedBytes), num(row.diskTotalBytes), row.torrserverOk === true],
  );
}

export async function listAssignments(query, limit) {
  const cap = Math.min(2000, Math.max(1, num(limit) || 200));
  const res = await query(
    'SELECT a.id, a.node_id, n.name AS node_name, a.infohash, a.title, a.magnet, a.size_bytes, a.prefix_bytes, a.prefix_percent,' +
      ' a.status, a.pinned, a.source, a.score, a.error, a.created_at, a.updated_at, a.removed_at,' +
      ' n.status AS node_status, n.url AS node_url, n.last_heartbeat, (n.token_hash <> \'\') AS node_has_token' +
      ' FROM cache_assignments a JOIN cache_nodes n ON n.id = a.node_id' +
      ' ORDER BY a.updated_at DESC LIMIT $1',
    [cap],
  );
  return res.rows.map(assignmentOf);
}

export async function assignmentsForNode(query, nodeId) {
  const res = await query(
    'SELECT a.id, a.node_id, a.infohash, a.title, a.magnet, a.size_bytes, a.prefix_bytes, a.prefix_percent,' +
      ' a.status, a.pinned, a.source, a.score, a.error, a.created_at, a.updated_at, a.removed_at' +
      ' FROM cache_assignments a WHERE a.node_id = $1 AND a.status <> \'removed\' ORDER BY a.created_at ASC',
    [nodeId],
  );
  return res.rows.map(assignmentOf);
}

export async function sourcesForHash(query, infohash) {
  const res = await query(
    'SELECT a.id, a.node_id, a.infohash, a.title, a.prefix_bytes, a.status, n.status AS node_status, n.url AS node_url,' +
      ' n.last_heartbeat, (n.token_hash <> \'\') AS node_has_token' +
      ' FROM cache_assignments a JOIN cache_nodes n ON n.id = a.node_id WHERE a.infohash = $1',
    [infohash],
  );
  return res.rows.map(assignmentOf);
}

export async function upsertAssignment(query, row, now) {
  const id = row.id;
  await query(
    'INSERT INTO cache_assignments (id, node_id, infohash, title, magnet, size_bytes, prefix_bytes, prefix_percent, status, pinned, source, score, error, created_at, updated_at, removed_at)' +
      ' VALUES ($1,$2,$3,$4,$5,$6,$7,$8,\'assigned\',$9,$10,$11,\'\',$12,$12,NULL)' +
      ' ON CONFLICT (node_id, infohash) DO UPDATE SET title = EXCLUDED.title, magnet = EXCLUDED.magnet,' +
      ' size_bytes = EXCLUDED.size_bytes, prefix_bytes = EXCLUDED.prefix_bytes, prefix_percent = EXCLUDED.prefix_percent,' +
      ' status = \'assigned\', pinned = EXCLUDED.pinned, source = EXCLUDED.source, score = EXCLUDED.score,' +
      ' error = \'\', updated_at = EXCLUDED.updated_at, removed_at = NULL',
    [
      id,
      row.nodeId,
      row.infohash,
      row.title || '',
      row.magnet || '',
      num(row.sizeBytes),
      num(row.prefixBytes),
      num(row.prefixPercent),
      row.pinned === true,
      row.source === 'manual' ? 'manual' : 'auto',
      num(row.score),
      now,
    ],
  );
}

export async function dropAssignment(query, id, now) {
  await query(
    'UPDATE cache_assignments SET status = \'removed\', pinned = false, removed_at = $2, updated_at = $2 WHERE id = $1 AND pinned = false AND source = \'auto\'',
    [id, now],
  );
}

export async function unpinAssignment(query, id, now) {
  await query(
    'UPDATE cache_assignments SET status = \'removed\', pinned = false, removed_at = $2, updated_at = $2 WHERE id = $1',
    [id, now],
  );
}

const REPORT_STATUS = { assigned: true, caching: true, cached: true, failed: true };

export async function reportAssignment(query, nodeId, id, status, error, now) {
  if (!REPORT_STATUS[status]) return false;
  const res = await query(
    'UPDATE cache_assignments SET status = $3, error = $4, updated_at = $5 WHERE id = $1 AND node_id = $2 AND status <> \'removed\'',
    [id, nodeId, status, error || '', now],
  );
  return res.rowCount > 0;
}

export async function noteInterest(query, row, now) {
  const searches = row.event === 'play' ? 0 : 1;
  const plays = row.event === 'play' ? 1 : 0;
  await query(
    'INSERT INTO cache_interest (infohash, title, searches, plays, seeders, size_bytes, updated_at)' +
      ' VALUES ($1,$2,$3,$4,$5,$6,$7)' +
      ' ON CONFLICT (infohash) DO UPDATE SET' +
      ' title = CASE WHEN EXCLUDED.title <> \'\' THEN EXCLUDED.title ELSE cache_interest.title END,' +
      ' searches = cache_interest.searches + EXCLUDED.searches,' +
      ' plays = cache_interest.plays + EXCLUDED.plays,' +
      ' seeders = GREATEST(cache_interest.seeders, EXCLUDED.seeders),' +
      ' size_bytes = GREATEST(cache_interest.size_bytes, EXCLUDED.size_bytes),' +
      ' updated_at = EXCLUDED.updated_at',
    [row.infohash, row.title || '', searches, plays, num(row.seeders), num(row.sizeBytes), now],
  );
}

export async function listInterest(query, limit) {
  const cap = Math.min(1000, Math.max(1, num(limit) || 200));
  const res = await query(
    'SELECT infohash, title, searches, plays, seeders, size_bytes, updated_at FROM cache_interest ORDER BY updated_at DESC LIMIT $1',
    [cap],
  );
  return res.rows.map((r) => ({
    infohash: r.infohash,
    title: r.title || '',
    searches: num(r.searches),
    plays: num(r.plays),
    seeders: num(r.seeders),
    sizeBytes: num(r.size_bytes),
    updatedAt: num(r.updated_at),
  }));
}

export function createCacheRepo(query) {
  return {
    insertNode: (row) => insertNode(query, row),
    updateNode: (row) => updateNode(query, row),
    setNodeStatus: (id, status, now) => setNodeStatus(query, id, status, now),
    setTokenHash: (id, tokenHash, now) => setTokenHash(query, id, tokenHash, now),
    findByTokenHash: (tokenHash) => findByTokenHash(query, tokenHash),
    getNode: (id) => getNode(query, id),
    listNodes: () => listNodes(query),
    touchHeartbeat: (id, row) => touchHeartbeat(query, id, row),
    listAssignments: (limit) => listAssignments(query, limit),
    assignmentsForNode: (nodeId) => assignmentsForNode(query, nodeId),
    sourcesForHash: (infohash) => sourcesForHash(query, infohash),
    upsertAssignment: (row, now) => upsertAssignment(query, row, now),
    dropAssignment: (id, now) => dropAssignment(query, id, now),
    unpinAssignment: (id, now) => unpinAssignment(query, id, now),
    reportAssignment: (nodeId, id, status, error, now) => reportAssignment(query, nodeId, id, status, error, now),
    noteInterest: (row, now) => noteInterest(query, row, now),
    listInterest: (limit) => listInterest(query, limit),
  };
}
