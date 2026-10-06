/** Glyphs the LG TV font lacks (non-breaking hyphen, minus, thin spaces, soft hyphen) → ones it has. */
export function tvGlyphs(s: string): string {
  return s.replace(/[‐‑−]/g, '-').replace(/[   ]/g, ' ').replace(/[­​⁠]/g, '');
}
