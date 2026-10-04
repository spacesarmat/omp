import { render } from 'preact';
import { App } from './app';
import { resetTo } from './nav';
import { activeServer } from '../../src/store/servers';
import { installErrorHooks, logStart } from '../../src/lib/log';
import { registerBuiltinSources } from '../../src/sources/builtin';

import { ensureFirstRun } from './donate';

installErrorHooks();
ensureFirstRun(); // starts the 30-day clock of the «Поддержать» card
logStart('Телефон');

// the phone app runs on Android: the built-in tracker parsers work through its native http
registerBuiltinSources();

resetTo({ name: activeServer.value ? 'library' : 'connect' });
render(<App />, document.getElementById('app')!);
