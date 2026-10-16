const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** Hostname of an http(s) URL or a bare host, lower case, without a zone id. Null when it cannot be read. */
export function hostOf(url: string): string | null {
  const s = (url || '').trim();
  if (!s) return null;
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : 'http://' + s;
    const host = new URL(withScheme).hostname.replace(/^\[|\]$/g, '').split('%')[0].toLowerCase();
    return host || null;
  } catch {
    return null;
  }
}

/** The same hosts [CleartextPolicy] allows without the user list: loopback, .local, private and link-local. No DNS. */
export function isLanOrLocal(host: string): boolean {
  let h = host.trim().toLowerCase();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  h = h.split('%')[0];
  if (!h) return false;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h === '::1') return true;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(h);
  if (mapped) h = mapped[1];
  const m = IPV4.exec(h);
  if (m) {
    const o = [1, 2, 3, 4].map((i) => Number(m[i]));
    if (o.some((n) => n > 255)) return false;
    if (o[0] === 127 || o[0] === 10) return true;
    if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return true;
    if (o[0] === 192 && o[1] === 168) return true;
    if (o[0] === 169 && o[1] === 254) return true;
    return false;
  }
  if (h.indexOf(':') < 0) return false;
  if (!/^[0-9a-f:]+$/.test(h)) return false;
  if (h.startsWith('fe80:')) return true;
  return h.startsWith('fc') || h.startsWith('fd');
}

/** The public host the user just typed, kept until the next typed address so its /echo is not blocked. */
let typedHost: string | null = null;

/** Remember [url]'s host when it is public HTTP the policy would otherwise refuse. A LAN address clears it. */
export function allowTypedHost(url: string): void {
  const h = hostOf(url);
  typedHost = h && !isLanOrLocal(h) ? h : null;
}

/** [urls] plus the typed host, when one is waiting to be saved. */
export function withTyped(urls: string[]): string[] {
  return typedHost ? urls.concat(typedHost) : urls.slice();
}

/** Unique hosts from URLs and bare addresses. */
export function cleartextHosts(urls: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < urls.length; i++) {
    const h = hostOf(urls[i]);
    if (!h || seen.has(h)) continue;
    seen.add(h);
    out.push(h);
  }
  return out;
}

/** True for plain HTTP to a host that is not already LAN or local — the fetch must wait for the native allow-list. */
export function needsAllowlist(url: string): boolean {
  const s = (url || '').trim();
  if (!/^http:\/\//i.test(s)) return false;
  const h = hostOf(s);
  return !!h && !isLanOrLocal(h);
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

/**
 * Public `http://` waits until [allow] has registered the current hosts. LAN and https do not wait
 * (a poster fetch must not stall on the plugin).
 */
export function guardFetch(fetchImpl: typeof fetch, allow: () => Promise<void>): typeof fetch {
  return (input, init) => {
    const url = requestUrl(input);
    if (!needsAllowlist(url)) return fetchImpl(input, init);
    return allow().then(() => fetchImpl(input, init));
  };
}
