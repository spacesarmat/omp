import { render } from 'preact';
import { init } from '@noriginmedia/norigin-spatial-navigation';
import './styles.css';
import { App } from './app';
import { activeServer } from './store/servers';
import { resetTo } from './ui/nav';
import { readLaunchParams, onRelaunch } from './platform/launch';
import { runLaunchParams } from './launchActions';
import { platformKind } from './platform/env';
import { registerBuiltinSources } from './sources/builtin';

init({ debug: false, visualDebug: false });

// the built-in tracker parsers need the native http of the Android APK; LG search stays TorrServer-only
if (platformKind() === 'androidtv') registerBuiltinSources();

if (activeServer.value) resetTo({ name: 'library' });

render(<App />, document.getElementById('app')!);

runLaunchParams(readLaunchParams());
onRelaunch(runLaunchParams);
