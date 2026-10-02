import { render } from 'preact';
import { init } from '@noriginmedia/norigin-spatial-navigation';
import './styles.css';
import { App } from './app';
import { activeServer } from './store/servers';
import { resetTo } from './ui/nav';

init({ debug: false, visualDebug: false });

if (activeServer.value) resetTo({ name: 'library' });

render(<App />, document.getElementById('app')!);
