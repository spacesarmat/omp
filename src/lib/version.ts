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

/**
 * Android versionCode. Each patch has 100 slots: betas use 1..98, a stable release uses 99,
 * so 0.20.4-beta.1 < 0.20.4-beta.2 < 0.20.4 < 0.20.5-beta.1. The old code (major*10000+minor*100+patch)
 * had no room between 0.20.4 (2004) and 0.20.5 (2005), so beta.2 could not install over beta.1.
 * android/app/build.gradle computes the same numbers.
 */
export function androidVersionCode(version: string): number {
  const s = (version || '').trim().replace(/^v/i, '');
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?/.exec(s);
  if (!m) return 0;
  const major = parseInt(m[1], 10);
  const minor = parseInt(m[2], 10);
  const patch = parseInt(m[3], 10);
  const beta = m[4] ? parseInt(m[4], 10) : 0;
  const slot = beta === 0 ? 99 : Math.min(beta, 98);
  return major * 1000000 + minor * 10000 + patch * 100 + slot;
}
