import { useEffect } from 'preact/hooks';
import { routeStack, currentRoute, goBack, Route } from './ui/nav';
import { installKeyListener } from './ui/keys';
import { DialogHost, confirmDialog, dialogOpen } from './ui/dialog';
import { ToastHost } from './ui/toast';
import { ConnectScreen } from './screens/Connect';
import { LibraryScreen } from './screens/Library';
import { TorrentScreen } from './screens/Torrent';
import { PlayerScreen } from './screens/Player';
import { AddScreen } from './screens/Add';
import { PlaylistScreen } from './screens/Playlist';
import { SettingsScreen } from './screens/Settings';
import { UpdateScreen } from './screens/Update';
import { PairPhoneScreen } from './screens/PairPhone';
import { UpdateDialog, shouldShowUpdateDialog } from './ui/UpdateDialog';
import { checkForUpdate } from './store/updates';

function renderRoute(r: Route) {
  switch (r.name) {
    case 'connect':
      return <ConnectScreen />;
    case 'library':
      return <LibraryScreen />;
    case 'torrent':
      return <TorrentScreen hash={r.hash} />;
    case 'player':
      return <PlayerScreen queue={r.queue} index={r.index} startAt={r.startAt} />;
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
    default:
      return null;
  }
}

function exitApp() {
  confirmDialog('Выйти из приложения?', 'Выйти').then((ok) => {
    if (ok) window.close();
  });
}

export function App() {
  useEffect(() => installKeyListener(() => { if (!goBack()) exitApp(); }), []);
  useEffect(() => {
    const t = setTimeout(() => { checkForUpdate({ manual: false }); }, 3000);
    return () => clearTimeout(t);
  }, []);
  const r = currentRoute.value;
  return (
    <div class="app">
      <div class="screen-host" key={routeStack.value.length + ':' + r.name}>{renderRoute(r)}</div>
      {shouldShowUpdateDialog(r.name) && !dialogOpen.value && <UpdateDialog />}
      <DialogHost />
      <ToastHost />
    </div>
  );
}
