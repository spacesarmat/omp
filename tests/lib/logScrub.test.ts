import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { scrub, log, logEntries, clearLog, flushLog, reloadLog, githubIssueUrl, LOG_MAX, LOG_KEY, LOG_COPIED_NOTE, type LogInfo } from '../../src/lib/log';

const info: LogInfo = { version: '0.14.0', platform: 'Телефон' };

beforeEach(() => {
  localStorage.clear();
  clearLog();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('scrub: hosts, IPv6, credentials, hashes, paths', () => {
  it('bare hosts and host:port', () => {
    expect(scrub('Unable to resolve host "mytorrserver.local": No address')).toBe('Unable to resolve host "сервер": No address');
    expect(scrub('connect to mytorrserver.local:8090 failed')).toBe('connect to сервер failed');
    expect(scrub('connect to home.example.org:8090 failed')).toBe('connect to сервер failed');
    expect(scrub('connect to rutracker.org:443 failed')).toBe('connect to rutracker failed');
    expect(scrub('at main.js:123 boom')).toBe('at main.js:123 boom');
  });
  it('IPv6 but not times or versions', () => {
    expect(scrub('failed to connect to /fe80::1%wlan0 (port 8090)')).toBe('failed to connect to /IP (port 8090)');
    expect(scrub('host 2001:db8::1 down')).toBe('host IP down');
    expect(scrub('host [2001:db8::1]:8090 down')).toBe('host IP down');
    expect(scrub('host 2001:0db8:0000:0000:0000:0000:0000:0001 down')).toBe('host IP down');
    expect(scrub('в 12:30:05 версия 0.14.0')).toBe('в 12:30:05 версия 0.14.0');
  });
  it('cookies, Authorization, secrets in several shapes', () => {
    expect(scrub('cookie: bb_session=0-1234-abcdef Authorization: Basic YWRtaW46cGFzcw==')).toBe('cookie: ***');
    expect(scrub('Authorization: Basic YWRtaW46cGFzcw== next')).toBe('Authorization: Basic *** next');
    expect(scrub('Authorization: Bearer abc.def-1')).toBe('Authorization: Bearer ***');
    expect(scrub('pass=hunter2 end')).toBe('pass=*** end');
    expect(scrub('body {"password":"hunter2","a":1}')).toBe('body {"password":"***","a":1}');
    expect(scrub('api_key=abc apikey=XYZ')).toBe('api_key=*** apikey=***');
    expect(scrub('session=abc123 sid=9')).toBe('session=*** sid=***');
    expect(scrub('Set-Cookie: a=b; Path=/')).toBe('Set-Cookie: ***');
  });
  it('v2 and base32 info hashes', () => {
    expect(scrub('h 1220' + 'ab'.repeat(32) + ' x')).toBe('h hash x');
    expect(scrub('h ' + 'cd'.repeat(32) + ' x')).toBe('h hash x');
    expect(scrub('btih ABCDEFGHIJKLMNOPQRSTUVWXYZ234567 x')).toBe('btih hash x');
  });
  it('file paths', () => {
    expect(scrub('open /storage/emulated/0/Movies/Матрица 1999.mkv failed')).toBe('open файл');
    expect(scrub('(/sdcard/Download/Film.mkv)')).toBe('(файл)');
  });
  it('query strings without a scheme', () => {
    expect(scrub('search?q=Матрица&page=2 failed')).toBe('search?… failed');
  });
});

describe('merge between the app and the background page', () => {
  it('reload keeps unsaved entries and picks up the other writer, without duplicates', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    log('info', 'app', 'из приложения 1');
    flushLog();
    // the background page wrote while the app was open
    const stored = JSON.parse(localStorage.getItem(LOG_KEY)!);
    stored.push({ t: 1500, l: 'info', a: 'monitor', x: 'из фона' });
    localStorage.setItem(LOG_KEY, JSON.stringify(stored));
    vi.setSystemTime(2000);
    log('info', 'app', 'из приложения 2'); // unsaved
    reloadLog();
    expect(logEntries().map((e) => e.x)).toEqual(['из приложения 1', 'из фона', 'из приложения 2']);
    flushLog();
    flushLog();
    expect(JSON.parse(localStorage.getItem(LOG_KEY)!).map((e: { x: string }) => e.x)).toEqual(['из приложения 1', 'из фона', 'из приложения 2']);
  });
  it('the app flush does not erase entries stored by the other page', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    localStorage.setItem(LOG_KEY, JSON.stringify([{ t: 500, l: 'info', a: 'monitor', x: 'фон до' }]));
    log('info', 'app', 'новое');
    flushLog();
    expect(logEntries().map((e) => e.x)).toEqual(['фон до', 'новое']);
    expect(JSON.parse(localStorage.getItem(LOG_KEY)!).length).toBe(2);
  });
  it('keeps the newest LOG_MAX after a merge', () => {
    const stored = Array.from({ length: LOG_MAX }, (_, i) => ({ t: i + 1, l: 'info', a: 'monitor', x: 'старое ' + i }));
    localStorage.setItem(LOG_KEY, JSON.stringify(stored));
    vi.useFakeTimers();
    vi.setSystemTime(100000);
    log('info', 'app', 'свежее');
    flushLog();
    const list = logEntries();
    expect(list.length).toBe(LOG_MAX);
    expect(list[list.length - 1].x).toBe('свежее');
    expect(list[0].x).toBe('старое 1');
  });
  it('clear is not undone by a later flush', () => {
    log('info', 'app', 'x');
    flushLog();
    clearLog();
    flushLog();
    expect(logEntries()).toEqual([]);
  });
});

describe('GitHub URL when copying failed', () => {
  it('says so instead of «скопирован»', () => {
    log('info', 'app', 'x');
    const body = new URLSearchParams(githubIssueUrl(info, false).split('?')[1]).get('body')!;
    expect(body).toContain('Не удалось скопировать журнал');
    expect(body).not.toContain(LOG_COPIED_NOTE);
  });
});
