import { normalizeCode } from './code';

/** Extract a subscription code from omp://billing?code=XXXX-XXXX (or /go/ redirects that land here). */
export function parseBillingDeepLink(url: string): string | null {
  const raw = String(url || '').trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol === 'omp:') {
      const host = (u.hostname || '').toLowerCase();
      const path = (u.pathname || '').toLowerCase();
      if (host === 'billing' || path.indexOf('billing') >= 0 || host === '') {
        const fromQuery = u.searchParams.get('code') || u.searchParams.get('c');
        if (fromQuery && normalizeCode(fromQuery).length === 8) return fromQuery;
        const parts = (u.pathname || '').split('/').filter(Boolean);
        const last = parts[parts.length - 1] || '';
        if (normalizeCode(last).length === 8) return last;
      }
    }
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      const m = u.pathname.match(/\/go\/([^/]+)/i);
      if (m && normalizeCode(m[1]).length === 8) return decodeURIComponent(m[1]);
      const q = u.searchParams.get('code');
      if (q && normalizeCode(q).length === 8) return q;
    }
  } catch {
    /* not a URL */
  }
  return null;
}
