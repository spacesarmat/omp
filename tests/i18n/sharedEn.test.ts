import { describe, it, expect, beforeEach } from 'vitest';
import { applyLanguageSetting } from '../../src/i18n';
import { apiError, errorMessage } from '../../src/api/http';
import { catalogReason, cachedBanner, catalogHint } from '../../src/lib/catalogState';
import { categoryTabs } from '../../src/lib/category';
import { addCategories } from '../../src/lib/categoryGuess';
import { donateMethods, supportEndText, supportUntil } from '../../src/lib/donate';
import { historyFilters, whenLabel, deviceLabel, sourceLine } from '../../src/lib/history';
import { installPlan, abiNote, type LgFacts, type AtvFacts } from '../../src/lib/installPlan';
import { sortLabel } from '../../src/lib/librarySearch';
import { libraryTabs, viewLabel, episodeLine, remainingLabel } from '../../src/lib/libraryView';
import { levelLabel, areaLabel, formatLog, githubIssueUrl, scrub } from '../../src/lib/log';
import { checkTitle } from '../../src/lib/renameTorrent';
import { cacheOptions, rateOptions, disconnectOptions } from '../../src/lib/serverSettingsOptions';
import { skipStatus } from '../../src/lib/skipMarks';
import { deriveName } from '../../src/lib/torrentName';
import { updateTitle } from '../../src/lib/updateInfo';
import { installStatus } from '../../src/platform/hbchannel';
import { describeApkError } from '../../src/platform/androidNative';
import { audioTrackList } from '../../src/platform/webosMedia';
import { addedMessage } from '../../src/store/library';
import { openWhatsNew, whatsNew } from '../../src/store/whatsNew';

const CYR = /[А-Яа-яЁё]/;

beforeEach(() => applyLanguageSetting('en'));

describe('shared modules in English', () => {
  it('api errors', () => {
    expect(errorMessage(apiError('network', 'x'))).toBe('Server unavailable');
    expect(errorMessage(apiError('http', 'x', 500))).toBe('Server error (500)');
    expect(errorMessage(null)).toBe('Unknown error');
    expect(errorMessage(apiError('timeout', 'x'))).not.toMatch(CYR);
  });

  it('catalog state', () => {
    expect(catalogReason(null, true)).toBe('No server selected');
    expect(catalogReason('Home', false)).toBe('No network connection');
    expect(catalogReason('Home', true)).toBe('Server “Home” is not responding');
    expect(cachedBanner(0)).toBe('Catalog unavailable · showing the saved list');
    expect(cachedBanner(new Date(2026, 0, 5, 9, 7).getTime())).toBe('Catalog unavailable · showing the list saved at 09:07');
    expect(catalogHint()).not.toMatch(CYR);
  });

  it('categories and library labels', () => {
    expect(categoryTabs().map((x) => x.label)).toEqual(['All', 'Movies', 'Series', 'Music', 'Other']);
    expect(addCategories()[0].label).toBe('No category');
    expect(libraryTabs()[0].label).toBe('History');
    expect(sortLabel('title')).toBe('By title');
    expect(viewLabel('compact')).toBe('Compact');
    expect(episodeLine('Show.S02E05.mkv', false)).toBe('Season 2 · Episode 5');
    expect(episodeLine('film.mkv', true)).toBe('Movie');
    expect(remainingLabel(0, 1800)).toBe('30 min left');
    expect(remainingLabel(0, 3 * 3600)).toBe('3 h left');
    expect(remainingLabel(30, 30)).toBe('less than a minute left');
  });

  it('history', () => {
    expect(historyFilters().map((x) => x.label)).toEqual(['All', 'From the TV', 'From the phone']);
    const now = new Date(2026, 4, 20, 12, 0).getTime();
    expect(whenLabel(new Date(2026, 4, 20, 9, 5).getTime(), now)).toBe('today 09:05');
    expect(whenLabel(new Date(2026, 4, 19, 22, 15).getTime(), now)).toBe('yesterday 22:15');
    expect(whenLabel(new Date(2026, 3, 30, 10, 0).getTime(), now)).toBe('April 30');
    expect(whenLabel(new Date(2025, 11, 31, 10, 0).getTime(), now)).toBe('December 31, 2025');
    expect(deviceLabel('phone', 'Pixel 7')).toBe('Phone “Pixel 7”');
    expect(sourceLine({ src: 'tv', at: 0 }, now)).toBe('TV');
  });

  it('support end date', () => {
    expect(supportEndText(supportUntil(2026, 11))).toBe('November 30');
    expect(donateMethods()[2].title).toBe('Cryptocurrency');
  });

  it('log', () => {
    expect(levelLabel('error')).toBe('ERROR');
    expect(areaLabel('install')).toBe('install');
    const text = formatLog({ version: '1.0', platform: 'Android TV', model: 'Box' }, []);
    expect(text).toContain('Platform: Android TV');
    expect(text).toContain('Model: Box');
    expect(text).toContain('Entries: 0');
    expect(text).not.toMatch(CYR);
    const url = decodeURIComponent(githubIssueUrl({ version: '1.0', platform: 'TV' }, true, []));
    expect(url).toContain('title=Error in OMP 1.0');
    expect(url).toContain('What happened:');
    expect(url).toContain('The log is copied');
    expect(url).not.toMatch(CYR);
    expect(scrub('open file:///x http://nas.local/a')).not.toMatch(CYR);
    expect(scrub('http://example.org/p')).toBe('http://server');
  });

  it('rename check, skip marks, torrent name', () => {
    const e = checkTitle('');
    expect(e.ok ? '' : e.error).toBe('Enter a title');
    const long = checkTitle('x'.repeat(201));
    expect(long.ok ? '' : long.error).toBe('At most 200 characters');
    expect(skipStatus(true, { i: false, c: false, mi: [45, 135] })).toBe('from the file chapters · manual: intro 0:45–2:15');
    expect(skipStatus(false, { i: false, c: false })).toBe('not set');
    const f = (path: string, id: number) => ({ id, path, length: 1000 });
    // the persisted title stays Russian whatever the UI language
    expect(deriveName([f('Moon.Garden.S13E01.1080p.mkv', 1), f('Moon.Garden.S13E02.1080p.mkv', 2)], 'x')).toBe('Moon Garden · Сезон 13');
  });

  it('server settings options', () => {
    expect(cacheOptions()[4].label).toBe('1 GB');
    expect(cacheOptions()[0].label).toBe('64 MB');
    expect(rateOptions().map((o) => o.label).slice(0, 2)).toEqual(['Unlimited', '1 MB/s']);
    expect(disconnectOptions()[0].label).toBe('30 s');
  });

  it('update and platform texts', () => {
    expect(updateTitle('0.16.0-beta.2', '0.15.0')).toBe('Beta 0.16.0-beta.2 available');
    expect(updateTitle('0.16.0', '0.16.0-beta.2')).toBe('OMP 0.16.0 is out and replaces the beta');
    expect(updateTitle('0.15.4', '0.15.0')).toBe('Version 0.15.4 available');
    expect(installStatus({ finished: true }).text).toBe('Done. Open OMP again');
    expect(installStatus({ progress: 41.6 }).text).toBe('Downloading… 42%');
    expect(installStatus({ statusText: 'verifying' }).text).toBe('Checking…');
    expect(describeApkError('boom')).toBe('Could not install the update: boom');
    expect(audioTrackList({ audioTracks: { length: 1, 0: {} } } as unknown as HTMLVideoElement)[0].label).toBe('Track 1');
  });

  it('library and what’s new stores', () => {
    const tor = (n: number) => ({ hash: 'h' + n, title: 'Film ' + n });
    expect(addedMessage([tor(1), tor(2)] as never)).toBe('Added: Film 1, Film 2');
    expect(addedMessage([tor(1), tor(2), tor(3), tor(4)] as never)).toBe('Torrents added: 4');
    openWhatsNew([], '0.16.0');
    expect(whatsNew.value && whatsNew.value.title).toBe('What’s new');
  });

  it('install plan', () => {
    const lg: LgFacts = { kind: 'lg', name: 'TV', ip: '1.1.1.1', model: 'OLED55C1', productName: 'webOSTV 6.0', paired: false };
    const texts = (p: ReturnType<typeof installPlan>) =>
      [p.subtitle].concat(p.notes, p.steps.map((s) => s.title + ' ' + s.text), p.actions.map((a) => a.label)).join('\n');
    const unpaired = installPlan(lg);
    expect(unpaired.steps[0].title).toBe('Connect to the TV');
    expect(unpaired.actions[0].label).toBe('Connect');
    expect(unpaired.subtitle).toBe('OLED55C1 · webOS 6.0 · connect to the TV first');
    expect(texts(unpaired)).not.toMatch(CYR);
    const devmode = installPlan({ ...lg, paired: true, apps: [], ompVersion: null });
    expect(devmode.actions.map((a) => a.label)).toContain('Install OMP and Homebrew Channel');
    expect(texts(devmode)).not.toMatch(CYR);
    const old = installPlan({ ...lg, paired: true, productName: 'webOSTV 3.0', model: undefined });
    expect(old.notes[0]).toBe('OMP needs webOS 4.0 or newer — roughly TVs from 2018 on. OMP does not work on webOS 3.0.');
    const atv: AtvFacts = { kind: 'atv', name: 'Box', ip: '1.1.1.2', model: 'Google TV', cast: 'tv', ompVersion: null, sdkInt: 29, abi: 'armeabi-v7a' };
    const p = installPlan(atv);
    expect(p.actions[0].label).toBe('Install OMP');
    expect(p.notes.join('\n')).not.toMatch(CYR);
    expect(texts(p)).not.toMatch(CYR);
    expect(abiNote('arm64-v8a')).toBe('arm64 — the built-in TorrServer will work.');
    expect(texts(installPlan({ kind: 'samsung', name: 'S', ip: '1.1.1.3' }))).not.toMatch(CYR);
  });
});
