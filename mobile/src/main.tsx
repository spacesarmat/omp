import { render } from 'preact';
import { App } from './app';
import './catalog/phoneCatalog'; // registers the catalog provider the shared series code uses
import { resetTo } from './nav';
import { activeServer } from '../../src/store/servers';
import { installErrorHooks, logStart } from '../../src/lib/log';
import { registerBuiltinSources } from '../../src/sources/builtin';

import { ensureFirstRun } from './donate';
import { t } from '../../src/i18n';
import { startKeyboardWatch } from './ui/keyboard';

installErrorHooks();
startKeyboardWatch();
ensureFirstRun(); // starts the 30-day clock of the «Поддержать» card
logStart(t('history.phone'));

// the phone app runs on Android: the built-in tracker parsers work through its native http
registerBuiltinSources();

resetTo({ name: activeServer.value ? 'library' : 'connect' });
render(<App />, document.getElementById('app')!);
