import { describe, expect, it } from 'vitest';
import {
  cleanMagnet,
  HEARTBEAT_FRESH_MS,
  newNodeToken,
  nodeTokenFromHeader,
  planAssignments,
  prefixMbOf,
  safeNodeUrl,
  scoreOf,
  selectPopular,
  tokenHash,
} from '../src/cacheNodes.mjs';
import { mergeSettings, publicAdminSettings } from '../src/services.mjs';
import { emptyState } from '../src/state.mjs';

const HASH = 'ab'.repeat(20);
const OTHER = 'cd'.repeat(20);
const MB = 1024 * 1024;

describe('cache node foundation', () => {
  it('stays off until an admin turns it on, and a settings save does not flip it', () => {
    const cur = emptyState().settings;
    expect(cur.cacheNodesEnabled).toBe(false);
    expect(publicAdminSettings(cur).cacheNodesEnabled).toBe(false);
    expect(prefixMbOf(cur)).toBe(512);
    const next = mergeSettings(cur, { jackettEnabled: 'false', torrserverUrl: 'http://torrserver:8090' });
    expect(next.cacheNodesEnabled).toBe(false);
    expect(next.cachePrefixMb).toBe(512);
    expect(mergeSettings(cur, { cacheNodesEnabled: 'true' }).cacheNodesEnabled).toBe(true);
    expect(mergeSettings(next, { cacheNodesEnabled: 'false' }).jackettEnabled).toBe(false);
  });

  it('hashes a node token and rejects anything else', () => {
    const token = newNodeToken();
    expect(token).toMatch(/^cn_[a-f0-9]{64}$/);
    expect(tokenHash(token)).toHaveLength(64);
    expect(tokenHash(token)).not.toBe(token);
    expect(nodeTokenFromHeader('Bearer ' + token)).toBe(token);
    expect(nodeTokenFromHeader('Bearer a1.device')).toBe('');
    expect(nodeTokenFromHeader('Bearer ' + token + ' extra')).toBe('');
  });

  it('accepts a public cache URL and refuses loopback, link-local and userinfo', () => {
    expect(safeNodeUrl('http://cache.example:8090')).toBe('http://cache.example:8090');
    expect(safeNodeUrl('http://10.1.2.3:8090/')).toBe('http://10.1.2.3:8090');
    expect(safeNodeUrl('http://127.0.0.1:8090')).toBe('');
    expect(safeNodeUrl('http://169.254.169.254:8090')).toBe('');
    expect(safeNodeUrl('http://user:secret@cache.example:8090')).toBe('');
    expect(safeNodeUrl('http://localhost:8090')).toBe('');
    expect(safeNodeUrl('http://torrserver:8090')).toBe('');
  });

  it('keeps a DHT magnet and drops a tracker secret', () => {
    expect(cleanMagnet('', HASH)).toBe('magnet:?xt=urn:btih:' + HASH);
    const priv = 'magnet:?xt=urn:btih:' + HASH + '&tr=http://tracker.example/announce?passkey=secret';
    expect(cleanMagnet(priv, HASH)).toBe('');
    const ok = cleanMagnet('magnet:?xt=urn:btih:' + HASH + '&tr=http://tracker.example/announce', HASH);
    expect(ok).toContain('tracker.example');
    expect(ok).not.toContain('passkey');
    expect(cleanMagnet('magnet:?xt=urn:btih:' + OTHER, HASH)).toBe('');
  });

  it('ranks seeded releases and skips a swarm with no seeds', () => {
    const picked = selectPopular([
      { infohash: HASH, title: 'A', searches: 10, plays: 0, seeders: 5, sizeBytes: 1000 },
      { infohash: OTHER, title: 'B', searches: 0, plays: 10, seeders: 2, sizeBytes: 1000 },
      { infohash: 'ef'.repeat(20), title: 'dead', searches: 100, plays: 0, seeders: 0, sizeBytes: 1000 },
      { infohash: '12'.repeat(20), title: 'skip', searches: 50, plays: 0, seeders: 9, sizeBytes: 1 },
    ], { skip: { ['12'.repeat(20)]: true } });
    expect(picked.map((r) => r.infohash)).toEqual([OTHER, HASH]);
    expect(scoreOf(picked[0])).toBeGreaterThan(scoreOf(picked[1]));
  });

  it('fills free capacity, keeps a pin, and does not drop an offline node', () => {
    const now = Date.now();
    const online = { id: 'a'.repeat(16), status: 'active', lastHeartbeat: now, capacityBytes: 800 * MB, prefixMb: 512, prefixPercent: 0 };
    const offline = { id: 'b'.repeat(16), status: 'active', lastHeartbeat: now - HEARTBEAT_FRESH_MS - 1000, capacityBytes: 5000 * MB, prefixMb: 512, prefixPercent: 0 };
    const settings = { cachePrefixMb: 512, cachePrefixPercent: 0 };
    const pinned = { id: 'p'.repeat(16), nodeId: online.id, infohash: HASH, status: 'cached', pinned: true, source: 'manual', prefixBytes: 100 * MB, removedAt: 0 };
    const stale = { id: 's'.repeat(16), nodeId: online.id, infohash: OTHER, status: 'cached', pinned: false, source: 'auto', prefixBytes: 100 * MB, removedAt: 0 };
    const away = { id: 'o'.repeat(16), nodeId: offline.id, infohash: 'ef'.repeat(20), status: 'cached', pinned: false, source: 'auto', prefixBytes: 100 * MB, removedAt: 0 };
    const plan = planAssignments({
      now,
      settings,
      nodes: [online, offline],
      assignments: [pinned, stale, away],
      picked: [
        { infohash: '11'.repeat(20), title: 'new', searches: 4, plays: 0, seeders: 3, sizeBytes: 0, score: 11 },
        { infohash: '22'.repeat(20), title: 'second', searches: 4, plays: 0, seeders: 3, sizeBytes: 0, score: 11 },
      ],
    });
    expect(plan.create.map((r) => r.infohash)).toEqual(['11'.repeat(20)]);
    expect(plan.drop).toEqual([stale.id]);
    expect(plan.drop).not.toContain(pinned.id);
    expect(plan.drop).not.toContain(away.id);
    const huge = planAssignments({
      now,
      settings,
      nodes: [{ ...online, capacityBytes: 600 * MB, prefixMb: 2048 }],
      assignments: [],
      picked: [{ infohash: '11'.repeat(20), title: 'big', searches: 4, plays: 0, seeders: 3, sizeBytes: 0, score: 11 }],
    });
    expect(huge.create).toEqual([]);
  });
});
