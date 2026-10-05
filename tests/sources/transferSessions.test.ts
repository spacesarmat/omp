import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { applyRemoteSessions, parseRemoteSources, SESSION_SITES, siteLoginFromPhone, transferSessions, withoutNewParts } from '../../src/sources/transfer';
import { applyRemoteSourcesEvent, resetRemoteSources } from '../../src/platform/androidRemote';
import { tvBrowserLogin } from '../../src/sources/cloudflareTv';
import { setBrowserLoginPlatform } from '../../src/sources/browserLogin';
import { getHealth, reloadSourcePrefs, resetHealth, setHealth } from '../../src/sources/store';
import { clearLog, logEntries } from '../../src/lib/log';
import { kinozal } from '../../src/sources/kinozal';
import { rutracker } from '../../src/sources/rutracker';
import { resetMirrors } from '../../src/sources/mirrors';
import { fakeSite, page } from './fakeSite';
import type { SourceContext } from '../../src/sources/types';

beforeEach(() => {
  localStorage.clear();
  reloadSourcePrefs();
  resetHealth();
  resetMirrors();
  clearLog();
  resetRemoteSources();
});
afterEach(() => setBrowserLoginPlatform(null));

describe('browser sessions in the transfer', () => {
  it('the TV event names only the host of each session of a known site', () => {
    const r = parseRemoteSources({ id: 's1', sources: { kinozal: true }, rutracker: false, phone: 'P', sessions: { kinozal: 'kinozal.tv', rutracker: 'rutracker.org' } })!;
    expect(r.sessions).toEqual({ kinozal: 'kinozal.tv', rutracker: 'rutracker.org' });
    expect(SESSION_SITES).toContain('rutracker');
    for (const bad of [{ evil: 'evil.example' }, { kinozal: 'Kinozal.TV' }, { kinozal: true }, { kinozal: 'a b' }, 'x']) {
      expect(parseRemoteSources({ id: 's1', sources: { kinozal: true }, rutracker: false, phone: 'P', sessions: bad })).toBeNull();
    }
  });

  it('the phone sends only the sites signed in through the browser, with their hosts', async () => {
    const site = fakeSite(() => page('', ''), { 'kinozal.browser': '1', 'rutracker.username': 'u', 'rutracker.password': 'p' });
    expect(await transferSessions([kinozal, rutracker], site.ctx)).toEqual({ kinozal: ['kinozal.me', 'kinozal.guru', 'kinozal.tv'] });
    expect(await transferSessions([kinozal, rutracker], site.ctx, ['rutracker'])).toEqual({});
    // an older TV: nothing of the v0.15 parts goes
    expect(withoutNewParts({ v: 1, sources: { kinozal: true } })).toEqual({ v: 1, sources: { kinozal: true } });
  });

  it('Android TV: each session is checked natively; a verified one is promoted, the TV tells the native side', async () => {
    const checked: { site: string; path: string }[] = [];
    setBrowserLoginPlatform(
      tvBrowserLogin({
        siteBrowserLogin: () => Promise.resolve({ result: 'cancelled' }),
        siteSessionPending: (o) => {
          checked.push({ site: o.site, path: o.check.path });
          return Promise.resolve({ ok: o.site === 'kinozal', host: 'kinozal.tv' });
        },
      }),
    );
    setHealth('rutracker', { state: 'login', at: 1 });
    const calls: unknown[] = [];
    await applyRemoteSourcesEvent(
      { id: 's2', sources: { kinozal: true, rutracker: true }, rutracker: false, phone: 'Pixel', sessions: { kinozal: 'kinozal.tv', rutracker: 'rutracker.org' } },
      {
        remoteSourcesDone: (o) => {
          calls.push(o);
          return Promise.resolve({ stored: true, sitesNotStored: [] as string[] });
        },
      },
      () => [kinozal, rutracker],
      (): SourceContext => fakeSite(() => page('', '')).ctx,
    );
    expect(checked).toEqual([
      { site: 'kinozal', path: 'my.php' },
      { site: 'rutracker', path: 'forum/index.php' },
    ]);
    expect(calls).toEqual([{ id: 's2', sessions: { kinozal: 'ok', rutracker: 'error' } }]);
    expect(siteLoginFromPhone('kinozal')).toBe(true);
    expect(siteLoginFromPhone('rutracker')).toBe(false);
    // the TV keeps its earlier state for the one that did not verify
    expect(getHealth('rutracker')!.state).toBe('login');
    expect(JSON.stringify(logEntries())).toContain('вход через браузер на kinozal: ok');
  });

  it('a session on a host that is not the site\'s is an error without a native check', async () => {
    let asked = 0;
    setBrowserLoginPlatform({ login: () => Promise.resolve({ result: 'failed' }), pending: () => (asked++, Promise.resolve({ ok: true })) });
    const r = parseRemoteSources({ id: 's3', sources: { kinozal: true }, rutracker: false, phone: 'P', sessions: { kinozal: 'evil.example' } })!;
    expect(await applyRemoteSessions(r, [kinozal], () => fakeSite(() => page('', '')).ctx)).toEqual({ kinozal: 'error' });
    expect(asked).toBe(0);
  });
});
