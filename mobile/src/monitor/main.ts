// Entry of mobile/monitor.html (the hidden background page). Opened anywhere but Android's monitor WebView it does
// nothing.
// the stored language (tsp.settings) is applied when the settings store loads, before any text is built
import '../../../src/store/settings';
import { registerBuiltinSources } from '../../../src/sources/builtin';
import { client } from '../../../src/store/servers';
import { rememberAdded } from '../../../src/store/library';
import { configuredCleartextUrls } from '../../../src/cleartextSync';
import { cleartextHosts } from '../cleartextHosts';
import { windowHost } from './host';
import { runMonitor } from './page';
import { createTlsTransport } from '../../../src/api/torrServerTls';
import { setTorrServerTransport } from '../../../src/api/torrserver';

const host = windowHost();
if (host) {
  registerBuiltinSources();
  // https TorrServer: only certificates already accepted in the app (no question in the background)
  const tsHttp = host.tsHttp;
  if (tsHttp) {
    setTorrServerTransport(createTlsTransport({
      http: (o) => tsHttp(o),
      inspect: () => Promise.resolve({ state: 'unreachable' }),
      trust: () => Promise.reject(new Error('background')),
    }));
  }
  void host.setCleartext(cleartextHosts(configuredCleartextUrls())).catch(() => {}).then(() => runMonitor({
    host,
    client: () => client.value,
    // the poster lookup of «Добавить» in the app
    afterAdd: (_c, t, title) => (client.value ? rememberAdded(client.value, t, title) : Promise.resolve('')),
  }));
}
