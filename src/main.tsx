import { render } from 'preact';
import { init } from '@noriginmedia/norigin-spatial-navigation';
import './styles.css';
import { App } from './app';
import { activeServer } from './store/servers';
import { resetTo } from './ui/nav';
import { readLaunchParams, onRelaunch } from './platform/launch';
import { runLaunchParams } from './launchActions';
import { platformKind } from './platform/env';
import { nativePlugin, nativeSetCleartextHosts, nativeTorrServerTls } from './platform/androidNative';
import { nativeTlsProbe, setTlsProbe } from './api/tlsProbe';
import { certQuestionText, installTorrServerTls } from './api/torrServerTls';
import { confirmWithBody } from './ui/dialog';
import { installCleartextSync } from './cleartextSync';
import { installErrorHooks, log, logStart } from './lib/log';
import { t } from './i18n';
import { setCatalogProvider } from './catalog/activeCatalog';
import { tvCatalog } from './catalog/tvCatalog';
import { ensureFirstRun } from './ads/firstRun';
import { installTvAds } from './ads/tvAds';

// Preact schedules renders with queueMicrotask (Chrome 71+); the LG build polyfills it, an old Android TV WebView does not
const w = window as unknown as { queueMicrotask?: (cb: () => void) => void };
if (typeof w.queueMicrotask !== 'function') {
  w.queueMicrotask = (cb) => {
    Promise.resolve().then(cb).catch((e) => setTimeout(() => { throw e; }));
  };
}

init({ debug: false, visualDebug: false });
ensureFirstRun();
installTvAds();

// The phone page registers saved HTTP hosts itself. This UI is what Android TV loads.
if (platformKind() === 'androidtv') installCleartextSync((hosts) => nativeSetCleartextHosts(hosts));

// a failed https connect asks the native http whether the certificate was the reason (a page's fetch cannot tell)
if (platformKind() === 'androidtv') {
  const p = nativePlugin();
  if (p) setTlsProbe(nativeTlsProbe((req) => p.http(req)));
}

// a TorrServer over https: the native trust; a self-signed certificate is trusted only after this question
if (platformKind() === 'androidtv') {
  const tls = nativeTorrServerTls();
  if (tls) {
    installTorrServerTls(tls, (q) => {
      const x = certQuestionText(q);
      return confirmWithBody(x.title, x.body, x.ok);
    });
  }
}

installErrorHooks();
setCatalogProvider((fresh) => tvCatalog(fresh));
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
