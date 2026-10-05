import { describe, it, expect, beforeEach } from 'vitest';
import { collectBackup, parseBackup, serializeBackup, summarizeBackup, summaryLines } from '../src/lib/backup';

const KEY = 'k3y-SECRET-0001';
const NOW = new Date(2026, 9, 4, 12, 0, 0).getTime();

beforeEach(() => localStorage.clear());

describe('backup of indexer connections', () => {
  it('keeps address and keySet, never a key', () => {
    localStorage.setItem('tsp.indexers', JSON.stringify([{ id: 'x', kind: 'jackett', url: 'http://192.168.1.5:9117', keySet: true, apiKey: KEY, key: KEY }]));
    const text = serializeBackup(collectBackup(NOW));
    expect(text).not.toContain(KEY);
    const b = JSON.parse(text);
    expect(b.data['tsp.indexers']).toHaveLength(1);
    expect(b.data['tsp.indexers'][0].url).toBe('http://192.168.1.5:9117');
    expect(b.data['tsp.indexers'][0].keySet).toBe(true);
    expect(Object.keys(b.data['tsp.indexers'][0]).sort()).toEqual(['id', 'keySet', 'kind', 'url']);
  });

  it('restore sanitizes a hand-made file and lists it in the summary', () => {
    const file = JSON.stringify({
      format: 'omp-backup',
      v: 1,
      omp: '0.15.0',
      at: 'x',
      data: { 'tsp.indexers': [{ kind: 'prowlarr', url: 'http://h:9696/', keySet: true, apiKey: KEY }, { kind: 'bad', url: 'x' }] },
    });
    const r = parseBackup(file);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(JSON.stringify(r.backup)).not.toContain(KEY);
    expect((r.backup.data['tsp.indexers'] as unknown[]).length).toBe(1);
    expect(summaryLines(summarizeBackup(r.backup)).join('\n')).toContain('Индексаторов');
  });
});
