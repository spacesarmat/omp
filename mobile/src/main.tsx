import { render } from 'preact';
import { effect } from '@preact/signals';
import { App } from './app';
import './catalog/phoneCatalog'; // registers the catalog provider the shared series code uses
import { resetTo } from './nav';
import { activeServer, servers } from '../../src/store/servers';
import { installErrorHooks, logStart } from '../../src/lib/log';
import { registerBuiltinSources } from '../../src/sources/builtin';
import { reloadSourcePrefs } from '../../src/sources/store';

import { ensureFirstRun } from './donate';
import { t } from '../../src/i18n';
import { startKeyboardWatch } from './ui/keyboard';
import { initPhoneRpc } from './tv/phoneRpc';
import { attachIfOmpForeground } from './tv/playerLink';
import { tvState, tvKind, sessionIp } from './tv/tvClient';
import { native } from './platform/native';
import { flareSolverrUrl, onFlareChange } from '../../src/sources/flareStore';
import { indexerConnections, onIndexersChange } from '../../src/sources/indexerStore';
import { tvs } from './tv/tvStore';
import { cleartextHosts, guardFetch } from './cleartextHosts';

function cleartextHostList(): string[] {
  const urls: string[] = [];
  for (const s of servers.value) urls.push(s.url);
  const flare = flareSolverrUrl();
  if (flare) urls.push(flare);
  for (const c of indexerConnections()) urls.push(c.url);
  for (const tv of tvs.value) urls.push(tv.ip);
  return cleartextHosts(urls);
}

function syncCleartextHosts(): void {
  void native.setCleartextHosts(cleartextHostList()).catch(() => {});
}

effect(() => {
  void servers.value;
  void tvs.value;
  syncCleartextHosts();
});
onIndexersChange(syncCleartextHosts);
onFlareChange(syncCleartextHosts);
syncCleartextHosts();
window.fetch = guardFetch(window.fetch.bind(window), () => native.setCleartextHosts(cleartextHostList()));

installErrorHooks();
startKeyboardWatch();
ensureFirstRun(); // starts the 30-day clock of the «Поддержать» card
logStart(t('history.phone'));

// the phone app runs on Android: the built-in tracker parsers work through its native http
registerBuiltinSources();
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
render(<App />, document.getElementById('app')!);
