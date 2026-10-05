import { describe, it, expect, beforeEach } from 'vitest';
import {
  BACKUP_KEYS,
  BACKUP_MAX_BYTES,
  NOT_BACKED_UP,
  errEmpty,
  errFormat,
  errNotJson,
  errTooBig,
  errTooMany,
  errVersion,
  errVersionNew,
  applyBackup,
  backupFileName,
  backupWarning,
  collectBackup,
  parseBackup,
  serializeBackup,
  summarizeBackup,
  summaryLines,
} from '../src/lib/backup';

const NOW = new Date(2026, 9, 3, 12, 0, 0).getTime();
const put = (k: string, v: unknown) => localStorage.setItem(k, JSON.stringify(v));
const get = (k: string) => JSON.parse(localStorage.getItem(k) as string);
const file = (data: Record<string, unknown>, over: Record<string, unknown> = {}) =>
  JSON.stringify({ format: 'omp-backup', v: 1, omp: '0.14.0', at: '2026-10-03T09:00:00.000Z', data, ...over });

const SERVER = { id: 's1', name: 'Дом', url: 'http://192.168.1.5:8090', user: 'u', password: 'secret-pass' };
const TV_LG = { ip: '192.168.1.20', name: 'LG', clientKey: 'abc123' };
const TV_ATV = { ip: '192.168.1.21', name: 'Bravia', kind: 'atv', token: 'a'.repeat(32), ctlPort: 8095 };
const SUB = { id: 'x1', query: 'Дюна', quality: '1080', sources: null, notify: true, createdAt: 5 };

beforeEach(() => localStorage.clear());

describe('collectBackup', () => {
  it('has the header and only allowlisted keys', () => {
    put('tsp.servers', [SERVER]);
    put('tsp.log', [{ t: 1, l: 'info', a: 'app', x: 'личное' }]);
    put('tsp.newsFeed', { items: [] });
    put('tsp.torrents', [{ hash: 'h' }]);
    put('tsp.seenVersion', '0.13.0');
    put('tsp.progress', { a: 1 });
    put('tsp.subsSeen', { x1: { k: ['a'] } });
    localStorage.setItem('tsp.cookie.rutracker', '"bb_session=1"');
    localStorage.setItem('other', '1');
    const b = collectBackup(NOW);
    expect(b.format).toBe('omp-backup');
    expect(b.v).toBe(1);
    expect(b.at).toBe(new Date(NOW).toISOString());
    expect(typeof b.omp).toBe('string');
    expect(Object.keys(b.data)).toEqual(['tsp.servers']);
    const text = serializeBackup(b);
    expect(text).not.toContain('личное');
    expect(text).not.toContain('bb_session');
  });

  it('collects every allowlisted key that is set', () => {
    put('tsp.servers', [SERVER]);
    put('tsp.activeServer', 's1');
    put('tsp.tvs', [TV_LG, TV_ATV]);
    put('tsp.activeTv', TV_LG.ip);
    put('tsp.subs', [SUB]);
    put('tsp.monitor', { enabled: false, hours: 6, wifiOnly: true, episodes: true });
    put('tsp.sources', { rutor: { on: false } });
    put('tsp.indexers', [{ id: 'jackett-1', kind: 'jackett', url: 'http://192.168.1.5:9117', keySet: true }]);
    put('tsp.flaresolverr', { url: 'http://192.168.1.5:8191', extra: 'dropped' });
    put('tsp.settings', { libraryView: 'list', autoNext: false });
    put('tsp.touchpad', { speed: 5, accel: false, tapClick: true, invertScroll: true });
    put('tsp.localServer', { autostart: true });
    put('tsp.playlists', [{ url: 'http://x/p.m3u', title: 'P' }]);
    put('tsp.trackPrefs', { h1: { audioLang: 'ru' } });
    put('tsp.support', { until: 1798934400000 });
    const b = collectBackup(NOW);
    expect(b.data['tsp.support']).toEqual({ until: 1798934400000 });
    expect(b.data['tsp.flaresolverr']).toEqual({ url: 'http://192.168.1.5:8191' });
    expect(Object.keys(b.data).sort()).toEqual(BACKUP_KEYS.map((k) => k.key).sort());
    expect((b.data['tsp.settings'] as { libraryView: string }).libraryView).toBe('list');
    expect(b.data['tsp.tvs']).toEqual([TV_LG, TV_ATV]);
  });

  it('keeps the TorrServer password and pairing keys (the warning says so)', () => {
    put('tsp.servers', [SERVER]);
    put('tsp.tvs', [TV_LG]);
    const text = serializeBackup(collectBackup(NOW));
    expect(text).toContain('secret-pass');
    expect(text).toContain('abc123');
  });

  it('lists the per-device v0.15 keys as not backed up', () => {
    for (const k of ['tsp.indexerScan', 'tsp.torznabHosts', 'tsp.faqDevice']) {
      expect(NOT_BACKED_UP).toContain(k);
      expect(BACKUP_KEYS.map((b) => b.key)).not.toContain(k);
    }
  });

  it('never lists excluded keys in the allowlist', () => {
    const keys = BACKUP_KEYS.map((k) => k.key);
    NOT_BACKED_UP.forEach((k) => expect(keys).not.toContain(k));
    expect(keys.some((k) => /log|cookie|pass|secret|cache/i.test(k))).toBe(false);
  });

  it('cleans values with the stores sanitizers and survives corrupt storage', () => {
    localStorage.setItem('tsp.servers', '{broken');
    put('tsp.touchpad', { speed: 99, accel: 'yes' });
    const b = collectBackup(NOW);
    expect(b.data['tsp.servers']).toBeUndefined();
    expect(b.data['tsp.touchpad']).toEqual({ speed: 5, accel: true, tapClick: true, invertScroll: false, scrollStrip: true });
  });
});

describe('parseBackup', () => {
  const err = (text: string) => {
    const r = parseBackup(text);
    return r.ok ? null : r.error;
  };

  it('rejects bad JSON, wrong format, odd versions, oversize and empty', () => {
    expect(err('не json')).toBe(errNotJson());
    expect(err('[]')).toBe(errFormat());
    expect(err(JSON.stringify({ format: 'other', v: 1, data: {} }))).toBe(errFormat());
    expect(err(JSON.stringify({ format: 'omp-backup', v: 1 }))).toBe(errFormat());
    expect(err(file({ 'tsp.servers': [SERVER] }, { v: 2 }))).toBe(errVersionNew());
    expect(err(file({ 'tsp.servers': [SERVER] }, { v: 0 }))).toBe(errVersion());
    expect(err(file({ 'tsp.servers': [SERVER] }, { v: '1' }))).toBe(errVersion());
    expect(err(file({}))).toBe(errEmpty());
    expect(err(file({ 'tsp.log': [1], x: 1 }))).toBe(errEmpty());
    expect(err('x'.repeat(BACKUP_MAX_BYTES + 1))).toBe(errTooBig());
  });

  it('ignores unknown and excluded keys', () => {
    const r = parseBackup(file({ 'tsp.servers': [SERVER], 'tsp.log': [{ t: 1 }], 'tsp.newsFeed': {}, evil: 1 }));
    expect(r.ok && Object.keys(r.backup.data)).toEqual(['tsp.servers', 'tsp.activeServer']);
  });

  it('drops values the sanitizers reject, keeps the good ones', () => {
    const r = parseBackup(
      file({
        'tsp.servers': [{ id: 1 }, { id: 's2', name: 'Дача', url: 'javascript:alert(1)' }, { ...SERVER, extra: 'x' }],
        'tsp.tvs': [{ ip: 'not-an-ip', name: 'x' }],
        'tsp.settings': 'oops',
        'tsp.touchpad': { speed: 3, accel: 1 },
        'tsp.sources': { rutor: { on: 'no' } },
        'tsp.monitor': [],
        'tsp.activeServer': 42,
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.backup.data['tsp.servers']).toEqual([SERVER]);
    ['tsp.tvs', 'tsp.settings', 'tsp.sources', 'tsp.monitor'].forEach((k) => expect(k in r.backup.data).toBe(false));
    expect((r.backup.data['tsp.touchpad'] as { accel: boolean }).accel).toBe(true);
  });

  it('points active ids only at things in the copy', () => {
    const r = parseBackup(file({ 'tsp.servers': [SERVER], 'tsp.activeServer': 'gone', 'tsp.tvs': [TV_LG], 'tsp.activeTv': '9.9.9.9' }));
    expect(r.ok && r.backup.data['tsp.activeServer']).toBe(null);
    expect(r.ok && r.backup.data['tsp.activeTv']).toBe(null);
  });

  it('round-trips a collected copy', () => {
    put('tsp.servers', [SERVER]);
    put('tsp.subs', [SUB]);
    const b = collectBackup(NOW);
    const r = parseBackup(serializeBackup(b));
    expect(r.ok && r.backup.data).toMatchObject(b.data);
  });
});

describe('applyBackup', () => {
  it('replaces the keys in the copy and leaves everything else alone', () => {
    put('tsp.servers', [{ ...SERVER, id: 'old', url: 'http://old:1' }]);
    put('tsp.subs', [SUB]);
    put('tsp.log', [{ t: 1, l: 'info', a: 'app', x: 'k' }]);
    put('tsp.settings', { autoNext: false });
    const r = parseBackup(file({ 'tsp.servers': [SERVER], 'tsp.settings': { libraryView: 'compact' }, 'tsp.log': [] }));
    if (!r.ok) throw new Error('parse');
    applyBackup(r.backup);
    expect(get('tsp.servers')).toEqual([SERVER]);
    expect(get('tsp.settings').libraryView).toBe('compact');
    expect(get('tsp.subs')).toEqual([SUB]); // not in the copy: kept
    expect(get('tsp.log')).toHaveLength(1); // never restored
  });

  it('does not write a key that is not allowlisted even if handed in directly', () => {
    applyBackup({ format: 'omp-backup', v: 1, omp: '', at: '', data: { 'tsp.log': [1], 'tsp.torrents': [1] } });
    expect(localStorage.getItem('tsp.log')).toBe(null);
    expect(localStorage.getItem('tsp.torrents')).toBe(null);
  });
});

describe('summary, name, warning', () => {
  it('counts what is inside', () => {
    put('tsp.servers', [SERVER, { id: 's2', name: 'Дача', url: 'http://d:1' }]);
    put('tsp.tvs', [TV_LG]);
    put('tsp.subs', [SUB]);
    put('tsp.sources', { rutor: { on: false }, nnm: { on: true } });
    put('tsp.settings', {});
    const s = summarizeBackup(collectBackup(NOW));
    expect(s.servers).toEqual(['Дом', 'Дача']);
    expect(s.tvs).toEqual(['LG']);
    expect(s.subs).toBe(1);
    expect(s.sources).toBe(2);
    expect(s.hasPassword).toBe(true);
    expect(s.hasPairKeys).toBe(true);
    expect(summaryLines(s)).toEqual([
      'Серверов TorrServer: 2 (Дом, Дача)',
      'Телевизоров: 1 (LG)',
      '1 подписка мониторинга',
      'Источники поиска: 2 переключателя',
      'Настройки приложения, мониторинга и тачпада, вид каталога',
    ]);
  });

  it('names the file by date', () => {
    expect(backupFileName(NOW)).toBe('omp-копия-2026-10-03.json');
  });

  it('warns about the password and pairing keys', () => {
    expect(backupWarning()).toContain('пароль доступа к вашему TorrServer');
    expect(backupWarning()).toContain('ключи пар с телевизорами');
  });
});

describe("hardening", () => {
  it("rejects collections over the cap", () => {
    const many = [];
    for (let i = 0; i < 5000; i++) many.push({ id: "s" + i, name: "n", url: "http://h" + i + ":1" });
    const r = parseBackup(file({ "tsp.servers": many }));
    expect(r.ok ? "" : r.error).toBe(errTooMany());
  });

  it("survives __proto__ and constructor keys without pollution", () => {
    const text = "{\"format\":\"omp-backup\",\"v\":1,\"data\":{\"tsp.sources\":{\"__proto__\":{\"on\":true}},\"tsp.trackPrefs\":{\"__proto__\":{\"audioLang\":\"x\"},\"constructor\":{\"audioLang\":\"y\"}},\"tsp.touchpad\":{\"speed\":2}}}";
    const r = parseBackup(text);
    expect(({} as { on?: unknown }).on).toBeUndefined();
    expect(({} as { audioLang?: unknown }).audioLang).toBeUndefined();
    expect(r.ok).toBe(true);
    if (r.ok) expect("tsp.sources" in r.backup.data).toBe(false);
  });

  it("restores playlists and track choices", () => {
    const r = parseBackup(file({ "tsp.playlists": [{ url: "http://x/p.m3u", title: "P" }], "tsp.trackPrefs": { h1: { audioLang: "ru" } } }));
    if (!r.ok) throw new Error("parse");
    applyBackup(r.backup);
    expect(get("tsp.playlists")).toEqual([{ url: "http://x/p.m3u", title: "P" }]);
    expect(get("tsp.trackPrefs")).toEqual({ h1: { audioLang: "ru" } });
    expect(summaryLines(summarizeBackup(r.backup))).toEqual(["Избранных плейлистов: 1", "Выбор дорожек: 1 раздача"]);
  });

  it("a partial settings file keeps the other current settings", () => {
    put("tsp.settings", { autoNext: false, seekStep: 30 });
    put("tsp.touchpad", { speed: 5, accel: false, tapClick: true, invertScroll: true });
    const r = parseBackup(file({ "tsp.settings": { libraryView: "list" }, "tsp.touchpad": { speed: 2 } }));
    if (!r.ok) throw new Error("parse");
    applyBackup(r.backup);
    expect(get("tsp.settings")).toMatchObject({ libraryView: "list", autoNext: false, seekStep: 30 });
    expect(get("tsp.touchpad")).toEqual({ speed: 2, accel: false, tapClick: true, invertScroll: true, scrollStrip: true });
  });

  it("resets active ids that no longer exist after the restore", () => {
    put("tsp.servers", [SERVER]);
    put("tsp.activeServer", "s1");
    put("tsp.tvs", [TV_LG]);
    put("tsp.activeTv", TV_LG.ip);
    const r = parseBackup(file({ "tsp.servers": [{ id: "s9", name: "Новый", url: "http://n:1" }], "tsp.tvs": [TV_ATV] }));
    if (!r.ok) throw new Error("parse");
    applyBackup(r.backup);
    expect(get("tsp.activeServer")).toBe(null);
    expect(get("tsp.activeTv")).toBe(null);
  });

  it("keeps an active id that is still in the new list", () => {
    put("tsp.servers", [SERVER]);
    put("tsp.activeServer", "s1");
    const r = parseBackup(file({ "tsp.servers": [SERVER, { id: "s2", name: "B", url: "http://b:1" }] }));
    if (!r.ok) throw new Error("parse");
    applyBackup(r.backup);
    expect(get("tsp.activeServer")).toBe("s1");
  });

  it("rolls everything back when a write fails midway", () => {
    put("tsp.servers", [{ ...SERVER, id: "old", url: "http://old:1" }]);
    put("tsp.settings", { autoNext: false });
    const r = parseBackup(file({ "tsp.servers": [SERVER], "tsp.settings": { libraryView: "list" }, "tsp.touchpad": { speed: 2 } }));
    if (!r.ok) throw new Error("parse");
    const real = Storage.prototype.setItem;
    let writes = 0;
    Storage.prototype.setItem = function (this: Storage, k: string, v: string) {
      if (k === "tsp.settings" && ++writes === 1) throw new Error("quota");
      return real.call(this, k, v);
    };
    try {
      expect(() => applyBackup(r.backup)).toThrow("quota");
    } finally {
      Storage.prototype.setItem = real;
    }
    expect(get("tsp.servers")[0].id).toBe("old");
    expect(get("tsp.settings")).toEqual({ autoNext: false });
    expect(localStorage.getItem("tsp.touchpad")).toBe(null);
  });

  it("save never drops data: 300 playlists and 300 track choices are collected, parsed and restored", () => {
    const pl = [];
    const tp: Record<string, unknown> = {};
    for (let i = 0; i < 300; i++) {
      pl.push({ url: "http://x/p" + i + ".m3u", title: "P" + i });
      tp["h" + i] = { audioLang: "ru", audioLabel: "Дорожка " + i };
    }
    put("tsp.playlists", pl);
    put("tsp.trackPrefs", tp);
    const b = collectBackup(NOW);
    expect((b.data["tsp.playlists"] as unknown[]).length).toBe(300);
    expect(Object.keys(b.data["tsp.trackPrefs"] as object).length).toBe(300);
    const r = parseBackup(serializeBackup(b));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((r.backup.data["tsp.playlists"] as unknown[]).length).toBe(300);
    expect(Object.keys(r.backup.data["tsp.trackPrefs"] as object).length).toBe(300);
  });

  it("a big collected copy (~2 MB of track choices) still parses", () => {
    const tp: Record<string, unknown> = {};
    for (let i = 0; i < 20000; i++) tp["h" + i] = { audioLang: "ru", audioLabel: "Дорожка " + i };
    put("tsp.trackPrefs", tp);
    const text = serializeBackup(collectBackup(NOW));
    expect(text.length).toBeGreaterThan(1024 * 1024);
    expect(parseBackup(text).ok).toBe(true);
  });
});
