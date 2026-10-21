import { describe, it, expect } from 'vitest';
// @ts-ignore node builtin
import { readFileSync } from 'node:fs';
import type { Route } from '../../src/ui/nav';
import { FAQ } from '../../src/faq/faq';
import { KEYPAD_ROWS } from '../../src/lib/addressKeypad';
import { builtinParsers } from '../../src/sources/builtin';
import { renderScreenCodesDoc } from '../../src/testmode/doc';
import {
  FAQ_IDS,
  KP_KEYS,
  SITE_IDS,
  anchorItem,
  lookupScreen,
  registryProblems,
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
      'src/testmode/active.ts',
      'src/testmode/badge.tsx',
      'src/testmode/doc.ts',
      'docs/screen-codes.md',
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
  });
});
