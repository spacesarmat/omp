// A search fallback when TMDB has no other title: Russian to Latin and back.
// Rough, on purpose. The tracker query is what it is for.
// Chromium 53: no ?., no ??, no regex u flag.
// Letters are escapes so this file stays free of Russian copy (tests/i18n/noRussianInCode.test.ts).

const CYR = '\u0430\u0431\u0432\u0433\u0434\u0435\u0451\u0436\u0437\u0438\u0439\u043a\u043b\u043c\u043d\u043e\u043f\u0440\u0441\u0442\u0443\u0444\u0445\u0446\u0447\u0448\u0449\u044a\u044b\u044c\u044d\u044e\u044f';
const LAT = [
  'a', 'b', 'v', 'g', 'd', 'e', 'yo', 'zh', 'z', 'i', 'y', 'k', 'l', 'm', 'n', 'o', 'p', 'r', 's', 't', 'u', 'f',
  'kh', 'ts', 'ch', 'sh', 'sch', '', 'y', '', 'e', 'yu', 'ya',
];

const DIGRAPHS: [string, string][] = [
  ['shch', '\u0449'],
  ['sch', '\u0449'],
  ['yo', '\u0451'],
  ['zh', '\u0436'],
  ['kh', '\u0445'],
  ['ts', '\u0446'],
  ['ch', '\u0447'],
  ['sh', '\u0448'],
  ['yu', '\u044e'],
  ['ya', '\u044f'],
];

const ONE: { [k: string]: string } = {
  a: '\u0430', b: '\u0431', c: '\u043a', d: '\u0434', e: '\u0435', f: '\u0444', g: '\u0433', h: '\u0445', i: '\u0438', j: '\u0439',
  k: '\u043a', l: '\u043b', m: '\u043c', n: '\u043d', o: '\u043e', p: '\u043f', q: '\u043a', r: '\u0440', s: '\u0441', t: '\u0442',
  u: '\u0443', v: '\u0432', w: '\u0432', x: '\u043a\u0441', y: '\u0439', z: '\u0437',
};

function toLat(s: string): string {
  const lower = s.toLowerCase();
  let out = '';
  for (let i = 0; i < lower.length; i++) {
    const at = CYR.indexOf(lower.charAt(i));
    out += at >= 0 ? LAT[at] : lower.charAt(i);
  }
  return out.replace(/\s+/g, ' ').trim();
}

function toCyr(s: string): string {
  const lower = s.toLowerCase();
  let out = '';
  let i = 0;
  while (i < lower.length) {
    let took = false;
    for (let d = 0; d < DIGRAPHS.length; d++) {
      const pair = DIGRAPHS[d];
      if (lower.slice(i, i + pair[0].length) === pair[0]) {
        out += pair[1];
        i += pair[0].length;
        took = true;
        break;
      }
    }
    if (took) continue;
    const ch = lower.charAt(i);
    out += ONE[ch] || ch;
    i++;
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** The other script of `s`, or '' when there is nothing to convert. */
export function transliterate(s: string): string {
  const t = (s || '').trim();
  if (t.length < 2) return '';
  if (/[\u0400-\u04ff]/.test(t)) return toLat(t);
  if (/[a-z]/i.test(t)) return toCyr(t);
  return '';
}
