// Android: a TorrServer over https with a self-signed certificate. The page's fetch() cannot trust one, so every
// https TorrServer request goes through the native plugin (TorrServerTrust: the system CAs first, then the
// fingerprint the user accepted for exactly that host:port). A refused certificate asks the user once per
// host:port and fingerprint (first connect, or a changed certificate as a warning); accepted, the request is sent
// again. Nothing is trusted without that answer. LG has no such path: its error says a trusted certificate is needed.
import { t } from '../i18n';
import type { HttpTransport, TransportRequest } from './http';
import { effect } from '@preact/signals';
import { setTorrServerTransport } from './torrserver';
import { servers } from '../store/servers';

/** What the plugin says about a server's certificate. */
export interface Inspection {
  state: string;
  hostPort?: string;
  fingerprint?: string;
  subject?: string;
  issuer?: string;
  notAfter?: number;
}

/** The certificate the user is asked about. */
export interface CertQuestion {
  /** untrusted: first connect; changed: a pinned server shows another certificate. */
  kind: 'untrusted' | 'changed';
  hostPort: string;
  fingerprint: string;
  subject: string;
  notAfter: number;
}

/** The plugin calls this needs (OmpNative.torrServer*). */
export interface NativeTls {
  http(o: TransportRequest & { url: string }): Promise<{ status?: number; base64?: string }>;
  inspect(url: string): Promise<Inspection>;
  trust(hostPort: string, fingerprint: string): Promise<unknown>;
  /** Drops the accepted certificate of host:port. */
  forget?(hostPort: string): Promise<unknown>;
}

export type TrustUi = (q: CertQuestion) => Promise<boolean>;

let ui: TrustUi | null = null;
/** host:port → the fingerprint the user declined this session (asked again only for another one). */
const declined: { [hostPort: string]: string } = {};
const asking: { [key: string]: Promise<boolean> } = {};

const FP = /^[0-9a-f]{64}$/;

/** The dialog of the platform (TV or phone). */
export function setTrustUi(f: TrustUi | null): void {
  ui = f;
}

/** Forgets the session's declined answers (tests). */
export function resetTrustAnswers(): void {
  for (const k of Object.keys(declined)) delete declined[k];
  for (const k of Object.keys(asking)) delete asking[k];
}

function isCertCode(e: unknown): boolean {
  const code = e && typeof (e as { code?: unknown }).code === 'string' ? (e as { code: string }).code : '';
  return code === 'tls-untrusted' || code === 'tls-changed';
}

/** Asks about the certificate of [url]'s server; true when the user trusted it and the pin is stored. */
export function askTrust(native: NativeTls, url: string): Promise<boolean> {
  if (!ui) return Promise.resolve(false);
  const show = ui;
  return native.inspect(url).then((r) => {
    const fp = (r.fingerprint || '').toLowerCase();
    if ((r.state !== 'untrusted' && r.state !== 'changed') || !r.hostPort || !FP.test(fp)) return r.state === 'trusted';
    const hp = r.hostPort;
    if (declined[hp] === fp) return false;
    const key = hp + ' ' + fp;
    if (!asking[key]) {
      const q: CertQuestion = { kind: r.state, hostPort: hp, fingerprint: fp, subject: r.subject || '', notAfter: r.notAfter || 0 };
      asking[key] = show(q)
        .then((ok) => {
          if (!ok) {
            declined[hp] = fp;
            return false;
          }
          return native.trust(hp, fp).then(() => true, () => false);
        })
        .then(
          (v) => {
            delete asking[key];
            return v;
          },
          () => {
            delete asking[key];
            return false;
          },
        );
    }
    return asking[key];
  }, () => false);
}

/** The transport for TorrServerClient: native https, a refused certificate asks and the request is sent again. */
export function createTlsTransport(native: NativeTls): HttpTransport {
  const send = (url: string, req: TransportRequest) =>
    native.http({ url, ...req }).then((r) => ({ status: typeof r.status === 'number' ? r.status : 0, base64: r.base64 || '' }));
  return {
    send: (url, req) =>
      send(url, req).then(undefined, (e) => {
        if (!isCertCode(e)) throw e;
        return askTrust(native, url).then((ok) => {
          if (!ok) throw e;
          return send(url, req);
        });
      }),
  };
}

/** «host:port» of an https URL as the plugin keys its pins (the scheme's port when none is given); null otherwise. */
export function pinKey(url: string): string | null {
  const m = /^https:\/\/(?:[^@/?#]*@)?(\[[^\]]+\]|[^:/?#]+)(?::(\d+))?(?:[/?#]|$)/i.exec(url);
  if (!m) return null;
  return pinHost(m[1]) + ':' + (m[2] ? String(+m[2]) : '443');
}

/** The host as Android keys it (CertPins.normalize): lower case, no brackets or zone, ::ffff:a.b.c.d as a.b.c.d. */
function pinHost(host: string): string {
  let h = host.trim().toLowerCase();
  if (h.charAt(0) === '[' && h.charAt(h.length - 1) === ']') h = h.slice(1, -1);
  const zone = h.indexOf('%');
  if (zone >= 0) h = h.slice(0, zone);
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(h);
  return mapped ? mapped[1] : h;
}

/** The saved servers' https host:port keys. */
function savedKeys(): { [k: string]: true } {
  const out: { [k: string]: true } = {};
  for (const s of servers.value) {
    const k = pinKey(s.url);
    if (k) out[k] = true;
  }
  return out;
}

/**
 * A server removed (or its address changed) takes its accepted certificate with it: adding the address again asks
 * again. Returns the stop function.
 */
export function forgetRemovedServers(native: NativeTls): () => void {
  if (!native.forget) return () => {};
  const forget = native.forget;
  let before: { [k: string]: true } | null = null;
  return effect(() => {
    const now = savedKeys();
    if (before) {
      for (const k of Object.keys(before)) if (!now[k]) void forget(k).then(undefined, () => {});
    }
    before = now;
  });
}

/** Turns the path on (Android APKs whose plugin has the methods). */
export function installTorrServerTls(native: NativeTls, show: TrustUi): void {
  setTrustUi(show);
  setTorrServerTransport(createTlsTransport(native));
  forgetRemovedServers(native);
}

/** «AB:CD:…» in lines of eight bytes. */
export function formatFingerprint(fp: string): string {
  const pairs = (fp.toUpperCase().match(/.{2}/g) || []) as string[];
  const lines: string[] = [];
  for (let i = 0; i < pairs.length; i += 8) lines.push(pairs.slice(i, i + 8).join(':'));
  return lines.join('\n');
}

function date(ms: number): string {
  if (!ms) return '';
  const d = new Date(ms);
  const p = (n: number) => (n < 10 ? '0' : '') + n;
  return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear();
}

/** The «CN=…» of a subject, or the whole subject. */
function commonName(subject: string): string {
  const m = /(?:^|,)\s*CN=([^,]+)/.exec(subject);
  return m ? m[1].trim() : subject;
}

/** The dialog's title and body. */
export function certQuestionText(q: CertQuestion): { title: string; body: string; ok: string } {
  const lines: string[] = [t(q.kind === 'changed' ? 'tls.changedBody' : 'tls.untrustedBody')];
  if (q.subject) lines.push(t('tls.issuedTo', { name: commonName(q.subject) }));
  if (q.notAfter) lines.push(t('tls.validUntil', { date: date(q.notAfter) }));
  lines.push(t('tls.fingerprint'));
  lines.push(formatFingerprint(q.fingerprint));
  return {
    title: t(q.kind === 'changed' ? 'tls.changedTitle' : 'tls.untrustedTitle', { host: q.hostPort }),
    body: lines.join('\n'),
    ok: t(q.kind === 'changed' ? 'tls.trustNew' : 'tls.trust'),
  };
}
