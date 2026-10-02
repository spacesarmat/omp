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
import { Settings, runUpdateCheck } from './screens/Settings';
import { UpdateSheet, sheetBackHandler } from './ui/UpdateSheet';
import { updatePrompt } from '../../src/store/updates';
import { ANDROID_UPDATE_URL } from '../../src/lib/updateInfo';
import './mobile.css';

const TABS: string[] = ['library', 'add', 'remote', 'settings'];

export function handleBack(): void {
  if (sheetBackHandler.current?.()) return;
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

  // background update check 3 s after start (cheap GET; honours the setting and the 6 h interval)
  useEffect(() => {
    const t = setTimeout(() => {
      void runUpdateCheck({ manual: false, url: ANDROID_UPDATE_URL }).catch(() => {});
    }, 3000);
    return () => clearTimeout(t);
  }, []);

  const route = currentRoute.value;
  const prompt = updatePrompt.value;
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
        <Settings />
      )}
      {prompt && showNav && <UpdateSheet info={prompt} />}
      <Toast />
      {showNav && <NavBar active={route.name as Tab} />}
    </>
  );
}
