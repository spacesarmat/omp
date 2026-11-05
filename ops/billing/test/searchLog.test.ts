import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { deviceLogId, formatDhtLog, formatSearchLog } from '../src/server.mjs';

describe('dht log line', () => {
  const deviceId = 'device-SECRET-abcdef0123456789';
  const hash = createHash('sha256').update(deviceId).digest('hex').slice(0, 8);
  const infohash = 'ab'.repeat(20);

  it('logs status and duration for every call, including 200, without the token or the infohash', () => {
    const ok = formatDhtLog(200, 842.2, deviceId);
    expect(ok).toBe('dht status=200 ms=842 device=' + hash + '\n');
    const denied = formatDhtLog(401, 3, '');
    expect(denied).toBe('dht status=401 ms=3 device=-\n');
    const nasty = formatDhtLog('Bearer ' + deviceId + ' ' + infohash, -1, deviceId + '\n' + infohash);
    expect(nasty).toBe('dht status=0 ms=0 device=' + createHash('sha256').update(deviceId + '\n' + infohash).digest('hex').slice(0, 8) + '\n');
    expect(nasty).not.toContain(deviceId);
    expect(nasty).not.toContain(infohash);
    expect(nasty).not.toContain('Bearer');
  });
});

describe('search log line', () => {
  const deviceId = 'device-SECRET-abcdef0123456789';
  const hash = createHash('sha256').update(deviceId).digest('hex').slice(0, 8);

  it('hashes the device id and keeps only fixed fields', () => {
    expect(deviceLogId('')).toBe('-');
    expect(deviceLogId(deviceId)).toBe(hash);
    expect(deviceLogId(deviceId)).toHaveLength(8);
    const nasty = 'secret-query apikey=SECRETKEY 203.0.113.77 ' + deviceId;
    const line = formatSearchLog({
      at: nasty,
      source: nasty,
      status: 401,
      ms: 12.9,
      results: 3,
      indexers: { ok: 2, failed: 1, timedOut: 4 },
      abort: false,
      device: deviceId,
      qlen: nasty.length,
    });
    expect(line).toMatch(
      /^search route=\/v1\/search at=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z source=- status=401 ms=12 results=3 indexers_ok=2 indexers_fail=1 indexers_timeout=4 abort=0 device=- qlen=\d+\n$/,
    );
    expect(line).not.toContain('secret-query');
    expect(line).not.toContain('SECRETKEY');
    expect(line).not.toContain('203.0.113.77');
    expect(line).not.toContain(deviceId);
    expect(line).not.toContain('apikey');
  });

  it('prints jackett counts, a jacred dash, and the abort flag', () => {
    const at = '2026-11-01T08:53:00.123Z';
    const ok = formatSearchLog({
      at,
      source: 'jackett',
      status: 200,
      ms: 842,
      results: 17,
      indexers: { ok: 2, failed: 1, timedOut: 0 },
      abort: false,
      device: hash,
      qlen: 12,
    });
    expect(ok).toBe(
      'search route=/v1/search at=2026-11-01T08:53:00.123Z source=jackett status=200 ms=842 results=17 indexers_ok=2 indexers_fail=1 indexers_timeout=0 abort=0 device=' +
        hash +
        ' qlen=12\n',
    );
    const dropped = formatSearchLog({
      at,
      source: 'jacred',
      status: 502,
      ms: 18000,
      results: 0,
      abort: true,
      device: hash,
      qlen: 4,
    });
    expect(dropped).toContain('source=jacred');
    expect(dropped).toContain('status=502');
    expect(dropped).toContain('indexers_ok=-');
    expect(dropped).toContain('indexers_fail=-');
    expect(dropped).toContain('indexers_timeout=-');
    expect(dropped).toContain('abort=1');
    expect(dropped).not.toContain(deviceId);
  });
});
