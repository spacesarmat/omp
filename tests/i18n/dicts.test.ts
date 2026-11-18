import { describe, it, expect } from 'vitest';
import { DICTS, type Lang } from '../../src/i18n';
import { ru } from '../../src/i18n/ru';

type Node = { [k: string]: unknown };

const CYRILLIC = /[А-Яа-яЁёІіЇїЄєҐґ]/;
/** Languages that must not carry Cyrillic in their pack. */
const NO_CYRILLIC: Lang[] = ['en', 'uz', 'tk', 'az', 'ro', 'hy', 'ka'];
/** Languages declining one/few/many like Russian (ro with its own rule, same forms). */
const SLAVIC_FORMS: Lang[] = ['ru', 'uk', 'be', 'ro'];

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

/** Walks the Russian dictionary and a pack together and lists every mismatch. */
function compare(r: Node, e: Node, path: string, problems: Problem[], lang: Lang): void {
  const keys = Object.keys(r).concat(Object.keys(e).filter((k) => !(k in r)));
  const noCyr = NO_CYRILLIC.indexOf(lang) >= 0;
  const slavic = SLAVIC_FORMS.indexOf(lang) >= 0;
  for (const k of keys) {
    const p = path ? path + '.' + k : k;
    const rv = r[k];
    const ev = e[k];
    if (!(k in r)) {
      problems.push({ key: p, issue: 'extra in ' + lang });
      continue;
    }
    if (!(k in e)) {
      problems.push({ key: p, issue: 'missing in ' + lang });
      continue;
    }
    if (typeof rv === 'string') {
      if (typeof ev !== 'string') {
        problems.push({ key: p, issue: lang + ' is not a string' });
        continue;
      }
      if (!rv) problems.push({ key: p, issue: 'empty ru' });
      if (!ev) problems.push({ key: p, issue: 'empty ' + lang });
      if (noCyr && CYRILLIC.test(ev)) problems.push({ key: p, issue: 'Cyrillic in ' + lang });
      if (placeholders(rv).join() !== placeholders(ev).join()) problems.push({ key: p, issue: 'placeholders differ' });
    } else if (isRuPlural(rv)) {
      const rp = rv as Node;
      const forms = isObj(ev) ? (ev as Node) : null;
      const shapeOk = forms && (slavic
        ? typeof forms.one === 'string' && typeof forms.few === 'string' && typeof forms.many === 'string' && Object.keys(forms).length === 3
        : typeof forms.one === 'string' && typeof forms.other === 'string' && Object.keys(forms).length === 2);
      if (!shapeOk) {
        problems.push({ key: p, issue: lang + ' plural must have exactly ' + (slavic ? 'one/few/many' : 'one/other') });
        continue;
      }
      if (Object.keys(rp).length !== 3) problems.push({ key: p, issue: 'ru plural must have exactly one/few/many' });
      const list = (slavic ? [rp.one, rp.few, rp.many, forms!.one, forms!.few, forms!.many] : [rp.one, rp.few, rp.many, forms!.one, forms!.other]) as string[];
      const ref = placeholders(list[0]).join();
      list.forEach((f, i) => {
        if (!f) problems.push({ key: p, issue: 'empty plural form ' + i });
        if (placeholders(f).join() !== ref) problems.push({ key: p, issue: 'plural placeholders differ in form ' + i });
        if (placeholders(f).indexOf('n') < 0) problems.push({ key: p, issue: 'plural form ' + i + ' lacks {n}' });
        if (noCyr && i >= 3 && CYRILLIC.test(f)) problems.push({ key: p, issue: 'Cyrillic in ' + lang });
      });
    } else if (isObj(rv)) {
      if (!isObj(ev)) {
        problems.push({ key: p, issue: lang + ' is not an object' });
        continue;
      }
      compare(rv, ev, p, problems, lang);
    } else {
      problems.push({ key: p, issue: 'ru value is neither a string, a plural nor a group' });
    }
  }
}

describe('dictionaries', () => {
  it('every landed pack has the same keys, placeholders and plural forms as ru', () => {
    const problems: Problem[] = [];
    for (const [l, dict] of Object.entries(DICTS)) {
      if (l === 'ru') continue;
      compare(ru as unknown as Node, dict as Node, '', problems, l as Lang);
    }
    expect(problems).toEqual([]);
  });

  it('the checker catches mismatches', () => {
    const problems: Problem[] = [];
    compare(
      { a: 'Вход на {site}', b: { one: '{n} раз', few: '{n} раза', many: '{n} раз' }, c: 'x' },
      { a: 'Sign in', b: { one: 'once', other: '{n} times' }, d: 'y' },
      '',
      problems,
      'en',
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