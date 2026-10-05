function parts(v: string): number[] {
  if (!v) return [0];
  return v.split('.').map((x) => {
    const n = parseInt(x, 10);
    return isFinite(n) ? n : 0;
  });
}

function cmpParts(pa: number[], pb: number[]): number {
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** «0.16.0-beta.2» → main «0.16.0», pre «beta.2» ('' for a release). */
function split(v: string): { main: string; pre: string } {
  const s = (v || '').trim().replace(/^v/i, '');
  const i = s.indexOf('-');
  return i < 0 ? { main: s, pre: '' } : { main: s.slice(0, i), pre: s.slice(i + 1) };
}

/**
 * -1 / 0 / 1; numeric per dot-separated part, leading "v" ignored. A pre-release («0.16.0-beta.2») comes before its
 * release («0.16.0») and after every lower version; two pre-releases of one version compare by their number.
 */
export function compareVersions(a: string, b: string): number {
  const sa = split(a);
  const sb = split(b);
  const d = cmpParts(parts(sa.main), parts(sb.main));
  if (d) return d;
  if (!sa.pre || !sb.pre) return sa.pre === sb.pre ? 0 : sa.pre ? -1 : 1;
  return cmpParts(parts(sa.pre.replace(/^[^0-9]*/, '')), parts(sb.pre.replace(/^[^0-9]*/, '')));
}

/** A beta version («0.16.0-beta.1»). */
export function isBetaVersion(v: string): boolean {
  return /-beta\.[0-9]+$/.test((v || '').trim());
}
