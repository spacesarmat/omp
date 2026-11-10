import { lang, type Lang } from '../../../src/i18n';
import { setTorrServerTransport } from '../../../src/api/torrserver';
import { activeServerId, servers } from '../../../src/store/servers';

export interface PreviewFixtureOptions {
  serverConnected: boolean;
  language: Lang;
}

export function installPreviewFixture({ serverConnected, language }: PreviewFixtureOptions): () => void {
  const previousServers = servers.value;
  const previousActive = activeServerId.value;
  const previousLanguage = lang.value;
  servers.value = serverConnected ? [{ id: 'fixture-server', name: 'Fixture TorrServer', url: 'http://fixture.invalid:8090' }] : [];
  activeServerId.value = serverConnected ? 'fixture-server' : null;
  lang.value = language;
  setTorrServerTransport({
    send: async () => ({ status: 503, base64: '' }),
  });
  return () => {
    servers.value = previousServers;
    activeServerId.value = previousActive;
    lang.value = previousLanguage;
    setTorrServerTransport(null);
  };
}
