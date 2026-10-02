import { useEffect } from 'preact/hooks';
import { App as CapApp } from '@capacitor/app';
import { currentRoute, goBack, type MRoute } from './nav';
import { NavBar, type Tab } from './ui/NavBar';
import { Toast } from './ui/toast';
import { Connect } from './screens/Connect';
import { Tv } from './screens/Tv';
import './mobile.css';

const TITLES: Record<MRoute['name'], string> = {
  connect: 'Подключение',
  library: 'Каталог',
  torrent: 'Торрент',
  add: 'Добавить',
  remote: 'Пульт',
  tv: 'Телевизор',
  settings: 'Настройки',
};

const TABS: string[] = ['library', 'add', 'remote', 'settings'];

export function handleBack(): void {
  if (goBack()) return;
  try {
    void CapApp.exitApp();
  } catch {
    /* not running inside Capacitor */
  }
}

export function App() {
  useEffect(() => {
    let remove: (() => void) | undefined;
    let cancelled = false;
    try {
      CapApp.addListener('backButton', handleBack)
        .then((h) => {
          if (cancelled) void h.remove();
          else remove = () => void h.remove();
        })
        .catch(() => {});
    } catch {
      /* browser without Capacitor */
    }
    return () => {
      cancelled = true;
      if (remove) remove();
    };
  }, []);

  const route = currentRoute.value;
  const showNav = TABS.includes(route.name);
  return (
    <>
      {route.name === 'connect' ? (
        <Connect />
      ) : route.name === 'tv' ? (
        <Tv />
      ) : (
        <div class="m-screen" data-route={route.name}>
          <h1>{TITLES[route.name]}</h1>
        </div>
      )}
      <Toast />
      {showNav && <NavBar active={route.name as Tab} />}
    </>
  );
}
