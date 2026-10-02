import { render } from 'preact';
import { App } from './app';
import { resetTo } from './nav';
import { activeServer } from '../../src/store/servers';

resetTo({ name: activeServer.value ? 'library' : 'connect' });
render(<App />, document.getElementById('app')!);
