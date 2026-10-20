import { describe, it, expect } from 'vitest';
// @ts-ignore node builtin, no @types/node in this project
import { readFileSync } from 'node:fs';
// @ts-ignore plain .mjs script
import { changelogNotes } from '../../scripts/hb-lib.mjs';
// @ts-ignore plain .mjs script
import { buildCaption } from '../../scripts/telegram-lib.mjs';

const RU = readFileSync('CHANGELOG.md', 'utf8');
const EN = readFileSync('CHANGELOG.en.md', 'utf8');

/** Bullets per section heading ("## x.y.z" or «Не выпущено» / Unreleased). */
function sections(md: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let cur: string[] | null = null;
  md.split(/\r?\n/).forEach((line) => {
    const h = /^##\s+(.+?)\s*$/.exec(line);
    if (h) {
      const key = h[1] === 'Не выпущено' ? 'Unreleased' : h[1];
      cur = [];
      out.set(key, cur);
      return;
    }
    const b = /^\s*[-*]\s+(.*\S)\s*$/.exec(line);
    if (b && cur) cur.push(b[1]);
  });
  return out;
}

const techCount = (items: string[]) => items.filter((i) => /^\[tech\]/i.test(i)).length;

describe('«[tech]» bullets in CHANGELOG.md and CHANGELOG.en.md', () => {
  const ru = sections(RU);
  const en = sections(EN);

  it('every version the English file has carries the same number of «[tech]» bullets as the Russian one', () => {
    expect(en.size).toBeGreaterThan(10);
    const diff: string[] = [];
    en.forEach((items, version) => {
      const r = ru.get(version);
      if (!r) return;
      if (techCount(r) !== techCount(items)) diff.push(`${version}: ru ${techCount(r)}, en ${techCount(items)}`);
    });
    expect(diff).toEqual([]);
  });

  it('«[tech]» is never combined with a platform marker', () => {
    [RU, EN].forEach((md) => {
      expect(md).not.toMatch(/^\s*[-*]\s+\[(tv|lg|atv|phone)\]\s*\[tech\]/im);
      expect(md).not.toMatch(/^\s*[-*]\s+\[tech\]\s*\[(tv|lg|atv|phone)\]/im);
    });
  });

  it('0.20.5 keeps its technical bullets out of the Telegram caption and still has five user bullets', () => {
    const notes = changelogNotes(RU, '0.20.5');
    expect(notes.length).toBeGreaterThanOrEqual(5);
    expect(changelogNotes(RU, '0.20.5', undefined, { includeTech: true }).length).toBeGreaterThan(notes.length);
    const caption = buildCaption('0.20.5', notes);
    expect(caption).not.toMatch(/tech|Postgres|админк/i);
    expect(caption.match(/• /g)).toHaveLength(5);
  });
});
