import { TorrServerClient, normalizeServerUrl } from '../../../src/api/torrserver';
import { errorMessage, isApiError } from '../../../src/api/http';
import { addServer, servers, setActiveServer, type SavedServer } from '../../../src/store/servers';
import { allowTypedHost } from '../cleartextHosts';

export interface ConnectInput {
  name?: string;
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
  try {
    const url = normalizeServerUrl(cfg.url);
    allowTypedHost(url);
    const known = servers.value.find((x) => x.url === url);
    const creds = cfg.user !== undefined ? cfg : { user: known?.user, password: known?.password };
    const version = await new TorrServerClient({ url, user: creds.user, password: creds.password }).echo();
    const server = addServer({ ...cfg, url });
    setActiveServer(server.id);
    return { ok: true, server, version: (version || '').trim() };
  } catch (e) {
    return {
      ok: false,
      error: errorMessage(e),
      network: isApiError(e) && (e.kind === 'network' || e.kind === 'timeout'),
    };
  }
}
