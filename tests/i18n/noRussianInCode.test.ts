import { describe, it, expect } from 'vitest';
// @ts-ignore node builtins
import { readdirSync, readFileSync, statSync } from 'node:fs';
// @ts-ignore
import { join } from 'node:path';

/** Files still to migrate (each migration task removes its own; Task 14 leaves it empty). */
const PENDING: string[] = [
];
/** Not copy: tracker parsers and patterns (reason each). */
const ALLOWLIST: { [file: string]: string } = {
  'src/i18n/ru.ts': 'the Russian dictionary',
  'src/i18n/languageNames.ts': 'language names in their own language',
  'mobile/src/faq.ru.ts': 'Russian FAQ texts',
  'src/lib/faqLinks.ts': 'FAQ link keys: legacy Russian question texts resolved to item ids by OLD_Q_LINKS (language-independent)',
  'src/lib/librarySearch.ts': 'title matching (ё→е normalization)',
  'src/lib/tracks.ts': 'language names in their own language and audio-language tokens of file names (parsing)',
  'src/monitor/episodes.ts': 'tracker page parsing (season/episode patterns in tracker titles)',
  'mobile/src/tv/ssap.ts': 'LG pairing protocol: the signed localizedAppNames block copied verbatim from lgtv2 (its signature covers it)',
  'mobile/src/screens/Faq.tsx': 'FAQ search normalization (ё→е)',
  'src/sources/bigfangroup.ts': 'tracker page parsing (the site «nothing found» text)',
  'src/sources/html.ts': 'tracker page parsing (relative dates «вчера»)',
  'src/sources/kinozal.ts': 'tracker page parsing (copy migrated): category labels matched by the category mapper, «сейчас» in dates',
  'src/sources/merge.ts': 'tracker title matching (ё→е normalization)',
  'src/sources/rustorka.ts': 'tracker page parsing (copy migrated)',
  'src/sources/rutracker.ts': 'tracker page parsing (login form value, «дн» in the seeders cell)',
};

function files(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.(ts|tsx)$/.test(n) && !/\.d\.ts$/.test(n)) out.push(p.replace(/\\/g, '/'));
  }
  return out;
}

/** Removes comments (respecting strings, template literals and regex literals) and regex literals. */
export function stripCommentsAndRegexes(src: string): string {
  let out = '';
  let i = 0;
  const n = src.length;
  let prev = ''; // last significant char of the output: tells a regex literal from a division
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && d === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? n : end + 2;
      for (let k = i; k < stop; k++) if (src[k] === '\n') out += '\n';
      i = stop;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < n && src[j] !== c) {
        if (src[j] === '\\') j++;
        else if (c !== '`' && src[j] === '\n') break;
        j++;
      }
      out += src.slice(i, j + 1);
      i = j + 1;
      prev = c;
      continue;
    }
    if (c === '/' && (prev === '' || /[=(,:!&|?{};[+\-*%<>~^]/.test(prev) || /(return|typeof|case)$/.test(out.replace(/\s+$/, '')))) {
      let j = i + 1;
      let cls = false;
      while (j < n && src[j] !== '\n' && (cls || src[j] !== '/')) {
        if (src[j] === '\\') j++;
        else if (src[j] === '[') cls = true;
        else if (src[j] === ']') cls = false;
        j++;
      }
      if (j < n && src[j] === '/') {
        j++;
        while (j < n && /[a-z]/.test(src[j])) j++;
        out += '/RE/';
        i = j;
        prev = '/';
        continue;
      }
    }
    out += c;
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out;
}

/** Every code line with Cyrillic once comments and regex literals are stripped (string and template literals, JSX text, anything). */
export function russianCopy(src: string): string[] {
  const hits: string[] = [];
  for (const line of stripCommentsAndRegexes(src).split('\n')) if (/[А-Яа-яЁё]/.test(line)) hits.push(line.trim());
  return hits;
}

describe('no Russian copy outside the dictionaries', () => {
  const all = files('src').concat(files('mobile/src'));
  it('every file with Russian copy is migrated, allowlisted or still pending', () => {
    const offenders = all.filter((f) => !ALLOWLIST[f] && PENDING.indexOf(f) < 0 && russianCopy(readFileSync(f, 'utf8')).length > 0);
    expect(offenders).toEqual([]);
  });
  it('PENDING lists only files that still have Russian copy', () => {
    const done = PENDING.filter((f) => all.indexOf(f) < 0 || russianCopy(readFileSync(f, 'utf8')).length === 0);
    expect(done).toEqual([]);
  });
});

describe('the scanner itself', () => {
  it('finds Cyrillic in strings, templates and JSX text, ignores comments and regexes', () => {
    expect(russianCopy("const a = 'Привет';")).toHaveLength(1);
    expect(russianCopy('const a = `Итого ${n}`;')).toHaveLength(1);
    expect(russianCopy('const a = <b>Привет</b>;')).toHaveLength(1);
    expect(russianCopy("foo({ title: 'x', hint: \"a 'b' вот\" });")).toHaveLength(1);
    expect(russianCopy('// Привет\nconst a = 1; // и тут\n/* и\nтут */')).toEqual([]);
    expect(russianCopy("const u = 'http://x.y/'; const a = 'Привет';")).toHaveLength(1);
    expect(russianCopy('const r = /[а-я]+/i.test(s);')).toEqual([]);
    expect(russianCopy('x.replace(/ё/g, "е"); const a = "Привет";')).toHaveLength(1);
  });
});
