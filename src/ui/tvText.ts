/** Glyphs the LG TV font lacks (non-breaking hyphen, minus, thin spaces, soft hyphen) to ones it has. */
// keep the \u escapes: literal invisible characters get stripped or normalized by editors without anyone noticing
export function tvGlyphs(s: string): string {
  return s.replace(/[‐‑−]/g, '-').replace(/[   ]/g, ' ').replace(/[­​⁠]/g, '');
}
