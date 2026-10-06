import { render } from 'preact';
import { App } from './app';
import './catalog/phoneCatalog'; // registers the catalog provider the shared series code uses
import { resetTo } from './nav';
import { activeServer } from '../../src/store/servers';
import { installErrorHooks, logStart } from '../../src/lib/log';
import { registerBuiltinSources } from '../../src/sources/builtin';
import { reloadSourcePrefs } from '../../src/sources/store';

import { ensureFirstRun } from './donate';
import { t } from '../../src/i18n';
import { startKeyboardWatch } from './ui/keyboard';
import { initPhoneRpc } from './tv/phoneRpc';

installErrorHooks();
startKeyboardWatch();
ensureFirstRun(); // starts the 30-day clock of the «Поддержать» card
logStart(t('history.phone'));

// the phone app runs on Android: the built-in tracker parsers work through its native http
registerBuiltinSources();
// TV search: keeps the phone's TV search server in step with the switch (on by default once a TV is saved)
initPhoneRpc();

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
