// Entry of mobile/monitor.html (the hidden background page). Opened anywhere but Android's monitor WebView it does
// nothing.
import { registerBuiltinSources } from '../../../src/sources/builtin';
import { client } from '../../../src/store/servers';
import { rememberAdded } from '../../../src/store/library';
import { windowHost } from './host';
import { runMonitor } from './page';

const host = windowHost();
if (host) {
  registerBuiltinSources();
  void runMonitor({
    host,
    client: () => client.value,
    // the poster lookup of «Добавить» in the app
    afterAdd: (_c, t, title) => (client.value ? rememberAdded(client.value, t, title) : Promise.resolve('')),
  });
}
