import { render } from 'preact';
import { App } from './app';
import './catalog/phoneCatalog'; // registers the catalog provider the shared series code uses
import { resetTo, type MRoute } from './nav';
import { activeServer, activeServerId, servers, setActiveServer } from '../../src/store/servers';
import { installErrorHooks, logStart } from '../../src/lib/log';
import { registerBuiltinSources } from '../../src/sources/builtin';
import { startPremiumRecheck } from '../../src/billing/recheck';
import { startBillingKeepAlive } from '../../src/billing/tokens';
import { ensureLinkedBilling } from '../../src/sources/ompJackett';
import { setDhtPeersContext } from '../../src/sources/dhtPeers';
import { setProbeContext } from '../../src/sources/liveSeedsRun';
import { phoneSourceContext } from './searchContext';
import { TorrServerClient } from '../../src/api/torrserver';
import { scanLan } from './screens/Connect';
import { bindWifiRuntime, considerWifi, ensureWifiPrimary, loadWifiPrefs, saveWifiPrefs } from './servers/wifiRun';
import { reloadSourcePrefs } from '../../src/sources/store';

import { ensureFirstRun } from './donate';
import { t } from '../../src/i18n';
import { startKeyboardWatch } from './ui/keyboard';
import { initPhoneRpc } from './tv/phoneRpc';
import { attachIfOmpForeground, nowPlaying, pushPhoneSub } from './tv/playerLink';
import { tvState, tvKind, sessionIp } from './tv/tvClient';
import { native } from './platform/native';
import { tvs } from './tv/tvStore';
import { installCleartextSync } from '../../src/cleartextSync';
import { nativeTlsProbe, setTlsProbe } from '../../src/api/tlsProbe';
import { installPhoneTls } from './torrServerTls';

installCleartextSync(
  (hosts) => native.setCleartextHosts(hosts),
  () => tvs.value.map((tv) => tv.ip),
);

// a failed https connect asks the native http whether the certificate was the reason (a page's fetch cannot tell)
if (native.available) setTlsProbe(nativeTlsProbe((req) => native.http(req)));

// a TorrServer over https goes through the native trust; a self-signed certificate asks first
installPhoneTls();

installErrorHooks();
startKeyboardWatch();
ensureFirstRun(); // starts the 30-day clock of the «Поддержать» card
logStart(t('history.phone'));

// the phone app runs on Android: the built-in tracker parsers work through its native http
registerBuiltinSources();
// OMP subscription: only this page rotates the device tokens (it can write the Keystore); keeps the access token fresh
// the refresh token lives in the Keystore only on Android; the browser build keeps it in localStorage
startBillingKeepAlive(phoneSourceContext, { keystore: native.available });
// «Проверить сиды» asks billing for a DHT count with the same device token. webOS has no native HTTP and skips it.
setDhtPeersContext(phoneSourceContext);
// A feed row without a magnet (NNM-Club) loads the announce list from its topic page. No invented tracker URL.
setProbeContext(() => phoneSourceContext());
bindWifiRuntime({
  hint: () => native.wifiHint(),
  prefs: loadWifiPrefs,
  save: saveWifiPrefs,
  saved: () => servers.peek().map((s) => ({ id: s.id, url: s.url, name: s.name, user: s.user, password: s.password })),
  playback: () => {
    const n = nowPlaying.peek();
    return !!(n && n.hash);
  },
  echo: (s) => new TorrServerClient(s).echo().then(() => true, () => false),
  discover: (cancel) => scanLan(cancel).then((list) => list.map((s) => ({ url: s.url }))),
  apply: (id) => setActiveServer(id),
});
activeServerId.subscribe(ensureWifiPrimary);
void considerWifi();
// Ads and the monitoring cap: /v1/me on resume (if the last answer is older than 15 minutes) and about every 6 hours.
startPremiumRecheck(phoneSourceContext);
// A Telegram link with no session: ask billing once. A subscription turns paid sources on without a code.
void ensureLinkedBilling(phoneSourceContext());
// TV search: keeps the phone's TV search server in step with the switch (on by default once a TV is saved)
initPhoneRpc({
  connectedLg: () => (tvState.value === 'connected' && tvKind() !== 'atv' ? sessionIp.value : null),
  reattach: attachIfOmpForeground,
  pushSub: pushPhoneSub,
});

// the TV may switch a source on or off through the search server's page (mobile/rpc.html): re-read the switches when
// that page writes them and when the app comes back to the foreground
window.addEventListener('storage', (e) => {
  if (e.key === 'tsp.sources' || e.key === null) reloadSourcePrefs();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    reloadSourcePrefs();
    void considerWifi();
  }
});

resetTo({ name: activeServer.value ? 'library' : 'connect' });
// Dev server only: `?testlabels=1&screen=settings` opens that route so a beta preview can be screenshotted.
// This runs after the default route above. Production builds inline DEV as false.
if (import.meta.env.DEV && typeof location !== 'undefined') {
  const asked = /(?:^|[?&])screen=([a-zA-Z]+)(?:&|$)/.exec(location.search || '');
  if (asked) resetTo({ name: asked[1] } as MRoute);
}
render(<App />, document.getElementById('app')!);
