import { afterEach, describe, expect, it } from 'vitest';
import { updateSettings } from '../../src/store/settings';
import {
  SWARM_REPORT_BATCH_MAX,
  SWARM_REPORT_WINDOW_MS,
  flushSwarm,
  noteSwarmSample,
  resetSwarmReport,
  setSwarmPoster,
} from '../../src/viewer/swarmReport';

const HASH = 'ab'.repeat(20);
const NOW = 1_800_000_000_000;

function tor(p: { hash?: string; stat?: number; connected_seeders?: number; active_peers?: number } = {}) {
  return { hash: HASH, stat: 3, connected_seeders: 5, active_peers: 8, ...p };
}

describe('swarm report batch', () => {
  afterEach(() => {
    resetSwarmReport();
    setSwarmPoster(null);
    updateSettings({ helpRank: true });
  });

  it('sends the TorrServer swarm split of an active torrent', async () => {
    const sent: { [key: string]: string }[] = [];
    setSwarmPoster(async (body) => {
      sent.push(body);
    });
    noteSwarmSample(tor(), NOW);
    flushSwarm();
    await Promise.resolve();
    expect(sent).toHaveLength(1);
    expect(sent[0].help).toBe('1');
    expect(typeof sent[0].deviceId).toBe('string');
    const items = JSON.parse(sent[0].swarm) as { infohash: string; seeders: number; leechers: number }[];
    expect(items).toEqual([{ infohash: HASH, seeders: 5, leechers: 3 }]);
  });

  it('reports preloading and info-gathering torrents, never the idle snapshot', () => {
    const sent: string[] = [];
    setSwarmPoster(async (body) => {
      sent.push(body.swarm);
    });
    noteSwarmSample(tor({ stat: 2 }), NOW);
    noteSwarmSample(tor({ hash: 'cd'.repeat(20), stat: 1 }), NOW);
    noteSwarmSample(tor({ hash: 'ef'.repeat(20), stat: 5 }), NOW);
    noteSwarmSample(tor({ hash: '12'.repeat(20), stat: 0 }), NOW);
    noteSwarmSample(tor({ hash: '34'.repeat(20), stat: 4 }), NOW);
    noteSwarmSample(tor({ hash: 'nope' }), NOW);
    flushSwarm();
    const items = JSON.parse(sent[0]) as { infohash: string }[];
    expect(items.map((i) => i.infohash)).toEqual([HASH, 'cd'.repeat(20)]);
  });

  it('dedups a hash inside the window and accepts the next sample after it', () => {
    const sent: string[] = [];
    setSwarmPoster(async (body) => {
      sent.push(body.swarm);
    });
    noteSwarmSample(tor(), NOW);
    flushSwarm();
    noteSwarmSample(tor({ connected_seeders: 9 }), NOW + 1000);
    flushSwarm();
    expect(sent).toHaveLength(1);
    noteSwarmSample(tor({ connected_seeders: 9 }), NOW + SWARM_REPORT_WINDOW_MS + 1);
    flushSwarm();
    expect(sent).toHaveLength(2);
    const items = JSON.parse(sent[1]) as { seeders: number }[];
    expect(items[0].seeders).toBe(9);
  });

  it('keeps the newest counts of a pending hash and clamps the split', () => {
    const sent: string[] = [];
    setSwarmPoster(async (body) => {
      sent.push(body.swarm);
    });
    noteSwarmSample(tor({ connected_seeders: 2, active_peers: 1 }), NOW);
    noteSwarmSample(tor({ connected_seeders: 4, active_peers: 10 }), NOW + 1);
    noteSwarmSample(tor({ hash: 'cd'.repeat(20), connected_seeders: 2_000_000, active_peers: 3_000_000 }), NOW);
    flushSwarm();
    const items = JSON.parse(sent[0]) as { infohash: string; seeders: number; leechers: number }[];
    expect(items[0]).toEqual({ infohash: HASH, seeders: 4, leechers: 6 });
    expect(items[1].seeders).toBe(1_000_000);
    expect(items[1].leechers).toBe(1_000_000);
  });

  it('sends nothing when the help setting is off', () => {
    const sent: string[] = [];
    setSwarmPoster(async (body) => {
      sent.push(body.swarm);
    });
    updateSettings({ helpRank: false });
    noteSwarmSample(tor(), NOW);
    flushSwarm();
    expect(sent).toHaveLength(0);
  });

  it('caps one batch and keeps the rest for the next flush', () => {
    const sent: string[] = [];
    setSwarmPoster(async (body) => {
      sent.push(body.swarm);
    });
    for (let i = 0; i < SWARM_REPORT_BATCH_MAX + 5; i++) {
      noteSwarmSample(tor({ hash: i.toString(16).padStart(2, '0').repeat(20) }), NOW);
    }
    flushSwarm();
    flushSwarm();
    const first = JSON.parse(sent[0]) as unknown[];
    const second = JSON.parse(sent[1]) as unknown[];
    expect(first).toHaveLength(SWARM_REPORT_BATCH_MAX);
    expect(second).toHaveLength(5);
  });
});
