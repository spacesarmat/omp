import { describe, it, expect, beforeEach } from 'vitest';
import { applyLanguageSetting } from '../../src/i18n';
import { browserText, browserTitle, browserSignedIn, browserTvErrors, tvLoginRequest, phoneLoginRequest, sessionNotVerified, browserLoginText, browserDone, watchNotifyLogin } from '../../src/sources/browserLogin';
import { cfFailed, cfInteractive, isCfInteractiveMessage, toCloudflareError } from '../../src/sources/cloudflare';
import { bypassWarning, clearanceText, phoneCheckRequest, sheetTitle, tvCheckRequest, tvErrors, tvSiteNote, watchNotify } from '../../src/sources/cloudflareCheck';
import { checkText, flareBadAddress, tvFlareLines, phoneFlareNote, tvFlareNone, flareIntro } from '../../src/sources/flaresolverr';
import { indexerBadKey, indexerError, indexerNoFile } from '../../src/sources/indexer';
import { candidateWhere, plainHttpWarning } from '../../src/sources/indexerDiscovery';
import { checkedText, connLine, summaryText, trackerStateText, statusError } from '../../src/sources/indexerStatus';
import { indexerBadUrl, indexerNoKey, torznabHiddenText } from '../../src/sources/indexerStore';
import { rutrackerBadLogin, rutrackerCaptcha } from '../../src/sources/rutrackerText';
import { challenge, parseError } from '../../src/sources/site';
import { siteBadLogin, siteCaptcha, siteLoginError } from '../../src/sources/siteLoginText';
import { transferWhen } from '../../src/sources/transfer';
import { noNative } from '../../src/sources/tvContext';
import { loginRequired } from '../../src/sources/types';
import { healthText, jackettHint, progressText, seedsText, sortLabels } from '../../src/sources/view';
import { kinozalNoFile } from '../../src/sources/kinozal';
import { rustorkaNoFile } from '../../src/sources/rustorka';
import { getSource } from '../../src/sources/registry';

const noHttpStub = { get: () => Promise.reject(new Error('x')), post: () => Promise.reject(new Error('x')), clearCookies: () => Promise.resolve() };
const CYR = /[А-Яа-яЁё]/;
const SPEC = { url: 'https://x.example/login', site: 'Kinozal', source: 'kinozal', hosts: ['x.example'], check: { path: 'my.php', marker: 'logout', loginPath: 'login.php' } };

beforeEach(() => applyLanguageSetting('en'));

describe('search sources in English', () => {
  it('sign in with the browser', () => {
    expect(browserLoginText()).toBe('Sign in with browser');
    expect(browserTitle('Kinozal')).toBe('Sign in to Kinozal');
    expect(browserSignedIn('rutracker')).toBe('Signed in to rutracker');
    expect(browserDone()).toBe('signed in with the browser');
    expect(browserText('Living room')).toMatch(/^Sign in on the site as usual.*It is needed for the TV “Living room”\.$/);
    expect(watchNotifyLogin()).toBe('The TV asks to sign in to %s');
    expect(sessionNotVerified()).toBe('The sign-in from the phone was not confirmed');
    const tv = tvLoginRequest(SPEC, true);
    expect(tv.phone).toBe('Sign in on the phone');
    expect(tv.cancel).toBe('Cancel');
    expect(tv.hint).toBe('Phone “%s” will get a request');
    const phone = phoneLoginRequest(SPEC, { id: 'c1', tv: 'TV' });
    expect(phone.title).toBe('Sign in to Kinozal');
    const all = JSON.stringify([tv, phone, browserTvErrors()]);
    expect(all).not.toMatch(CYR);
    expect(Object.keys(browserTvErrors())).toContain('NOT_TAKEN');
  });

  it('the Cloudflare check', () => {
    expect(sheetTitle()).toBe('Confirm you are not a robot');
    expect(bypassWarning()).toMatch(/^Bypassing the check may break/);
    expect(watchNotify()).toBe('The TV asks to pass a check on %s');
    const tv = tvCheckRequest({ name: 'rustorka', url: 'https://r.example/' });
    expect(tv.title).toBe('rustorka: Cloudflare check');
    expect(tv.phone).toBe('Pass on the phone');
    expect(phoneCheckRequest({ name: 'rustorka', url: 'https://r.example/' }, { id: 'c7', tv: 'Home' }).text).toBe(
      'The site rustorka asks you to pass a Cloudflare check. It is needed for the TV “Home”.',
    );
    expect(JSON.stringify([tv, tvErrors()])).not.toMatch(CYR);
    expect(tvSiteNote(false, false, null).text).toBe('off');
    expect(tvSiteNote(true, true, null).text).toBe('check needed — pass it on the phone');
    expect(tvSiteNote(true, false, null).text).toBe('Cloudflare bypass');
    const until = new Date(2026, 9, 5, 22, 40).getTime();
    expect(clearanceText(until, until - 1000)).toBe('check passed · valid until 22:40');
    expect(tvSiteNote(true, false, until, until - 1000).text).toBe('Cloudflare bypass · check passed · valid until 22:40');
  });

  it('the Cloudflare error is found by its code or by the native Russian message, and shown in English', () => {
    const byMessage = toCloudflareError({ message: 'Сайт просит пройти проверку Cloudflare вручную' }, 'https://r.example/path');
    expect(byMessage!.code).toBe('cloudflare-interactive');
    expect(byMessage!.message).toBe(cfInteractive());
    expect(byMessage!.message).toBe('The site asks for a Cloudflare check to be passed by hand');
    const byCode = toCloudflareError({ code: 'cloudflare', message: 'x' }, 'https://r.example/');
    expect(byCode!.message).toBe(cfFailed());
    expect(toCloudflareError({ message: 'Сайт закрыт проверкой Cloudflare — пройти её не удалось' }, 'https://r.example/')!.code).toBe('cloudflare');
    expect(isCfInteractiveMessage(byMessage!.message)).toBe(true);
    expect(toCloudflareError(new Error('other'), 'https://r.example/')).toBeNull();
  });

  it('FlareSolverr', () => {
    expect(flareBadAddress()).toBe('Wrong address');
    expect(flareIntro()).toMatch(/^A program on your server/);
    expect(checkText({ ok: true, version: '3.4.0', ms: 340 })).toBe('Working · version 3.4 · answer 0.3 s');
    expect(checkText({ ok: false, message: 'x' })).toBe('x');
    expect(tvFlareLines(null, null).state).toBe(tvFlareNone());
    expect(tvFlareLines('http://192.168.1.1:8191', { url: 'http://192.168.1.1:8191', check: { ok: true, version: '3.4.0', ms: 1 }, at: 1 })).toEqual({
      where: '192.168.1.1:8191 · version 3.4',
      state: 'Working — a fallback for sites behind Cloudflare',
      tone: 'ok',
    });
    expect(phoneFlareNote(null, null).text).toBe('not set · a fallback for sites behind Cloudflare');
    expect(phoneFlareNote('http://1.2.3.4:8191', { url: 'http://1.2.3.4:8191', check: { ok: false, message: 'x' }, at: 1 }).text).toBe('1.2.3.4:8191 · not responding');
  });

  it('Jackett and Prowlarr', () => {
    expect(indexerBadKey()).toBe('Wrong API key');
    expect(indexerError(502)).toBe('The indexer answered with error 502');
    expect(statusError(500)).toBe('The indexer answered with error 500');
    expect(indexerNoFile()).toBe('Could not download the torrent file');
    expect(indexerBadUrl()).toBe('Wrong address: it should look like http://192.168.1.5:9117');
    expect(indexerNoKey()).toBe('Enter the API key');
    expect(torznabHiddenText(true)).toMatch(/^Torznab \(TorrServer\) is hidden/);
    expect(plainHttpWarning('http://example.com:9117')).toBe('The address is outside the home network and without https: the key is sent unencrypted');
    expect(candidateWhere({ kind: 'jackett', url: 'http://192.168.1.2:9117', host: '192.168.1.2:9117', network: true, torrserver: false })).toBe('192.168.1.2:9117 · found in the network');
    const trackers = [
      { name: 'a', state: 'ok' as const },
      { name: 'b', state: 'error' as const },
      { name: 'c', state: 'ok' as const },
    ];
    const status = { state: 'ok' as const, at: 1, trackers };
    expect(summaryText(status)).toBe('3 trackers, 2 working');
    expect(summaryText({ state: 'ok', at: 1, trackers: [{ name: 'a', state: 'ok' }] })).toBe('1 tracker, 1 working');
    expect(summaryText({ state: 'ok', at: 1, trackers: [] })).toBe('no trackers');
    expect(connLine(status, true).text).toBe('direct · 3 trackers, 2 working');
    expect(connLine(status, false).text).toBe('off · 3 trackers, 2 working');
    expect(connLine(null, true).text).toBe('direct · checking…');
    expect(connLine({ state: 'nokey', at: 1, trackers: [] }, true).text).toBe('API key needed');
    expect(trackerStateText({ name: 'a', state: 'error', detail: 'x' }, true)).toBe('error: x');
    expect(trackerStateText({ name: 'a', state: 'login' })).toBe('sign-in needed');
    expect(checkedText(0, 30 * 1000)).toBe('Checked just now');
    expect(checkedText(0, 5 * 60000)).toBe('Checked 5 minutes ago');
    expect(checkedText(0, 3600000)).toBe('Checked 1 hour ago');
    expect(checkedText(0, 2 * 86400000)).toBe('Checked 2 days ago');
  });

  it('sites: sign-in and page errors', async () => {
    expect(rutrackerBadLogin()).toBe('Wrong username or password');
    expect(rutrackerCaptcha()).toBe('RuTracker asks for a captcha — tap “Sign in with browser”');
    expect(siteBadLogin()).toBe('Wrong username or password');
    expect(siteCaptcha('Kinozal')).toBe('Kinozal asks for a captcha — tap “Sign in with browser”');
    expect(siteLoginError('captcha', 'Kinozal').message).toBe(siteCaptcha('Kinozal'));
    expect(challenge()).toBe('The site is behind a browser check (Cloudflare), try later');
    expect(parseError()).toBe('Could not parse the site page');
    expect(kinozalNoFile()).toMatch(/^Kinozal did not give the torrent/);
    expect(rustorkaNoFile()).toMatch(/^rustorka did not give the torrent/);
    expect(noNative()).toBe('Available only in the Android app');
    expect(loginRequired().message).toBe('Sign-in needed');
    await expect(getSource('ts-rutor')!.search('q', { http: noHttpStub, client: null })).rejects.toThrow('No server');
  });

  it('results screen texts', () => {
    expect(seedsText(1)).toBe('1 seed');
    expect(seedsText(312)).toBe('312 seeds');
    expect(progressText({ found: 7, answered: 3, total: 4, pending: ['rutor'], failed: [] })).toBe('Found 7 · 3 of 4 sources answered · still searching rutor…');
    expect(progressText({ found: 7, answered: 1, total: 1, pending: [], failed: ['rutor'] })).toBe('Found 7 · 1 of 1 source answered · no answer: rutor');
    expect(healthText({ state: 'ok', ms: 340, at: 1 })!.text).toBe('working · 0.3 s');
    expect(healthText({ state: 'login', at: 1 })!.text).toBe('sign-in needed');
    expect(healthText({ state: 'error', at: 1 })!.text).toBe('not responding');
    expect(sortLabels().map((s) => s.label)).toEqual(['By seeds', 'By date', 'By size']);
    expect(jackettHint()).toMatch(/^Is the site blocked by Cloudflare\?/);
    const now = new Date(2026, 9, 5, 12, 0).getTime();
    expect(transferWhen(now - 3600000, now).day).toBe('today');
    expect(transferWhen(now - 86400000, now).day).toBe('yesterday');
    const all = [seedsText(5), progressText({ found: 1, answered: 1, total: 2, pending: [], failed: [] }), jackettHint(), sortLabels()[0].label];
    all.forEach((s) => expect(s).not.toMatch(CYR));
  });
});
