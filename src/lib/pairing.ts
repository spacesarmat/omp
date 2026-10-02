export interface PairData {
  url: string;
  name?: string;
  user?: string;
  password?: string;
}

const PREFIX = 'omp://pair?';
const FIELDS: (keyof PairData)[] = ['url', 'name', 'user', 'password'];

/** QR payload shown on the TV («Подключить телефон») and scanned by the phone. */
export function buildPairUri(d: PairData): string {
  let s = PREFIX + 'v=1';
  FIELDS.forEach((k) => {
    const v = d[k];
    if (v) s += '&' + k + '=' + encodeURIComponent(v);
  });
  return s;
}

export function parsePairUri(s: string): PairData | null {
  if (typeof s !== 'string' || s.indexOf(PREFIX) !== 0) return null;
  const out: { [k: string]: string } = {};
  let version = '';
  try {
    s.slice(PREFIX.length).split('&').forEach((part) => {
      const eq = part.indexOf('=');
      if (eq < 0) return;
      const k = part.slice(0, eq);
      const v = decodeURIComponent(part.slice(eq + 1));
      if (k === 'v') version = v;
      else if (FIELDS.indexOf(k as keyof PairData) >= 0 && v) out[k] = v;
    });
  } catch (e) {
    return null;
  }
  if (version !== '1' || !out.url) return null;
  return out as unknown as PairData;
}
