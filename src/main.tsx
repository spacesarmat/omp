import { render } from 'preact';
import { init } from '@noriginmedia/norigin-spatial-navigation';
import './styles.css';
import { App } from './app';
import { activeServer } from './store/servers';
import { resetTo } from './ui/nav';
import { readLaunchParams, onRelaunch } from './platform/launch';
import { runLaunchParams } from './launchActions';

init({ debug: false, visualDebug: false });

if (activeServer.value) resetTo({ name: 'library' });

render(<App />, document.getElementById('app')!);

runLaunchParams(readLaunchParams());
onRelaunch(runLaunchParams);
