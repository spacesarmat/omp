import { describe, expect, it } from 'vitest';
import {
  ALERT_AFTER,
  classifyCheck,
  cutBytes,
  decide,
  emptyState,
  failureSignature,
  isoWeek,
  issueTitle,
  makeSnippet,
  parseState,
  redact,
  SNIPPET_BYTES,
  sourceStatus,
  summaryDue,
  validateResults,
  weeklySummary,
  type Check,
  type MonitorState,
  type Rules,
  type SourceReport,
} from '../../scripts/parser-monitor/logic';

const rules: Rules = { minResults: 2, category: 'all', link: 'magnet', seedsAny: true };
const MAGNET = 'magnet:?xt=urn:btih:' + 'a'.repeat(40);

function result(over: Record<string, unknown> = {}) {
  return { Title: 'Interstellar 2014', Size: '10 GB', sizeBytes: 10e9, Seed: 5, Magnet: MAGNET, Categories: 'Фильмы', ...over };
}

const page = (status: number, text = '<html><body>ok</body></html>') => ({ status, url: 'https://x.test/', text });

describe('validateResults', () => {
  it('accepts complete results', () => {
    expect(validateResults([result(), result()], rules).ok).toBe(true);
  });
  it('names the missing field when most rows lack it', () => {
    const v = validateResults([result({ Size: '' }), result({ Size: '' })], rules);
    expect(v.ok).toBe(false);
    expect(v.missing).toEqual(['size']);
  });
  it('tolerates one odd row among many', () => {
    const list = Array.from({ length: 20 }, () => result());
    list[3] = result({ Categories: '' });
    expect(validateResults(list, rules).ok).toBe(true);
  });
  it('wants some seeders on a popular query', () => {
    const v = validateResults([result({ Seed: 0 }), result({ Seed: 0 })], rules);
    expect(v.missing).toContain('seeders');
  });
  it('category "some" needs at least one', () => {
    const r: Rules = { ...rules, category: 'some' };
    expect(validateResults([result({ Categories: '' }), result()], r).ok).toBe(true);
    expect(validateResults([result({ Categories: '' }), result({ Categories: '' })], r).missing).toEqual(['category']);
  });
  it('link kinds', () => {
    const torrent: Rules = { ...rules, link: 'torrent' };
    expect(validateResults([result({ Magnet: '', Link: 'https://t/d.php?id=1' })], { ...torrent, minResults: 1 }).ok).toBe(true);
    expect(validateResults([result({ Magnet: '', Link: '' })], torrent).missing).toEqual(['link']);
    const detail: Rules = { ...rules, link: 'detail' };
    expect(validateResults([result({ Magnet: '', detailUrl: 'https://t/viewtopic.php?t=1' })], detail).ok).toBe(true);
  });
});

describe('classifyCheck', () => {
  const base = { label: 'поиск «x»', rules };
  it('OK with enough complete results', () => {
    expect(classifyCheck({ ...base, page: page(200), results: [result(), result()] }).status).toBe('OK');
  });
  it('BROKEN: page 200 but too few results', () => {
    const c = classifyCheck({ ...base, page: page(200), results: [] });
    expect(c.status).toBe('BROKEN');
    expect(c.reason).toBe('too-few');
  });
  it('BROKEN: parser error on a loaded page', () => {
    const c = classifyCheck({ ...base, page: page(200), error: { kind: 'parse', message: 'x' } });
    expect(c.status).toBe('BROKEN');
    expect(c.reason).toBe('parse-error');
  });
  it('BROKEN: fields missing', () => {
    expect(classifyCheck({ ...base, page: page(200), results: [result({ Size: '' }), result({ Size: '' })] }).reason).toBe('missing:size');
  });
  it('BLOCKED: Cloudflare challenge, even with status 200', () => {
    const c = classifyCheck({ ...base, page: page(200, '<title>Just a moment...</title>'), error: { kind: 'other', message: 'x' } });
    expect(c.status).toBe('BLOCKED');
    expect(c.reason).toBe('challenge');
    expect(classifyCheck({ ...base, page: { ...page(403), cfMitigated: 'challenge' }, results: [] }).status).toBe('BLOCKED');
  });
  it('BLOCKED: 403 / 451 / 5xx, timeouts, network, IP ban', () => {
    [403, 451, 429, 503].forEach((s) => expect(classifyCheck({ ...base, page: page(s), results: [] }).status).toBe('BLOCKED'));
    expect(classifyCheck({ ...base, error: { kind: 'timeout', message: '' } }).status).toBe('BLOCKED');
    expect(classifyCheck({ ...base, error: { kind: 'network', message: 'ENOTFOUND' } }).status).toBe('BLOCKED');
    expect(classifyCheck({ ...base, page: page(200), error: { kind: 'ipban', message: '' } }).status).toBe('BLOCKED');
  });
  it('BROKEN: 404 means the address changed', () => {
    expect(classifyCheck({ ...base, page: page(404), error: { kind: 'http', message: 'HTTP 404' } }).status).toBe('BROKEN');
  });
  it('PARTIAL: login required', () => {
    expect(classifyCheck({ ...base, page: page(200), error: { kind: 'login', message: 'нужен вход' } }).status).toBe('PARTIAL');
  });
});

function check(status: Check['status'], reason = status === 'OK' ? 'ok' : 'x'): Check {
  return { label: 'q', status, reason, detail: reason, results: status === 'OK' ? 10 : 0 };
}

describe('sourceStatus', () => {
  it('BROKEN when at least half the queries are broken', () => {
    expect(sourceStatus([check('BROKEN'), check('BROKEN'), check('OK')], undefined, 'none').status).toBe('BROKEN');
    expect(sourceStatus([check('BROKEN'), check('OK'), check('OK')], undefined, 'none').status).toBe('OK');
  });
  it('BLOCKED when nothing worked and something was blocked', () => {
    expect(sourceStatus([check('BLOCKED'), check('BLOCKED'), check('BLOCKED')], undefined, 'none').status).toBe('BLOCKED');
  });
  it('the link step: broken → BROKEN, blocked → PARTIAL', () => {
    expect(sourceStatus([check('OK')], check('BROKEN'), 'none').status).toBe('BROKEN');
    expect(sourceStatus([check('OK')], check('BLOCKED'), 'none').status).toBe('PARTIAL');
  });
  it('anonymous-only checks of a login site are PARTIAL', () => {
    const v = sourceStatus([check('OK'), check('OK')], undefined, 'missing');
    expect(v.status).toBe('PARTIAL');
    expect(v.detail).toBe('только без входа');
    expect(sourceStatus([check('BROKEN'), check('OK'), check('BROKEN')], undefined, 'missing').status).toBe('BROKEN');
  });
});

function report(id: string, status: SourceReport['status'], reason = 'too-few', login: SourceReport['login'] = 'none'): SourceReport {
  const c: Check = { label: 'поиск «Interstellar»', status, reason: status === 'OK' ? 'ok' : reason, detail: 'd', results: 0, httpStatus: 200 };
  return { id, name: id.toUpperCase(), status, detail: 'подробности', login, checks: [c, { ...c }], at: '2026-10-07T12:17:00.000Z' };
}

// a Wednesday, outside the summary window
const WED = new Date('2026-10-07T12:17:00Z');

describe('decide', () => {
  it('alerts only after ALERT_AFTER broken runs in a row, once', () => {
    let st: MonitorState = emptyState();
    let d = decide(st, [report('rutor', 'BROKEN')], { now: WED });
    expect(ALERT_AFTER).toBe(2);
    expect(d.actions).toEqual([]);
    st = d.state;
    d = decide(st, [report('rutor', 'BROKEN')], { now: WED, runUrl: 'https://run' });
    expect(d.actions).toHaveLength(1);
    const a = d.actions[0];
    expect(a.kind).toBe('open');
    if (a.kind === 'open') {
      expect(a.title).toBe(issueTitle('RUTOR'));
      expect(a.title).toBe('Парсер RUTOR сломан');
      expect(a.telegram).toContain('{issue}');
      expect(a.body).toContain('https://run');
    }
    st = d.state;
    expect(st.sources.rutor.alerted).toBe(true);
    // the same failure again: silence
    d = decide(st, [report('rutor', 'BROKEN')], { now: WED });
    expect(d.actions).toEqual([]);
  });

  it('comments when the failure changes', () => {
    let st = decide(emptyState(), [report('a', 'BROKEN')], { now: WED }).state;
    st = decide(st, [report('a', 'BROKEN')], { now: WED }).state;
    const d = decide(st, [report('a', 'BROKEN', 'parse-error')], { now: WED });
    expect(d.actions.map((x) => x.kind)).toEqual(['comment']);
    expect(d.state.sources.a.signature).toBe('parse-error');
  });

  it('closes with a Telegram note when it works again (OK or PARTIAL)', () => {
    let st = decide(emptyState(), [report('a', 'BROKEN'), report('b', 'BROKEN')], { now: WED }).state;
    st = decide(st, [report('a', 'BROKEN'), report('b', 'BROKEN')], { now: WED }).state;
    const d = decide(st, [report('a', 'OK'), report('b', 'PARTIAL', 'x', 'missing')], { now: WED });
    expect(d.actions.map((x) => x.kind)).toEqual(['close', 'close']);
    expect(d.state.sources.a.alerted).toBe(false);
  });

  it('a recovery without an alert says nothing; BLOCKED never alerts and keeps an alert open', () => {
    let st = decide(emptyState(), [report('a', 'BROKEN')], { now: WED }).state;
    expect(decide(st, [report('a', 'OK')], { now: WED }).actions).toEqual([]);
    st = decide(emptyState(), [report('a', 'BLOCKED')], { now: WED }).state;
    st = decide(st, [report('a', 'BLOCKED')], { now: WED }).state;
    expect(st.sources.a.streak).toBe(2);
    let s2 = decide(emptyState(), [report('a', 'BROKEN')], { now: WED }).state;
    s2 = decide(s2, [report('a', 'BROKEN')], { now: WED }).state;
    const d = decide(s2, [report('a', 'BLOCKED')], { now: WED });
    expect(d.actions).toEqual([]);
    expect(d.state.sources.a.alerted).toBe(true);
  });

  it('a broken streak is cut by a non-broken run', () => {
    let st = decide(emptyState(), [report('a', 'BROKEN')], { now: WED }).state;
    st = decide(st, [report('a', 'BLOCKED')], { now: WED }).state;
    expect(decide(st, [report('a', 'BROKEN')], { now: WED }).actions).toEqual([]);
  });

  it('weekly summary: Monday window, once a week, or forced', () => {
    const mon = new Date('2026-10-12T12:17:00Z');
    const d = decide(emptyState(), [report('a', 'OK')], { now: mon });
    expect(d.actions.map((x) => x.kind)).toEqual(['telegram']);
    expect(d.state.summaryWeek).toBe(isoWeek(mon));
    expect(decide(d.state, [report('a', 'OK')], { now: new Date('2026-10-13T00:17:00Z') }).actions).toEqual([]);
    expect(decide(emptyState(), [report('a', 'OK')], { now: WED, forceSummary: true }).actions.map((x) => x.kind)).toEqual(['telegram']);
  });
});

describe('summary schedule', () => {
  it('isoWeek', () => {
    expect(isoWeek(new Date('2026-01-01T10:00:00Z'))).toBe('2026-W01');
    expect(isoWeek(new Date('2027-01-01T10:00:00Z'))).toBe('2026-W53');
    expect(isoWeek(new Date('2026-10-12T00:00:00Z'))).toBe('2026-W42');
  });
  it('the 12:17 Monday run, not the 00:17 one', () => {
    expect(summaryDue(undefined, new Date('2026-10-12T00:17:00Z'))).toBe(false);
    expect(summaryDue(undefined, new Date('2026-10-12T12:17:00Z'))).toBe(true);
    expect(summaryDue('2026-W42', new Date('2026-10-12T12:17:00Z'))).toBe(false);
    // a late Monday run (delayed past midnight) still counts
    expect(summaryDue('2026-W41', new Date('2026-10-13T03:00:00Z'))).toBe(true);
    expect(summaryDue(undefined, new Date('2026-10-13T12:17:00Z'))).toBe(false);
  });
  it('weeklySummary text', () => {
    const text = weeklySummary([
      report('rutor', 'OK'),
      report('rutracker', 'PARTIAL', 'x', 'missing'),
      report('kinozal', 'BLOCKED'),
      report('anidub', 'BROKEN'),
    ]);
    expect(text).toBe('Парсеры: ✅ RUTOR, ⚠️ RUTRACKER (только без входа), 🚫 KINOZAL (блокирует GitHub), ❌ ANIDUB (сломан)');
  });
});

describe('state file', () => {
  it('parses a saved state and drops junk', () => {
    const st = parseState({
      version: 1,
      summaryWeek: '2026-W41',
      sources: { a: { status: 'BROKEN', streak: 3, since: 's', alerted: true, signature: 'too-few' }, b: { status: 'nope' }, c: null },
    });
    expect(Object.keys(st.sources)).toEqual(['a']);
    expect(st.sources.a).toMatchObject({ status: 'BROKEN', streak: 3, alerted: true, signature: 'too-few' });
    expect(st.summaryWeek).toBe('2026-W41');
    expect(parseState('garbage')).toEqual(emptyState());
  });
  it('failureSignature lists the broken reasons once', () => {
    const r = report('a', 'BROKEN');
    expect(failureSignature(r)).toBe('too-few');
  });
});

describe('snippet', () => {
  it('starts near the marker, is at most 3 KB and drops scripts', () => {
    const html = '<html><head><script>var secret=1</script></head><body>' + 'x'.repeat(5000) + '<table id="index">' + 'Фильм '.repeat(2000) + '</table></body></html>';
    const s = makeSnippet(html, ['id="index"']);
    expect(s).toContain('id="index"');
    expect(s).not.toContain('secret');
    expect(new TextEncoder().encode(s).length).toBeLessThanOrEqual(SNIPPET_BYTES);
  });
  it('without a marker: the start of the body', () => {
    expect(makeSnippet('<head><title>t</title></head><body><p>hello</p></body>', ['nope'])).toBe('<body><p>hello</p></body>');
  });
  it('masks sessions, hidden values and the login name', () => {
    const r = redact('<a href="x.php?sid=abc123&t=1">u</a><input type="hidden" name="form_token" value="deadbeef"> hello myuser', ['myuser']);
    expect(r).not.toContain('abc123');
    expect(r).not.toContain('deadbeef');
    expect(r).not.toContain('myuser');
  });
  it('cutBytes keeps whole characters', () => {
    expect(cutBytes('яяя', 5)).toBe('яя');
    expect(cutBytes('a😀', 4)).toBe('a');
  });
});
