import { useEffect } from 'preact/hooks';
import { App as CapApp } from '@capacitor/app';
import { currentRoute, goBack, switchTab, type MRoute } from './nav';
import { native } from './platform/native';
import { NavBar, type Tab } from './ui/NavBar';
import { Toast } from './ui/toast';
import { Connect } from './screens/Connect';
import { Tv } from './screens/Tv';
import { Library } from './screens/Library';
import { Torrent } from './screens/Torrent';
import { Add } from './screens/Add';
import { Remote } from './screens/Remote';
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

  // magnet links shared into the app (cold start and while running)
  useEffect(() => {
    let off: (() => void) | undefined;
    try {
      native
        .takePendingMagnet()
        .then((l) => {
          if (l) switchTab({ name: 'add', link: l });
        })
        .catch(() => {});
      off = native.onMagnet((l) => switchTab({ name: 'add', link: l }));
    } catch {
      /* native layer unavailable */
    }
    return () => off?.();
  }, []);

  const route = currentRoute.value;
  const showNav = TABS.includes(route.name);
  return (
    <>
      {route.name === 'connect' ? (
        <Connect />
      ) : route.name === 'tv' ? (
        <Tv />
      ) : route.name === 'library' ? (
        <Library />
      ) : route.name === 'torrent' ? (
        <Torrent hash={route.hash} />
      ) : route.name === 'add' ? (
        <Add link={route.link} />
      ) : route.name === 'remote' ? (
        <Remote />
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
