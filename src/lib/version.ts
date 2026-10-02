function parts(v: string): number[] {
  const s = (v || '').trim().replace(/^v/i, '');
  if (!s) return [0];
  return s.split('.').map((x) => {
    const n = parseInt(x, 10);
    return isFinite(n) ? n : 0;
  });
}

/** -1 / 0 / 1; numeric per dot-separated part, leading "v" ignored. */
export function compareVersions(a: string, b: string): number {
  const pa = parts(a);
  const pb = parts(b);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}
