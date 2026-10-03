import { useEffect } from 'preact/hooks';
import { currentRoute, goBack, routeKey, Route } from './ui/nav';
import { installKeyListener } from './ui/keys';
import { installWheelScroll } from './ui/wheel';
import { DialogHost, confirmDialog, dialogOpen } from './ui/dialog';
import { ToastHost } from './ui/toast';
import { ConnectScreen } from './screens/Connect';
import { LibraryScreen } from './screens/Library';
import { TorrentScreen } from './screens/Torrent';
import { PlayerScreen } from './screens/Player';
import { NativePlayerScreen } from './screens/NativePlayer';
import { AddScreen } from './screens/Add';
import { PlaylistScreen } from './screens/Playlist';
import { SettingsScreen } from './screens/Settings';
import { UpdateScreen } from './screens/Update';
import { PairPhoneScreen } from './screens/PairPhone';
import { SourcesScreen } from './screens/Sources';
import { UpdateDialog, shouldShowUpdateDialog } from './ui/UpdateDialog';
import { WhatsNewDialog, shouldShowWhatsNew } from './ui/WhatsNewDialog';
import { checkWhatsNew, whatsNew } from './store/whatsNew';
import { CHANGELOG } from './lib/changelogData';
import { APP_VERSION } from './version';
import { checkForUpdate, updatePrompt } from './store/updates';
import { platformKind } from './platform/env';
import { installAndroidKeyBridge } from './platform/androidKeys';
import { installAndroidRemote } from './platform/androidRemote';
import { installAndroidScale } from './platform/androidScale';

function renderRoute(r: Route) {
  switch (r.name) {
    case 'connect':
      return <ConnectScreen />;
    case 'library':
      return <LibraryScreen />;
    case 'torrent':
      return <TorrentScreen hash={r.hash} />;
    case 'player':
      return platformKind() === 'androidtv'
        ? <NativePlayerScreen queue={r.queue} index={r.index} startAt={r.startAt} from={r.from} />
        : <PlayerScreen queue={r.queue} index={r.index} startAt={r.startAt} from={r.from} />;
    case 'add':
      return <AddScreen />;
    case 'playlist':
      return <PlaylistScreen url={r.url} title={r.title} />;
    case 'settings':
      return <SettingsScreen />;
    case 'pairPhone':
      return <PairPhoneScreen />;
    case 'update':
      return <UpdateScreen />;
    case 'sources':
      // built-in sites need the native http of the APK: Android TV only
      return platformKind() === 'androidtv' ? <SourcesScreen /> : null;
    default:
      return null;
  }
}

function exitApp() {
  confirmDialog('Выйти из приложения?', 'Выйти').then((ok) => {
    if (ok) window.close();
  });
}

/** Back that no screen took: pop the route; at the root webOS asks to exit, Android TV lets the Activity close. */
export function unhandledBack(): boolean {
  if (goBack()) return true;
  if (platformKind() === 'androidtv') return false;
  exitApp();
  return true;
}

export function App() {
  useEffect(() => installKeyListener(unhandledBack), []);
  useEffect(() => installWheelScroll(), []);
  useEffect(() => (platformKind() === 'androidtv' ? installAndroidKeyBridge() : undefined), []);
  useEffect(() => (platformKind() === 'androidtv' ? installAndroidRemote() : undefined), []);
  useEffect(() => (platformKind() === 'androidtv' ? installAndroidScale() : undefined), []);
  useEffect(() => {
    const t = setTimeout(() => { checkForUpdate({ manual: false }); }, 3000);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => { checkWhatsNew(CHANGELOG, APP_VERSION); }, []);
  const r = currentRoute.value;
  // opened by the user (Update screen) shows anywhere; the automatic one waits for the update prompt, the player and pairing
  const wn = whatsNew.value;
  const showWhatsNew = !!wn && !dialogOpen.value && (!wn.auto || (shouldShowWhatsNew(r.name) && !updatePrompt.value));
  return (
    <div class="app">
      <div class="screen-host" key={routeKey(r)}>{renderRoute(r)}</div>
      {shouldShowUpdateDialog(r.name) && !dialogOpen.value && <UpdateDialog />}
      {showWhatsNew && <WhatsNewDialog />}
      <DialogHost />
      <ToastHost />
    </div>
  );
}
