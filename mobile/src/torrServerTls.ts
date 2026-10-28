// The phone's part of src/api/torrServerTls.ts: the plugin calls and the in-app confirm for a certificate.
import { certQuestionText, installTorrServerTls, type Inspection, type NativeTls } from '../../src/api/torrServerTls';
import { native, rawPlugin } from './platform/native';
import { askConfirm } from './ui/confirm';

interface TlsPlugin {
  torrServerHttp(o: object): Promise<{ status?: number; base64?: string }>;
  torrServerInspect(o: { url: string }): Promise<Inspection>;
  torrServerTrust(o: { hostPort: string; fingerprint: string }): Promise<unknown>;
  torrServerForget(o: { hostPort: string }): Promise<unknown>;
}

/** The plugin's https path for TorrServer; null in a browser build. */
export function phoneTls(): NativeTls | null {
  const p = native.available ? (rawPlugin() as TlsPlugin | null) : null;
  if (!p) return null;
  return {
    http: (o) => p.torrServerHttp(o),
    inspect: (url) => p.torrServerInspect({ url }),
    trust: (hostPort, fingerprint) => p.torrServerTrust({ hostPort, fingerprint }),
    forget: (hostPort) => p.torrServerForget({ hostPort }),
  };
}

/** A self-signed TorrServer is trusted only after this question (the fingerprint is shown). */
export function installPhoneTls(): void {
  const tls = phoneTls();
  if (!tls) return;
  installTorrServerTls(tls, (q) => {
    const x = certQuestionText(q);
    return askConfirm(x.title + '\n\n' + x.body, x.ok, { destructive: true, multiline: true });
  });
}
