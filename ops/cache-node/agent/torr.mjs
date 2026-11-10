// TorrServer calls from inside the compose network. The public agent does not expose this API.

async function postJson(base, body, timeoutMs) {
  const res = await fetch(base + '/torrents', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs || 30000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error('torrserver ' + res.status);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

export async function echoOk(base) {
  try {
    const res = await fetch(base + '/echo', { signal: AbortSignal.timeout(4000) });
    return res.ok;
  } catch (e) {
    return false;
  }
}

export async function listHashes(base) {
  const rows = await postJson(base, { action: 'list' }, 15000);
  const out = {};
  const list = Array.isArray(rows) ? rows : [];
  for (let i = 0; i < list.length; i++) {
    const hash = String(list[i] && list[i].hash || '').toLowerCase();
    if (/^[a-f0-9]{40}$/.test(hash)) out[hash] = true;
  }
  return out;
}

export async function addMagnet(base, magnet, title) {
  return postJson(base, { action: 'add', link: magnet, title: title || '', save_to_db: true }, 30000);
}

export async function removeHash(base, hash) {
  await postJson(base, { action: 'rem', hash }, 15000);
}

export async function largestFile(base, hash) {
  const row = await postJson(base, { action: 'get', hash }, 20000);
  const files = row && Array.isArray(row.file_stats) ? row.file_stats : [];
  let best = null;
  for (let i = 0; i < files.length; i++) {
    const length = Math.floor(Number(files[i].length) || 0);
    if (!best || length > best.length) best = { id: files[i].id, length };
  }
  return best;
}

/** Reads the beginning and drops the bytes. Returns how many bytes arrived. */
export async function readPrefix(base, hash, fileIndex, bytes) {
  const goal = Math.max(1, Math.floor(bytes));
  const url = base + '/stream/video.mkv?link=' + encodeURIComponent(hash) + '&index=' + encodeURIComponent(String(fileIndex)) + '&play';
  const res = await fetch(url, {
    headers: { range: 'bytes=0-' + (goal - 1) },
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok && res.status !== 206) {
    try { await res.body.cancel(); } catch (e) { /* ignore */ }
    return 0;
  }
  if (!res.body) return 0;
  const reader = res.body.getReader();
  let got = 0;
  try {
    while (got < goal) {
      const step = await reader.read();
      if (step.done) break;
      got += step.value.length;
    }
  } finally {
    try { await reader.cancel(); } catch (e) { /* the prefix is already counted */ }
  }
  return got;
}
