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
import { t } from './i18n';
import { setCatalogProvider } from './catalog/activeCatalog';
import { tvCatalog } from './catalog/tvCatalog';

// Preact schedules renders with queueMicrotask (Chrome 71+); the LG build polyfills it, an old Android TV WebView does not
const w = window as unknown as { queueMicrotask?: (cb: () => void) => void };
if (typeof w.queueMicrotask !== 'function') {
  w.queueMicrotask = (cb) => {
    Promise.resolve().then(cb).catch((e) => setTimeout(() => { throw e; }));
  };
}

init({ debug: false, visualDebug: false });

installErrorHooks();
setCatalogProvider(() => tvCatalog());
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
      () => log('warn', 'tv', t('log.sourcesLoadFailed')),
    )
    .then(undefined, () => log('warn', 'app', t('log.sourcesConnectFailed')))
    // the visible Cloudflare check (native dialog, «Пройти на телефоне»)
    .then(() => import('./sources/cloudflareTv').then((m) => m.installTvCloudflare()))
    .then(undefined, () => log('warn', 'app', t('log.cloudflareConnectFailed')))
    .then(start, start);
} else {
  start();
}
