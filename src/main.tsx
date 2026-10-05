import { render } from 'preact';
import { init } from '@noriginmedia/norigin-spatial-navigation';
import './styles.css';
import { App } from './app';
import { activeServer } from './store/servers';
import { resetTo } from './ui/nav';
import { readLaunchParams, onRelaunch } from './platform/launch';
import { runLaunchParams } from './launchActions';
import { platformKind } from './platform/env';
import { installErrorHooks, log, logStart } from './lib/log';

init({ debug: false, visualDebug: false });

installErrorHooks();
logStart(platformKind() === 'androidtv' ? 'Android TV' : 'LG webOS');

function start(): void {
  if (activeServer.value) resetTo({ name: 'library' });

  render(<App />, document.getElementById('app')!);

  runLaunchParams(readLaunchParams());
  onRelaunch(runLaunchParams);
}

// The built-in tracker parsers need the native http of the Android APK; LG search stays TorrServer-only, so the
// parsers are a separate chunk that the LG bundle never loads. A failed load must not keep the TV from starting.
if (platformKind() === 'androidtv') {
  import('./sources/builtin')
    .then(
      (m) => m.registerBuiltinSources(),
      () => log('warn', 'tv', 'Не удалось загрузить источники поиска'),
    )
    .then(undefined, () => log('warn', 'app', 'Не удалось подключить источники поиска'))
    // the visible Cloudflare check (native dialog, «Пройти на телефоне»)
    .then(() => import('./sources/cloudflareTv').then((m) => m.installTvCloudflare()))
    .then(undefined, () => log('warn', 'app', 'Не удалось подключить проверку Cloudflare'))
    .then(start, start);
} else {
  start();
}
