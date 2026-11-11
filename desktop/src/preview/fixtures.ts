import { lang, type Lang } from '../../../src/i18n';
import { setTorrServerTransport } from '../../../src/api/torrserver';
import { activeServerId, servers } from '../../../src/store/servers';
import { setServerScanner } from '../../../mobile/src/screens/Connect';

export interface PreviewFixtureOptions {
  serverConnected: boolean;
  language: Lang;
}

export function installPreviewFixture({ serverConnected, language }: PreviewFixtureOptions): () => void {
  const previousServers = servers.value;
  const previousActive = activeServerId.value;
  const previousLanguage = lang.value;
  const previousFetch = globalThis.fetch;
  const previousOpen = XMLHttpRequest.prototype.open;
  servers.value = serverConnected ? [{ id: 'fixture-server', name: 'Fixture TorrServer', url: 'http://fixture.invalid:8090' }] : [];
  activeServerId.value = serverConnected ? 'fixture-server' : null;
  lang.value = language;
  setServerScanner(async () => []);
  setTorrServerTransport({
    send: async () => ({ status: 503, base64: '' }),
  });
  globalThis.fetch = async (input, init) => {
    const value = typeof input === 'string' || input instanceof URL ? input : input.url;
    const url = new URL(value, window.location.href);
    if (url.origin === window.location.origin) return previousFetch(input, init);
    return new Response(JSON.stringify({ error: 'Preview network is disabled' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  XMLHttpRequest.prototype.open = function (method: string, url: string | URL, ...args: unknown[]): void {
    const destination = new URL(url, window.location.href);
    if (destination.origin !== window.location.origin) throw new Error('Preview network is disabled');
    Reflect.apply(previousOpen, this, [method, url, ...args]);
  };
  return () => {
    servers.value = previousServers;
    activeServerId.value = previousActive;
    lang.value = previousLanguage;
    globalThis.fetch = previousFetch;
    XMLHttpRequest.prototype.open = previousOpen;
    setServerScanner(null);
    setTorrServerTransport(null);
  };
}
