import { describe, it, expect } from 'vitest';
// @ts-ignore node builtins
import { readdirSync, readFileSync, statSync } from 'node:fs';
// @ts-ignore
import { join } from 'node:path';

/** Files still to migrate (each migration task removes its own; Task 14 leaves it empty). */
const PENDING: string[] = [
  'mobile/src/faq.ts',
];
/** Not copy: tracker parsers and patterns (reason each). */
const ALLOWLIST: { [file: string]: string } = {
  'src/i18n/ru.ts': 'the Russian dictionary',
  'src/i18n/languageNames.ts': 'language names in their own language',
  'mobile/src/faq.ru.ts': 'Russian FAQ texts',
  'src/lib/faqLinks.ts': 'FAQ question keys, matched by text against the Russian FAQ (faq.ru.ts)',
  'src/lib/librarySearch.ts': 'title matching (ё→е normalization)',
  'src/lib/tracks.ts': 'language names in their own language and audio-language tokens of file names (parsing)',
  'src/monitor/episodes.ts': 'tracker page parsing (season/episode patterns in tracker titles)',
  'mobile/src/tv/ssap.ts': 'LG pairing protocol: the signed localizedAppNames block copied verbatim from lgtv2 (its signature covers it)',
  'mobile/src/screens/Faq.tsx': 'FAQ search normalization (ё→е) of the question texts',
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

/** Cyrillic in string/template literals or JSX text; comments are stripped first. */
export function russianCopy(src: string): string[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  const hits: string[] = [];
  const re = /(['"`])((?:\\.|(?!\1)[^\\\n])*[А-Яа-яЁё](?:\\.|(?!\1)[^\\\n])*)\1|>([^<>{}]*[А-Яа-яЁё][^<>{}]*)</g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) hits.push((m[2] || m[3]).trim());
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
