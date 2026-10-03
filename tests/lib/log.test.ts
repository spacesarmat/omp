import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  scrub,
  log,
  logEntries,
  clearLog,
  flushLog,
  reloadLog,
  sanitizeLog,
  formatLog,
  githubIssueUrl,
  parseUserAgent,
  baseName,
  installErrorHooks,
  LOG_MAX,
  LOG_TEXT_MAX,
  LOG_KEY,
  ISSUE_URL_MAX,
  LOG_COPIED_NOTE,
  type LogInfo,
} from '../../src/lib/log';

const info: LogInfo = { version: '0.14.0', platform: 'Телефон', android: '14', model: 'Pixel 7', webview: '129' };

beforeEach(() => {
  localStorage.clear();
  clearLog();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('scrub', () => {
  it('keeps scheme and site kind of URLs, drops path and query', () => {
    expect(scrub('GET http://192.168.1.5:8090/torrents?link=abc&x=1 failed')).toBe('GET http://сервер failed');
    expect(scrub('https://my.home.example/api/search?query=Title')).toBe('https://сервер');
    expect(scrub('https://rutracker.org/forum/viewtopic.php?t=1')).toBe('https://rutracker');
    expect(scrub('https://rutor.info/search/Foo')).toBe('https://rutor');
    expect(scrub('http://user:pw@nnmclub.to/x')).toBe('http://nnmclub');
  });
  it('replaces IPs, hashes, magnets, e-mails', () => {
    expect(scrub('нет ответа от 10.0.0.7:5555')).toBe('нет ответа от IP');
    expect(scrub('hash ' + 'a'.repeat(40) + ' ok')).toBe('hash hash ok');
    expect(scrub('open magnet:?xt=urn:btih:' + 'b'.repeat(40) + '&dn=Some+Title&tr=udp://t.example:80 done')).toBe('open magnet done');
    expect(scrub('писал me.name+x@mail.example.com вчера')).toBe('писал e-mail вчера');
  });
  it('keeps versions and plain text', () => {
    expect(scrub('Запуск OMP 0.14.0 · Android 14 · WebView 129')).toBe('Запуск OMP 0.14.0 · Android 14 · WebView 129');
  });
  it('hides secrets', () => {
    expect(scrub('form login=ivan&password=hunter2')).toBe('form login=***&password=***');
    expect(scrub('token=abc.def user=bob passwd=x')).toBe('token=*** user=*** passwd=***');
  });
  it('collapses whitespace and caps the length', () => {
    expect(scrub('a\n\n b\t c')).toBe('a b c');
    expect(scrub('x'.repeat(1000)).length).toBe(LOG_TEXT_MAX);
  });
  it('never throws on odd input', () => {
    expect(scrub(undefined as unknown as string)).toBe('');
    expect(scrub(null as unknown as string)).toBe('');
  });
});

describe('ring buffer and storage', () => {
  it('keeps the last LOG_MAX entries', () => {
    for (let i = 0; i < LOG_MAX + 25; i++) log('info', 'app', 'запись ' + i);
    const list = logEntries();
    expect(list.length).toBe(LOG_MAX);
    expect(list[0].x).toBe('запись 25');
    expect(list[LOG_MAX - 1].x).toBe('запись ' + (LOG_MAX + 24));
  });
  it('scrubs on write', () => {
    log('error', 'server', 'http://10.0.0.1:8090/x?a=1');
    expect(logEntries()[0].x).toBe('http://сервер');
  });
  it('drops an identical entry repeated at once, keeps it after a while', () => {
    vi.useFakeTimers();
    log('error', 'server', 'нет ответа');
    log('error', 'server', 'нет ответа');
    expect(logEntries().length).toBe(1);
    vi.advanceTimersByTime(31000);
    log('error', 'server', 'нет ответа');
    expect(logEntries().length).toBe(2);
  });
  it('saves debounced and reloads', () => {
    vi.useFakeTimers();
    localStorage.clear();
    log('warn', 'tv', 'ТВ не ответил');
    expect(localStorage.getItem(LOG_KEY)).toBeNull();
    vi.advanceTimersByTime(1100);
    expect(JSON.parse(localStorage.getItem(LOG_KEY)!).length).toBe(1);
    log('info', 'app', 'второй');
    flushLog();
    reloadLog();
    expect(logEntries().map((e) => e.x)).toEqual(['ТВ не ответил', 'второй']);
  });
  it('clear empties storage', () => {
    log('info', 'app', 'x');
    flushLog();
    clearLog();
    expect(logEntries()).toEqual([]);
    expect(JSON.parse(localStorage.getItem(LOG_KEY)!)).toEqual([]);
  });
  it('sanitizer drops malformed entries and scrubs old texts', () => {
    const out = sanitizeLog([
      { t: 1, l: 'info', a: 'app', x: 'ok' },
      { t: 2, l: 'fatal', a: 'app', x: 'bad level' },
      { t: 3, l: 'info', a: 'nope', x: 'bad area' },
      { t: 'x', l: 'info', a: 'app', x: 'bad time' },
      { t: 4, l: 'error', a: 'search', x: 'http://1.2.3.4/p?q=1' },
      null,
      'str',
    ]);
    expect(out.map((e) => e.x)).toEqual(['ok', 'http://сервер']);
    expect(sanitizeLog('nope')).toEqual([]);
    expect(sanitizeLog(Array.from({ length: LOG_MAX + 3 }, (_, i) => ({ t: i + 1, l: 'info', a: 'app', x: 'n' + i }))).length).toBe(LOG_MAX);
  });
  it('bad stored value falls back to an empty log', () => {
    localStorage.setItem(LOG_KEY, '{oops');
    reloadLog();
    expect(logEntries()).toEqual([]);
  });
  it('log() ignores bad level or area', () => {
    log('loud' as never, 'app', 'x');
    log('info', 'nowhere' as never, 'x');
    expect(logEntries()).toEqual([]);
  });
});

describe('format and GitHub URL', () => {
  it('formats a header and lines', () => {
    log('error', 'search', 'rutracker: сайт закрыт');
    const text = formatLog(info);
    expect(text).toContain('OMP: 0.14.0');
    expect(text).toContain('Android: 14');
    expect(text).toContain('Модель: Pixel 7');
    expect(text).toContain('WebView: 129');
    expect(text).toContain('Записей: 1');
    expect(text).toMatch(/\d{4}-\d\d-\d\d \d\d:\d\d:\d\d ОШИБКА поиск: rutracker: сайт закрыт/);
  });
  it('omits unknown device fields', () => {
    const text = formatLog({ version: '1', platform: 'Android TV' });
    expect(text).not.toContain('Android:');
    expect(text).not.toContain('WebView');
  });
  it('builds the new-issue URL with the title, the device and the last errors', () => {
    for (let i = 0; i < 3; i++) log('error', 'server', 'сбой ' + i);
    log('info', 'app', 'инфо не в отчёте');
    const url = githubIssueUrl(info);
    expect(url.indexOf('https://github.com/spacesarmat/omp/issues/new?title=')).toBe(0);
    const q = new URLSearchParams(url.slice(url.indexOf('?') + 1));
    expect(q.get('title')).toBe('Ошибка в OMP 0.14.0');
    const body = q.get('body')!;
    expect(body).toContain('0.14.0');
    expect(body).toContain('Pixel 7');
    expect(body).toContain('Что случилось:');
    expect(body).toContain('сбой 0');
    expect(body).toContain('сбой 2');
    expect(body).not.toContain('инфо не в отчёте');
    expect(body).not.toContain(LOG_COPIED_NOTE);
    // fully percent-encoded: ASCII only, no spaces or raw newlines
    expect(/^[\x21-\x7e]+$/.test(url)).toBe(true);
  });
  it('caps at 30 error lines and stays under the URL limit with a note', () => {
    vi.useFakeTimers();
    for (let i = 0; i < 100; i++) {
      vi.advanceTimersByTime(1);
      log('error', 'server', ('сбой ' + i + ' ').repeat(40));
    }
    const url = githubIssueUrl(info);
    expect(url.length).toBeLessThanOrEqual(ISSUE_URL_MAX);
    const body = new URLSearchParams(url.slice(url.indexOf('?') + 1)).get('body')!;
    expect(body).toContain(LOG_COPIED_NOTE);
    expect(body).toContain('сбой 99');
    expect(body).not.toContain('сбой 0 ');
  });
  it('without errors only the note', () => {
    log('info', 'app', 'x');
    const body = new URLSearchParams(githubIssueUrl(info).split('?')[1]).get('body')!;
    expect(body).toContain(LOG_COPIED_NOTE);
    expect(body).not.toContain('Последние ошибки');
  });
});

describe('helpers', () => {
  it('parses the user agent', () => {
    const ua = 'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UP1A.1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';
    expect(parseUserAgent(ua)).toEqual({ android: '14', model: 'Pixel 7', webview: '129' });
    expect(parseUserAgent('Mozilla/5.0 (Linux; Android 10; K) Chrome/110.0.0.0')).toEqual({ android: '10', webview: '110' });
    expect(parseUserAgent('')).toEqual({});
  });
  it('baseName keeps the file only', () => {
    expect(baseName('http://10.0.0.1:8090/assets/index-ab12.js?x=1')).toBe('index-ab12.js');
    expect(baseName('')).toBe('');
  });
  it('error hooks log message and file name, once', () => {
    installErrorHooks();
    installErrorHooks();
    window.dispatchEvent(new ErrorEvent('error', { message: 'boom', filename: 'http://10.0.0.1/a/b/main.js?q=1' }));
    const p = new Event('unhandledrejection') as Event & { reason?: unknown };
    p.reason = new Error('отклонено http://10.0.0.1/x?y=1');
    window.dispatchEvent(p);
    expect(logEntries().map((e) => e.x)).toEqual(['Ошибка: boom (main.js)', 'Необработанная ошибка: отклонено http://сервер']);
    expect(logEntries()[0].l).toBe('error');
  });
  it('error hooks survive odd reasons', () => {
    installErrorHooks();
    const p = new Event('unhandledrejection') as Event & { reason?: unknown };
    p.reason = undefined;
    expect(() => window.dispatchEvent(p)).not.toThrow();
    expect(logEntries().length).toBe(1);
  });
});
