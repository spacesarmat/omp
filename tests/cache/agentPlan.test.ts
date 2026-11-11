import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
// @ts-ignore plain .mjs, no declarations
import { prefixGoal, reconcile, safeStreamTarget } from '../../ops/cache-node/agent/plan.mjs';

const HASH = 'ab'.repeat(20);

describe('cache agent plan', () => {
  it('adds a missing release, retries one that is not cached, and drops the rest', () => {
    const plan = reconcile(
      { [HASH]: true, ['cd'.repeat(20)]: true },
      [
        { id: '1', infohash: HASH, status: 'caching', prefixBytes: 100 },
        { id: '2', infohash: 'ef'.repeat(20), status: 'assigned', prefixBytes: 50 },
        { infohash: 'nope', status: 'assigned' },
      ],
    );
    expect(plan.add.map((r: { infohash: string }) => r.infohash)).toEqual(['ef'.repeat(20)]);
    expect(plan.keep.map((r: { infohash: string }) => r.infohash)).toEqual([HASH]);
    expect(plan.remove).toEqual(['cd'.repeat(20)]);
    expect(prefixGoal({ prefixBytes: 0, prefixPercent: 10, sizeBytes: 1000 })).toBe(100);
  });

  it('proxies only stream and playlist reads', () => {
    expect(safeStreamTarget('/stream/film.mkv?link=' + HASH + '&index=1&play')).toContain('/stream/');
    expect(safeStreamTarget('/echo')).toBe('/echo');
    expect(safeStreamTarget('/torrents')).toBe('');
    expect(safeStreamTarget('/stream/../../etc/passwd')).toBe('');
    expect(safeStreamTarget('/settings')).toBe('');
  });

  it('shellcheck is clean', () => {
    execFileSync('shellcheck', [
      'ops/cache-node/install.sh',
      'ops/cache-node/update.sh',
      'ops/cache-node/uninstall.sh',
      'ops/cache-node/firewall.sh',
    ], { stdio: 'inherit' });
  });
});
