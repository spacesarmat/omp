// Entry of mobile/rpc.html (the hidden page of the TV search server, android/.../rpc/RpcPageHost.kt). Opened anywhere
// but Android's RPC WebView it does nothing.
// the stored language (tsp.settings) is applied when the settings store loads, before any text is built
import '../../../src/store/settings';
import { t } from '../../../src/i18n';
import { checkSubscription } from '../../../src/monitor/check';
import { registerBuiltinSources } from '../../../src/sources/builtin';
import { createSecretStore, createSourceHttp } from '../../../src/sources/http';
import { reloadIndexers } from '../../../src/sources/indexerStore';
import { allSources } from '../../../src/sources/registry';
import type { SourceContext } from '../../../src/sources/types';
import { createRpcHandler } from './handler';
import { createRpcBridge, windowRpcPort } from './host';

const port = windowRpcPort();
if (port) {
  registerBuiltinSources();
  const bridge = createRpcBridge(port);
  const readOnly = () => Promise.reject(new Error(t('notify.readOnly')));
  // interactive (no `background`): the TV's search is a person's search, like the app's own
  const ctx: SourceContext = {
    http: createSourceHttp((req) => bridge.http(req)),
    client: null,
    secrets: createSecretStore({ get: (key) => bridge.secretGet(key), set: readOnly, delete: readOnly }),
  };
  const handler = createRpcHandler({
    // the app may have added or removed a Jackett / Prowlarr connection since this page started
    sources: () => {
      reloadIndexers();
      return allSources();
    },
    ctx: () => ctx,
    now: () => Date.now(),
    checkSubscription: (sub, from) => checkSubscription(ctx, sub, { from }),
  });
  bridge.serve(handler.dispatch);
}
