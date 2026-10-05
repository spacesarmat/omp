// The phone modules outside the screens (backup, installer, local server, TV client, support code, QR, native,
// watch) in Russian and English: no Cyrillic in English copy.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { applyLanguageSetting } from '../../src/i18n';
import {
  backupFileName,
  backupWarning,
  summaryLines,
  parseBackup,
  errTooBig,
  errNotJson,
  errFormat,
  errVersionNew,
  errVersion,
  errTooMany,
  errEmpty,
} from '../src/lib/backup';
import { errorText, hbcErrorText, createProgress } from '../src/install/installer';
import { takeoverQuestion } from '../src/install/session';
import { downloadSize, localName } from '../src/server/localServer';
import * as tv from '../src/tv/tvClient';
import { codeBad, codeExpired } from '../src/supportCode';
import { notOmpQr, scanUnavailable, scanPrepareFailed } from '../src/platform/qr';
import { onlyAndroid } from '../src/platform/native';
import { noWifi } from '../src/watch';
import { supportThanks } from '../src/donate';

const CYR = /[А-Яа-яЁё]/;
const noCyr = (list: string[]) => expect(list.filter((s) => CYR.test(s))).toEqual([]);

const SUMMARY = {
  servers: ['Home', 'Cabin'],
  tvs: ['LG'],
  subs: 2,
  sources: 5,
  indexers: 1,
  playlists: 3,
  tracks: 1,
  hasPassword: true,
  hasPairKeys: true,
  settings: true,
};

describe('phone modules in English', () => {
  beforeEach(() => applyLanguageSetting('en'));
  afterEach(() => applyLanguageSetting('ru'));

  it('backup: file name, summary, warnings and errors', () => {
    expect(backupFileName(new Date(2026, 9, 3, 12).getTime())).toBe('omp-backup-2026-10-03.json');
    const lines = summaryLines(SUMMARY);
    expect(lines).toEqual([
      'TorrServer servers: 2 (Home, Cabin)',
      'TVs: 1 (LG)',
      '2 monitoring subscriptions',
      'Search sources: 5 switches',
      'Indexers (Jackett, Prowlarr): 1 — without API keys, the keys will have to be entered again',
      'Favorite playlists: 3',
      'Track choices: 1 torrent',
      'App, monitoring and touchpad settings, catalog view',
    ]);
    noCyr(lines);
    noCyr([backupWarning(), backupWarning({ ...SUMMARY, hasPassword: false, hasPairKeys: false })]);
    expect(parseBackup('not json')).toEqual({ ok: false, error: 'This is not an OMP backup: the file could not be read' });
    noCyr([errTooBig(), errNotJson(), errFormat(), errVersionNew(), errVersion(), errTooMany(), errEmpty()]);
  });

  it('installer: errors, Homebrew Channel notes, progress and the takeover question', () => {
    const codes = ['network', 'release', 'checksum', 'too-big', 'phone-space', 'key-server', 'wrong-passphrase', 'ssh-closed', 'ssh-auth', 'low-space', 'install-failed', 'signature', 'abi', 'old-android', 'adb-closed', 'unauthorized', 'auth-timeout', 'unreachable', 'timeout', 'connection', 'cancelled', 'busy', '???'];
    noCyr(codes.map(errorText));
    expect(errorText('???')).toBe('Could not install OMP. Please try again.');
    noCyr(['checksum', 'network', 'low-space', 'other'].map(hbcErrorText));
    const progress = createProgress('lg-devmode', true);
    const v = progress({ phase: 'download', item: 'omp', version: '0.13.1', percent: 40 } as any);
    expect(v.title).toBe('Installing OMP 0.13.1');
    expect(v.text).toBe('Downloading OMP from GitHub · 40%');
    expect(takeoverQuestion('LG', { ip: '1.1.1.1', name: 'Kitchen' })).toBe('Connect to “LG”? The current connection to “Kitchen” will be closed.');
  });

  it('local server: name and download size', () => {
    expect(localName()).toBe('This phone');
    expect(downloadSize({ supported: true, running: false, downloadBytes: 64174032 })).toBe('~61 MB');
  });

  it('TV client messages', () => {
    const texts = [
      tv.tvNotConnected(),
      tv.tvNoOmp(),
      tv.tvNoAnswer(),
      tv.tvDeclined(),
      tv.tvPointerDenied(),
      tv.tvForgot(),
      tv.atvBackground(),
      tv.atvUnsupported(),
      tv.pairBadCode(),
      tv.atvRejected(),
      tv.atvError(),
      tv.pairExpired(),
      tv.sourcesAtvOnly(),
      tv.sourcesBusy(),
      tv.sourcesNoAnswer(),
      tv.sourcesFailed(),
      tv.sourcesSecrets(),
      tv.sourcesRejected(),
    ];
    expect(tv.tvNoOmp()).toBe('OMP is not installed on the TV');
    noCyr(texts);
  });

  it('support code, QR, native and watch texts', () => {
    expect(codeBad()).toBe('This code does not work');
    noCyr([codeBad(), codeExpired(), notOmpQr(), scanUnavailable(), scanPrepareFailed(), onlyAndroid(), noWifi()]);
    const thanks = supportThanks(new Date(2026, 10, 1).getTime(), true);
    expect(thanks).toMatch(/^Thank you! Support requests are hidden until /);
    noCyr([thanks, supportThanks(new Date(2026, 10, 1).getTime(), false)]);
  });
});
