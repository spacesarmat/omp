/**
 * Text for the LG TV font: swaps glyphs it lacks for ones it has.
 *  - hyphens and the minus sign (U+2010, U+2011, U+2212) become a plain hyphen, thin and narrow spaces (U+2009, U+200A,
 *    U+202F) a space; the soft hyphen, zero-width space, word joiner, zero-width joiner and variation selectors vanish;
 *  - emoji, dingbats (U+2700-27BF), miscellaneous symbols (U+2600-26FF) and geometric shapes (U+25A0-25FF), which show as
 *    boxes there, become one plain space between the words around them, except the shapes the UI draws itself
 *    (U+25A0, U+25CF, U+25B2, U+25BC, U+25C0, U+25B6).
 */
// keep the escapes: literal invisible characters get stripped or normalized by editors without anyone noticing
// astral emoji (U+10000 and up) are matched as surrogate pairs: no /u flag, Chromium 53 on the TV
const LACKING = /[\u2600-\u27BF\u25A0-\u25FF]|[\uD800-\uDBFF][\uDC00-\uDFFF]/g;
const KEEP = /^[\u25A0\u25CF\u25B2\u25BC\u25C0\u25B6]$/;
const MARK = '\u0000';

export function tvGlyphs(s: string): string {
  let out = s
    .replace(/[\u2010\u2011\u2212]/g, '-')
    .replace(/[\u2009\u200A\u202F]/g, ' ')
    .replace(/[\u00AD\u200B\u2060\u200D\uFE00-\uFE0F]/g, '');
  const marked = out.replace(LACKING, (m) => (KEEP.test(m) ? m : MARK));
  if (marked.indexOf(MARK) < 0) return out;
  // a run of such characters (with the spaces around it) is one space; at the ends of the text it is dropped
  out = marked.replace(/\s*\u0000(?:\s*\u0000)*\s*/g, ' ');
  return out.replace(/^ | $/g, '');
}
