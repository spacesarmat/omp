import { TorrServerClient, normalizeServerUrl } from '../../../src/api/torrserver';
import { errorMessage, isApiError } from '../../../src/api/http';
import { connectCandidates } from '../../../src/api/serverAddress';
import { isProbeFailure, probeServer } from '../../../src/api/connectProbe';
import { connectErrorText } from '../../../src/api/connectError';
import { addServer, servers, setActiveServer, type SavedServer } from '../../../src/store/servers';
import { allowTypedHost } from '../cleartextHosts';

export interface ConnectInput {
  name?: string;
  /** As typed (without a scheme both http and https are tried) or a full URL. */
  url: string;
  user?: string;
  password?: string;
}

export type ConnectResult =
  | { ok: true; server: SavedServer; version: string }
  | { ok: false; error: string; network: boolean };

/**
 * The same check the connect screen uses: echo, then save and select the server.
 * Callers decide where to go next.
 */
export async function connectServer(cfg: ConnectInput): Promise<ConnectResult> {
  const typed = connectCandidates(cfg.url);
  const candidates = typed.length ? typed : [normalizeServerUrl(cfg.url)];
  // saved credentials of the same server, when none were typed (either scheme of it)
  const creds = (url: string) => {
    if (cfg.user !== undefined) return { user: cfg.user, password: cfg.password };
    const known = servers.value.find((x) => x.url === url);
    return { user: known?.user, password: known?.password };
  };
  try {
    const r = await probeServer(candidates, (url) => {
      allowTypedHost(url);
      return new TorrServerClient({ url, ...creds(url) }).echo();
    });
    const server = addServer({ ...cfg, url: r.url });
    setActiveServer(server.id);
    return { ok: true, server, version: (r.version || '').trim() };
  } catch (f) {
    const e = isProbeFailure(f) ? f.error : f;
    const https = isProbeFailure(f) && /^https:/i.test(f.url);
    return {
      ok: false,
      // https keeps the address in the text: which scheme failed, and a refused certificate is named
      error: isProbeFailure(f) && (f.tls || https) ? connectErrorText(f.url, f.error, f.tls) : errorMessage(e),
      network: !(isProbeFailure(f) && f.tls) && isApiError(e) && (e.kind === 'network' || e.kind === 'timeout'),
    };
  }
}
