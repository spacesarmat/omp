import { describe, it, expect } from 'vitest';
import { ru } from '../../src/i18n/ru';
import { en } from '../../src/i18n/en';

type Node = { [k: string]: unknown };

const CYRILLIC = /[А-Яа-яЁё]/;
/** Names a language in that language (the language switch): the same in both dictionaries. */
const NATIVE_NAMES = ['settings.language.ru'];

function isObj(v: unknown): v is Node {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function isRuPlural(v: unknown): boolean {
  return isObj(v) && typeof v.one === 'string' && typeof v.few === 'string' && typeof v.many === 'string';
}

function placeholders(s: string): string[] {
  const out: string[] = [];
  s.replace(/\{(\w+)\}/g, (_m, k: string) => {
    if (out.indexOf(k) < 0) out.push(k);
    return '';
  });
  return out.sort();
}

interface Problem {
  key: string;
  issue: string;
}

/** Walks both dictionaries together and lists every mismatch. */
function compare(r: Node, e: Node, path: string, problems: Problem[]): void {
  const keys = Object.keys(r).concat(Object.keys(e).filter((k) => !(k in r)));
  for (const k of keys) {
    const p = path ? path + '.' + k : k;
    const rv = r[k];
    const ev = e[k];
    if (!(k in r)) {
      problems.push({ key: p, issue: 'extra in en' });
      continue;
    }
    if (!(k in e)) {
      problems.push({ key: p, issue: 'missing in en' });
      continue;
    }
    if (typeof rv === 'string') {
      if (typeof ev !== 'string') {
        problems.push({ key: p, issue: 'en is not a string' });
        continue;
      }
      if (!rv) problems.push({ key: p, issue: 'empty ru' });
      if (!ev) problems.push({ key: p, issue: 'empty en' });
      if (CYRILLIC.test(ev) && NATIVE_NAMES.indexOf(p) < 0) problems.push({ key: p, issue: 'Cyrillic in en' });
      if (placeholders(rv).join() !== placeholders(ev).join()) problems.push({ key: p, issue: 'placeholders differ' });
    } else if (isRuPlural(rv)) {
      const rp = rv as Node;
      if (!isObj(ev) || typeof ev.one !== 'string' || typeof ev.other !== 'string' || Object.keys(ev).length !== 2) {
        problems.push({ key: p, issue: 'en plural must have exactly one/other' });
        continue;
      }
      if (Object.keys(rp).length !== 3) problems.push({ key: p, issue: 'ru plural must have exactly one/few/many' });
      const forms = [rp.one, rp.few, rp.many, ev.one, ev.other] as string[];
      const ref = placeholders(forms[0]).join();
      forms.forEach((f, i) => {
        if (!f) problems.push({ key: p, issue: 'empty plural form ' + i });
        if (placeholders(f).join() !== ref) problems.push({ key: p, issue: 'plural placeholders differ in form ' + i });
        if (placeholders(f).indexOf('n') < 0) problems.push({ key: p, issue: 'plural form ' + i + ' lacks {n}' });
      });
      if (CYRILLIC.test(ev.one as string) || CYRILLIC.test(ev.other as string)) problems.push({ key: p, issue: 'Cyrillic in en' });
    } else if (isObj(rv)) {
      if (!isObj(ev)) {
        problems.push({ key: p, issue: 'en is not an object' });
        continue;
      }
      compare(rv, ev, p, problems);
    } else {
      problems.push({ key: p, issue: 'ru value is neither a string, a plural nor a group' });
    }
  }
}

describe('dictionaries', () => {
  it('ru and en have the same keys, placeholders and plural forms; en has no Cyrillic', () => {
    const problems: Problem[] = [];
    compare(ru as unknown as Node, en as unknown as Node, '', problems);
    expect(problems).toEqual([]);
  });

  it('the checker catches mismatches', () => {
    const problems: Problem[] = [];
    compare(
      { a: 'Вход на {site}', b: { one: '{n} раз', few: '{n} раза', many: '{n} раз' }, c: 'x' },
      { a: 'Sign in', b: { one: 'once', other: '{n} times' }, d: 'y' },
      '',
      problems,
    );
    expect(problems.map((x) => x.key + ': ' + x.issue)).toEqual([
      'a: placeholders differ',
      'b: plural placeholders differ in form 3',
      'b: plural form 3 lacks {n}',
      'c: missing in en',
      'd: extra in en',
    ]);
  });
});
