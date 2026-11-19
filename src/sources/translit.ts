// A search fallback when TMDB has no other title: Russian to Latin and back.
// Rough, on purpose (ё -> yo, щ -> sch). The tracker query is what it is for.
// Chromium 53: no ?., no ??, no regex u flag.

const CYR = 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя';
const LAT = [
  'a', 'b', 'v', 'g', 'd', 'e', 'yo', 'zh', 'z', 'i', 'y', 'k', 'l', 'm', 'n', 'o', 'p', 'r', 's', 't', 'u', 'f',
  'kh', 'ts', 'ch', 'sh', 'sch', '', 'y', '', 'e', 'yu', 'ya',
];

const DIGRAPHS: [string, string][] = [
  ['shch', 'щ'],
  ['sch', 'щ'],
  ['yo', 'ё'],
  ['zh', 'ж'],
  ['kh', 'х'],
  ['ts', 'ц'],
  ['ch', 'ч'],
  ['sh', 'ш'],
  ['yu', 'ю'],
  ['ya', 'я'],
];

const ONE: { [k: string]: string } = {
  a: 'а', b: 'б', c: 'к', d: 'д', e: 'е', f: 'ф', g: 'г', h: 'х', i: 'и', j: 'й', k: 'к', l: 'л', m: 'м',
  n: 'н', o: 'о', p: 'п', q: 'к', r: 'р', s: 'с', t: 'т', u: 'у', v: 'в', w: 'в', x: 'кс', y: 'й', z: 'з',
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
  if (/[а-яё]/i.test(t)) return toLat(t);
  if (/[a-z]/i.test(t)) return toCyr(t);
  return '';
}
