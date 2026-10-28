// Whether an https server's certificate was refused. A page's fetch() cannot tell a refused certificate from no
// answer, so a platform that can (Android: OmpNative.http reports code 'tls') registers a probe at startup. Without
// one (webOS, a browser) the answer is always «unknown» and the connect error says what a certificate needs.

/** true: the handshake failed on the certificate; false: anything else (an answer, no answer, unknown). */
export type TlsProbe = (url: string) => Promise<boolean>;

let probe: TlsProbe | null = null;

export function setTlsProbe(p: TlsProbe | null): void {
  probe = p;
}

/** Whether this platform can tell a refused certificate (an Android APK with the native probe). */
export function canDetectTls(): boolean {
  return !!probe;
}

/** Asks the registered probe about the server of an https URL; false for http, without a probe, or when it fails. */
export function certificateRefused(url: string): Promise<boolean> {
  if (!probe || !/^https:\/\//i.test(url)) return Promise.resolve(false);
  try {
    return probe(url).then((v) => v === true, () => false);
  } catch (e) {
    return Promise.resolve(false);
  }
}

/** Native request used by the probe: OmpNative.http's shape, enough for a GET. */
export type NativeGet = (req: { url: string; method: 'GET'; timeoutMs?: number }) => Promise<unknown>;

/** The probe over OmpNative.http: GET <base>/echo; a rejection with code 'tls' is a refused certificate. */
export function nativeTlsProbe(get: NativeGet): TlsProbe {
  return (url) =>
    // without user:password@ (the probe only needs the handshake; a 401 is an answer)
    get({ url: url.replace(/^(https:\/\/)[^@/?#]*@/i, '$1').replace(/\/+$/, '') + '/echo', method: 'GET', timeoutMs: 8000 }).then(
      () => false,
      (e) => !!e && (e as { code?: unknown }).code === 'tls',
    );
}
