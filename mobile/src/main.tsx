import { render } from 'preact';
import { App } from './app';
import './catalog/phoneCatalog'; // registers the catalog provider the shared series code uses
import { resetTo, type MRoute } from './nav';
import { activeServer } from '../../src/store/servers';
import { installErrorHooks, logStart } from '../../src/lib/log';
import { registerBuiltinSources } from '../../src/sources/builtin';
import { startBillingKeepAlive } from '../../src/billing/tokens';
import { phoneSourceContext } from './searchContext';
import { reloadSourcePrefs } from '../../src/sources/store';

import { ensureFirstRun } from './donate';
import { t } from '../../src/i18n';
import { startKeyboardWatch } from './ui/keyboard';
import { initPhoneRpc } from './tv/phoneRpc';
import { attachIfOmpForeground } from './tv/playerLink';
import { tvState, tvKind, sessionIp } from './tv/tvClient';
import { native } from './platform/native';
import { tvs } from './tv/tvStore';
import { installCleartextSync } from '../../src/cleartextSync';
import { nativeTlsProbe, setTlsProbe } from '../../src/api/tlsProbe';

installCleartextSync(
  (hosts) => native.setCleartextHosts(hosts),
  () => tvs.value.map((tv) => tv.ip),
);

// a failed https connect asks the native http whether the certificate was the reason (a page's fetch cannot tell)
if (native.available) setTlsProbe(nativeTlsProbe((req) => native.http(req)));

installErrorHooks();
startKeyboardWatch();
ensureFirstRun(); // starts the 30-day clock of the «Поддержать» card
logStart(t('history.phone'));

// the phone app runs on Android: the built-in tracker parsers work through its native http
registerBuiltinSources();
// OMP subscription: only this page rotates the device tokens (it can write the Keystore); keeps the access token fresh
// the refresh token lives in the Keystore only on Android; the browser build keeps it in localStorage
startBillingKeepAlive(phoneSourceContext, { keystore: native.available });
// TV search: keeps the phone's TV search server in step with the switch (on by default once a TV is saved)
initPhoneRpc({
  connectedLg: () => (tvState.value === 'connected' && tvKind() !== 'atv' ? sessionIp.value : null),
  reattach: attachIfOmpForeground,
});

// the TV may switch a source on or off through the search server's page (mobile/rpc.html): re-read the switches when
// that page writes them and when the app comes back to the foreground
window.addEventListener('storage', (e) => {
  if (e.key === 'tsp.sources' || e.key === null) reloadSourcePrefs();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') reloadSourcePrefs();
});

resetTo({ name: activeServer.value ? 'library' : 'connect' });
// Dev server only: `?testlabels=1&screen=settings` opens that route so a beta preview can be screenshotted.
// This runs after the default route above. Production builds inline DEV as false.
if (import.meta.env.DEV && typeof location !== 'undefined') {
  const asked = /(?:^|[?&])screen=([a-zA-Z]+)(?:&|$)/.exec(location.search || '');
  if (asked) resetTo({ name: asked[1] } as MRoute);
}
render(<App />, document.getElementById('app')!);
