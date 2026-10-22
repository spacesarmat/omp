import { describe, expect, it } from 'vitest';
import { buildView, DEFAULT_PREFS, FILTER_TEXT, groupItems, itemState, yellowText, loadPrefs, matchesFilter, matchesQuery, PREFS_KEY, savePrefs, sortItems, type MonitorCheck, type MonitorPrefs } from '../admin/src/lib/monitorView.ts';

function c(id: string, group: string, ok: boolean | null, extra: Partial<MonitorCheck> = {}): MonitorCheck {
  return { id, group, name: id, path: '', ok, detail: ok === false ? 'таймаут' : 'ок', ms: 10, at: 1000, alert: true, history: '', uptime: null, ...extra };
}

const GROUPS = [
  { id: 'infra', title: 'Инфраструктура' },
  { id: 'containers', title: 'Контейнеры' },
  { id: 'jackett', title: 'Трекеры Jackett' },
];

const CHECKS: MonitorCheck[] = [
  c('postgres', 'infra', true, { name: 'Postgres', ms: 4 }),
  c('disk:/data', 'infra', true, { name: 'Диск /data', ms: 1 }),
  ...Array.from({ length: 12 }, (_, i) => c('ct:omp-' + i, 'containers', true, { name: 'omp-' + String(i).padStart(2, '0') })),
  c('jackett:kinozal', 'jackett', true, { name: 'Kinozal', path: 'jackett', target: 'kinozal', ms: 900, at: 3000 }),
  c('jackett:kinozal:direct', 'jackett', false, { name: 'Kinozal', path: 'direct', target: 'kinozal.tv', alert: false, detail: 'сброс', at: 2000 }),
  c('jackett:kinozal:warp', 'jackett', true, { name: 'Kinozal', path: 'warp', target: 'kinozal.tv', alert: false }),
  c('jackett:rutor', 'jackett', false, { name: 'RuTor', path: 'jackett', ms: 45000, alert: true, alerted: true }),
  c('jackett:rutor:direct', 'jackett', false, { name: 'RuTor', path: 'direct', target: 'rutor.info', alert: false }),
  c('jackett:rutor:warp', 'jackett', false, { name: 'RuTor', path: 'warp', target: 'rutor.info', alert: true }),
  c('jackett:bitru', 'jackett', true, { name: 'BitRu', path: 'jackett', ms: 50 }),
  c('jackett:bitru:direct', 'jackett', true, { name: 'BitRu', path: 'direct', target: 'bitru.org', alert: false }),
  c('jackett:bitru:warp', 'jackett', true, { name: 'BitRu', path: 'warp', target: 'bitru.org', alert: false }),
];

const prefs = (p: Partial<MonitorPrefs> = {}): MonitorPrefs => ({ ...DEFAULT_PREFS, open: {}, ...p });

describe('monitor tab view', () => {
  it('a tracker is one line with its three checks', () => {
    const items = groupItems(CHECKS.filter((x) => x.group === 'jackett'));
    expect(items.map((i) => [i.key, i.kind, i.target])).toEqual([
      ['jackett:kinozal', 'tracker', 'kinozal.tv'],
      ['jackett:rutor', 'tracker', 'rutor.info'],
      ['jackett:bitru', 'tracker', 'bitru.org'],
    ]);
    expect(items[0].search?.id).toBe('jackett:kinozal');
    expect(items[0].direct?.id).toBe('jackett:kinozal:direct');
  });

  it('default: red groups first and open, all-green groups folded to «Название ok/total»', () => {
    const v = buildView(GROUPS, CHECKS, prefs());
    expect(v.map((g) => [g.id, g.folded, g.okCount + '/' + g.total])).toEqual([
      ['jackett', false, '1/3'],
      ['infra', true, '2/2'],
      ['containers', true, '12/12'],
    ]);
    // inside: red first
    expect(v[0].items.map((i) => i.name)).toEqual(['Kinozal', 'RuTor', 'BitRu']);
  });

  it('a skipped check is not counted as ok and keeps its group open', () => {
    const v = buildView(GROUPS, [c('containers', 'containers', null, { name: 'Docker не настроен', detail: 'не настроено' })], prefs());
    expect(v[0]).toMatchObject({ id: 'containers', okCount: 0, skipped: 1, total: 1, failed: 0, folded: false });
  });

  it('a folded group opens when chosen, and an open red group can be folded', () => {
    const v = buildView(GROUPS, CHECKS, prefs({ open: { containers: true, jackett: false } }));
    expect(v.find((g) => g.id === 'containers')!.folded).toBe(false);
    expect(v.find((g) => g.id === 'jackett')!.folded).toBe(true);
  });

  it('filters: only errors, and red without an alert', () => {
    const items = groupItems(CHECKS.filter((x) => x.group === 'jackett'));
    expect(items.filter((i) => matchesFilter(i, 'errors')).map((i) => i.name)).toEqual(['Kinozal', 'RuTor']);
    expect(items.filter((i) => matchesFilter(i, 'noalert')).map((i) => i.name)).toEqual(['Kinozal']);
    const v = buildView(GROUPS, CHECKS, prefs({ filter: 'errors' }));
    expect(v.map((g) => g.id)).toEqual(['jackett']);
    expect(v[0].folded).toBe(false);
  });

  it('search by name, address or error opens the groups it finds in', () => {
    const v = buildView(GROUPS, CHECKS, prefs({ q: 'OMP-03' }));
    expect(v.map((g) => [g.id, g.folded, g.items.map((i) => i.name)])).toEqual([['containers', false, ['omp-03']]]);
    expect(matchesQuery(groupItems(CHECKS.filter((x) => x.group === 'jackett'))[1], 'rutor.info')).toBe(true);
    expect(buildView(GROUPS, CHECKS, prefs({ q: 'нет такого' }))).toEqual([]);
  });

  it('sorts by status, name, response time and check time, both ways', () => {
    const items = groupItems(CHECKS.filter((x) => x.group === 'jackett'));
    expect(sortItems(items, 'name', false).map((i) => i.name)).toEqual(['BitRu', 'Kinozal', 'RuTor']);
    expect(sortItems(items, 'name', true).map((i) => i.name)).toEqual(['RuTor', 'Kinozal', 'BitRu']);
    expect(sortItems(items, 'ms', true).map((i) => i.name)).toEqual(['RuTor', 'Kinozal', 'BitRu']);
    expect(sortItems(items, 'time', true)[0].name).toBe('Kinozal');
    expect(sortItems(items, 'status', true).map((i) => i.name)[0]).toBe('BitRu');
  });

  it('keeps the choice in localStorage and ignores junk there', () => {
    const mem: Record<string, string> = {};
    const storage = { getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => void (mem[k] = v) };
    expect(loadPrefs(storage)).toEqual(DEFAULT_PREFS);
    savePrefs(storage, prefs({ filter: 'noalert', sort: 'ms', desc: true, q: 'rutor', open: { containers: true } }));
    expect(loadPrefs(storage)).toEqual({ filter: 'noalert', sort: 'ms', desc: true, q: 'rutor', open: { containers: true } });
    mem[PREFS_KEY] = JSON.stringify({ filter: 'evil', sort: 1, desc: 'yes', q: 5, open: { 'bad key': true, infra: 'x', jackett: false } });
    expect(loadPrefs(storage)).toEqual({ ...DEFAULT_PREFS, open: { jackett: false } });
    mem[PREFS_KEY] = '{not json';
    expect(loadPrefs(storage)).toEqual(DEFAULT_PREFS);
    const broken = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
    expect(() => savePrefs(broken, DEFAULT_PREFS)).not.toThrow();
  });

  it('«Просит код» is yellow: counted as passing, its own filter, sorted between red and green, shown in the summary', () => {
    const y = (id: string, extra: Partial<MonitorCheck> = {}) => c(id, 'jackett', true, { warn: 'code', detail: 'HTTP 403, просит код (капча)', alert: false, ...extra });
    const checks: MonitorCheck[] = [
      c('jackett:bitru', 'jackett', true, { name: 'BitRu', path: 'jackett' }),
      c('jackett:bitru:direct', 'jackett', true, { name: 'BitRu', path: 'direct', alert: false }),
      c('jackett:bitru:warp', 'jackett', true, { name: 'BitRu', path: 'warp', alert: false }),
      y('jackett:abc:direct', { name: 'Abc', path: 'direct' }),
      y('jackett:abc:warp', { name: 'Abc', path: 'warp' }),
      c('jackett:zed:direct', 'jackett', false, { name: 'Zed', path: 'direct', alert: false }),
      c('jackett:zed:warp', 'jackett', true, { name: 'Zed', path: 'warp', alert: false }),
    ];
    const items = groupItems(checks);
    expect(items.map((i) => [i.name, itemState(i)])).toEqual([
      ['BitRu', 'green'],
      ['Abc', 'yellow'],
      ['Zed', 'red'],
    ]);
    expect(sortItems(items, 'status', false).map((i) => i.name)).toEqual(['Zed', 'Abc', 'BitRu']);
    expect(sortItems(items, 'status', true).map((i) => i.name)).toEqual(['BitRu', 'Abc', 'Zed']);
    expect(FILTER_TEXT.code).toBe('Просит код');
    expect(items.filter((i) => matchesFilter(i, 'code')).map((i) => i.name)).toEqual(['Abc']);
    // yellow is not an error and never «без алерта»
    expect(items.filter((i) => matchesFilter(i, 'errors')).map((i) => i.name)).toEqual(['Zed']);
    expect(items.filter((i) => matchesFilter(i, 'noalert')).map((i) => i.name)).toEqual(['Zed']);
    const [g] = buildView([{ id: 'jackett', title: 'Трекеры Jackett' }], checks.filter((x) => !x.id.startsWith('jackett:zed')), prefs());
    expect(g).toMatchObject({ total: 2, okCount: 2, warned: 1, failed: 0, folded: true });
    expect([1, 2, 5, 11, 21, 22].map(yellowText)).toEqual(['1 жёлтая', '2 жёлтые', '5 жёлтых', '11 жёлтых', '21 жёлтая', '22 жёлтые']);
    expect(loadPrefs({ getItem: () => JSON.stringify({ filter: 'code' }), setItem: () => {} }).filter).toBe('code');
  });
});
