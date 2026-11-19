import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('bittorrent-dht', () => ({ default: class FakeDht {} }));

import { sanitizeNodes, loadTable, saveTable, exportNodes } from '../dht-peers/src/table.mjs';
import { createDhtLookup } from '../dht-peers/src/lookup.mjs';

const ID = 'a'.repeat(40);
const node = (over = {}) => ({ id: ID, host: '1.2.3.4', port: 6881, ...over });

describe('DHT routing table persistence', () => {
  it('sanitize drops bad ids/hosts/ports, dedups and caps', () => {
    const list = [
      node(),
      node(), // dup host:port
      node({ id: 'zz' }), // bad id
      node({ host: 'bad host' }),
      node({ port: 0 }),
      node({ port: 70000 }),
      node({ host: '5.6.7.8', port: 6882 }),
    ];
    const out = sanitizeNodes(list, 2);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ id: ID, host: '1.2.3.4', port: 6881 });
    expect(out[1].host).toBe('5.6.7.8');
  });

  it('save/load round-trips atomically and tolerates a missing/corrupt file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dht-table-'));
    const file = join(dir, 'sub', 'routing.json');
    expect(loadTable(file)).toEqual([]);
    saveTable(file, [node(), node({ host: 'bad host' })]);
    expect(loadTable(file)).toEqual([{ id: ID, host: '1.2.3.4', port: 6881 }]);
    expect(JSON.parse(readFileSync(file, 'utf8')).nodes).toHaveLength(1);
    rmSync(dir, { recursive: true, force: true });
  });

  it('exportNodes maps Buffer ids to hex', () => {
    const dht = { nodes: { toArray: () => [{ id: Buffer.from(ID, 'hex'), host: '1.2.3.4', port: 6881 }] } };
    expect(exportNodes(dht)).toEqual([{ id: ID, host: '1.2.3.4', port: 6881 }]);
    expect(exportNodes(null)).toEqual([]);
  });

  it('a new node starts warm from the saved table and persists after a lookup', async () => {
    const saved = [node()];
    let savedOut = null;
    const fake = {
      added: [],
      ready: true,
      destroyed: false,
      nodes: {
        add: (n) => fake.added.push(n),
        toArray: () => saved.map((n) => ({ id: Buffer.from(n.id, 'hex'), host: n.host, port: n.port })),
      },
      on() {},
      removeListener() {},
      listen() {},
      destroy() {
        this.destroyed = true;
      },
      _rpc: { id: Buffer.alloc(20) },
      _closest: (t, m, onreply, done) => done(),
    };
    const lookup = createDhtLookup({
      createNode: () => fake,
      table: { load: () => saved, save: (n) => (savedOut = n) },
      now: () => 100000,
      saveEveryMs: 1,
      schedule: () => 0,
      clearTimer: () => {},
      lookupMs: 8000,
    });
    const r = await lookup.lookup('b'.repeat(40));
    expect(r.ok).toBe(true);
    expect(fake.added).toHaveLength(1);
    expect(fake.added[0].host).toBe('1.2.3.4');
    expect(Buffer.isBuffer(fake.added[0].id)).toBe(true);
    expect(savedOut).toEqual([{ id: ID, host: '1.2.3.4', port: 6881 }]);
  });
});