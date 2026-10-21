import { describe, it, expect } from 'vitest';
// @ts-ignore node builtin
import { readFileSync, readdirSync } from 'node:fs';
// @ts-ignore node builtin
import { join } from 'node:path';
import type { Route } from '../../src/ui/nav';
import { FAQ } from '../../src/faq/faq';
import { KEYPAD_ROWS } from '../../src/lib/addressKeypad';
import { builtinParsers } from '../../src/sources/builtin';
import type { MRoute } from '../../mobile/src/nav';
import { renderScreenCodesDoc } from '../../src/testmode/doc';
import {
  FAQ_IDS,
  KP_KEYS,
  SITE_IDS,
  anchorItem,
  dialogs,
  lookupPhone,
  lookupScreen,
  registryProblems,
  screens,
} from '../../src/testmode/registry';

function codeOf(name: Route['name']): string {
  switch (name) {
    case 'connect': return 'S09';
    case 'library': return 'S01';
    case 'torrent': return 'S03';
    case 'series': return 'S04';
    case 'player': return 'S06';
    case 'add': return 'S07';
    case 'playlist': return 'S08';
    case 'settings': return 'S05';
    case 'advanced': return 'S10';
    case 'faq': return 'S11';
    case 'pairPhone': return 'S12';
    case 'update': return 'S13';
    case 'title': return 'S14';
    case 'person': return 'S15';
    case 'sources': return 'S17';
    case 'tsSources': return 'S17';
    default: {
      const n: never = name;
      return n;
    }
  }
}

const NAMES: Route['name'][] = [
  'connect', 'library', 'torrent', 'series', 'player', 'add', 'playlist',
  'settings', 'advanced', 'update', 'sources', 'tsSources', 'pairPhone', 'faq', 'title', 'person',
];

describe('screen code registry', () => {
  it('has no duplicate or malformed codes', () => {
    expect(registryProblems()).toEqual([]);
  });

  it('maps every route to a stable screen', () => {
    for (let i = 0; i < NAMES.length; i++) {
      const name = NAMES[i];
      const screen = lookupScreen(name, 'all', 'androidtv');
      expect(screen && screen.code).toBe(codeOf(name));
    }
    expect(lookupScreen('library', 'discover', 'webos')!.code).toBe('S02');
    expect(lookupScreen('library', 'news', 'webos')!.code).toBe('S18');
    expect(lookupScreen('sources', 'all', 'webos')!.code).toBe('S16');
    expect(lookupScreen('sources', 'all', 'androidtv')!.code).toBe('S17');
    expect(lookupScreen('tsSources', 'all', 'webos')!.code).toBe('S17');
  });

  it('keeps FAQ question ids in STRUCT order', () => {
    expect(FAQ_IDS.join('\n')).toBe(FAQ.map((it) => it.id).join('\n'));
    expect(anchorItem('faq-lg-version')!.code).toBe('S11.10');
    expect(anchorItem('faq-telegram')!.code).toBe('S11.' + (10 + FAQ_IDS.length - 1));
  });

  it('keeps keypad keys and built-in sites in UI order', () => {
    const keys: string[] = [];
    for (let r = 0; r < KEYPAD_ROWS.length; r++) {
      for (let c = 0; c < KEYPAD_ROWS[r].length; c++) keys.push(KEYPAD_ROWS[r][c]);
    }
    expect(keys.join(',')).toBe(KP_KEYS.join(','));
    expect(builtinParsers().map((s) => s.id).join(',')).toBe(SITE_IDS.map((s) => s[0]).join(','));
    expect(anchorItem('src-ts-rutor')!.code).toBe('S17.1');
    expect(anchorItem('src-ts-torznab')!.code).toBe('S17.2');
  });

  it('matches docs/screen-codes.md', () => {
    expect(readFileSync('docs/screen-codes.md', 'utf8')).toBe(renderScreenCodesDoc());
  });

  it('keeps the new sources free of special dashes and banned CSS', () => {
    const files = [
      'src/testmode/registry.ts',
      'src/testmode/extra.ts',
      'src/testmode/active.ts',
      'src/testmode/badge.tsx',
      'src/testmode/doc.ts',
      'docs/screen-codes.md',
      'mobile/src/testmode/host.tsx',
      'android/app/src/main/java/com/spacesarmat/omp/player/PlayerTestHud.kt',
      'android/app/src/main/java/com/spacesarmat/omp/sources/CloudflareCheckDialog.kt',
    ];
    for (let i = 0; i < files.length; i++) {
      const text = readFileSync(files[i], 'utf8');
      expect(text).not.toMatch(/[\u2013\u2014]/);
    }
    const css = readFileSync('src/styles.css', 'utf8');
    const at = css.indexOf('.test-anchor');
    expect(at).toBeGreaterThan(0);
    const chunk = css.slice(at);
    expect(chunk).toContain('font-size: 24px');
    expect(chunk).not.toMatch(/[^-\w]gap\s*:/);
    expect(chunk).not.toContain(':has(');
    expect(chunk).not.toContain('aspect-ratio');
    expect(chunk).not.toMatch(/[^-\w]inset\s*:/);
    const phone = readFileSync('mobile/src/mobile.css', 'utf8');
    const pat = phone.indexOf('body.test-labels .tm');
    expect(pat).toBeGreaterThan(0);
    const phoneChunk = phone.slice(pat);
    expect(phoneChunk).toContain('font-size: 24px');
    expect(phoneChunk).not.toMatch(/[^-\w]gap\s*:/);
    expect(phoneChunk).not.toContain(':has(');
    expect(phoneChunk).not.toContain('aspect-ratio');
    expect(phoneChunk).not.toMatch(/[^-\w]inset\s*:/);
  });
});

function phoneCode(name: MRoute['name']): string {
  switch (name) {
    case 'connect': return 'P01';
    case 'library': return 'P02';
    case 'news': return 'P03';
    case 'subFindings': return 'P04';
    case 'monitor': return 'P05';
    case 'torrent': return 'P06';
    case 'add': return 'P07';
    case 'remote': return 'P08';
    case 'nowPlaying': return 'P09';
    case 'tv': return 'P10';
    case 'settings': return 'P11';
    case 'account': return 'P12';
    case 'advanced': return 'P13';
    case 'videoPlayer': return 'P14';
    case 'serverSettings': return 'P15';
    case 'localServer': return 'P16';
    case 'faq': return 'P17';
    case 'install': return 'P18';
    case 'log': return 'P19';
    case 'backup': return 'P20';
    case 'sources': return 'P21';
    case 'flaresolverr': return 'P22';
    case 'sourceSite': return 'P23';
    case 'title': return 'P24';
    case 'seasonCard': return 'P25';
    case 'series': return 'P26';
    case 'person': return 'P27';
    case 'audiobooks': return 'P28';
    case 'audiobookSearch': return 'P29';
    case 'audiobookMine': return 'P30';
    case 'audiobook': return 'P31';
    case 'audiobookPlayer': return 'P32';
    default: {
      const n: never = name;
      return n;
    }
  }
}

const PHONE_NAMES: MRoute['name'][] = [
  'connect', 'library', 'news', 'subFindings', 'monitor', 'torrent', 'add', 'remote', 'nowPlaying', 'tv',
  'settings', 'account', 'advanced', 'videoPlayer', 'serverSettings', 'localServer', 'faq', 'install', 'log',
  'backup', 'sources', 'flaresolverr', 'sourceSite', 'title', 'seasonCard', 'series', 'person', 'audiobooks',
  'audiobookSearch', 'audiobookMine', 'audiobook', 'audiobookPlayer',
];

function readTree(dir: string, out: string[]): void {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const p = join(dir, e.name);
    if (e.isDirectory()) readTree(p, out);
    else if (/\.(tsx|ts|kt)$/.test(e.name)) out.push(readFileSync(p, 'utf8'));
  }
}

function quoted(blob: string, code: string): boolean {
  return blob.indexOf('"' + code + '"') >= 0 || blob.indexOf("'" + code + "'") >= 0;
}

describe('phone and native Android TV codes', () => {
  it('maps every phone route, and browse separately from mine', () => {
    for (let i = 0; i < PHONE_NAMES.length; i++) {
      const name = PHONE_NAMES[i];
      const screen = lookupPhone(name, name === 'library' ? 'mine' : '');
      expect(screen && screen.code).toBe(phoneCode(name));
    }
    expect(lookupPhone('library', 'discover')!.code).toBe('P34');
    expect(lookupPhone('library', 'mine')!.code).toBe('P02');
  });

  it('is wired in the phone UI and the native player', () => {
    const phoneFiles: string[] = [];
    readTree('mobile/src', phoneFiles);
    const phone = phoneFiles.join('\n');
    const nativeFiles: string[] = [];
    readTree('android/app/src/main/java/com/spacesarmat/omp/player', nativeFiles);
    readTree('android/app/src/main/java/com/spacesarmat/omp/sources', nativeFiles);
    const native = nativeFiles.join('\n');
    const confirmIds: { [code: string]: true } = {};
    const nativeDialog: { [code: string]: true } = {};
    const ds = dialogs();
    for (let i = 0; i < ds.length; i++) {
      if (ds[i].id.indexOf('p-confirm-') === 0) confirmIds[ds[i].code] = true;
      if (ds[i].id.indexOf('native-') === 0) nativeDialog[ds[i].code] = true;
    }
    const list = screens().concat();
    const all = list.map((s) => s.code);
    for (let s = 0; s < list.length; s++) {
      for (let i = 0; i < list[s].items.length; i++) {
        const it = list[s].items[i];
        all.push(it.code);
        const options = it.options || [];
        for (let o = 0; o < options.length; o++) all.push(options[o].code);
      }
    }
    for (let d = 0; d < ds.length; d++) {
      all.push(ds[d].code);
      for (let i = 0; i < ds[d].items.length; i++) all.push(ds[d].items[i].code);
    }
    const missing: string[] = [];
    for (let i = 0; i < all.length; i++) {
      const code = all[i];
      if (code.charAt(0) === 'S' || code.charAt(0) === 'D') continue;
      if (code.charAt(0) === 'A' || nativeDialog[code] || nativeDialog[code.slice(0, code.lastIndexOf('.'))]) {
        if (!quoted(native, code)) missing.push(code);
        continue;
      }
      if (quoted(phone, code)) continue;
      const dot = code.lastIndexOf('.');
      if (dot > 0 && confirmIds[code.slice(0, dot)]) continue;
      // Screen codes are painted from the route, not written next to a control.
      if (/^P[0-9]+$/.test(code)) continue;
      missing.push(code);
    }
    expect(missing).toEqual([]);
  });
});
