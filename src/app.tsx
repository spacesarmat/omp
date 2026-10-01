import { useEffect } from 'preact/hooks';
import { routeStack, currentRoute, goBack, Route } from './ui/nav';
import { installKeyListener } from './ui/keys';
import { DialogHost, confirmDialog } from './ui/dialog';
import { ToastHost } from './ui/toast';
import { ConnectScreen } from './screens/Connect';
import { LibraryScreen } from './screens/Library';
import { TorrentScreen } from './screens/Torrent';

function renderRoute(r: Route) {
  switch (r.name) {
    case 'connect':
      return <ConnectScreen />;
    case 'library':
      return <LibraryScreen />;
    case 'torrent':
      return <TorrentScreen hash={r.hash} />;
    // screens are registered here by later tasks
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
  const r = currentRoute.value;
  return (
    <div class="app">
      <div class="screen-host" key={routeStack.value.length + ':' + r.name}>{renderRoute(r)}</div>
      <DialogHost />
      <ToastHost />
    </div>
  );
}
