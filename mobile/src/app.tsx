import { useEffect } from 'preact/hooks';
import { effect } from '@preact/signals';
import { App as CapApp } from '@capacitor/app';
import { currentRoute, goBack, switchTab, setPendingLink, type MRoute } from './nav';
import { activeServer } from '../../src/store/servers';
import { native } from './platform/native';
import { NavBar, type Tab } from './ui/NavBar';
import { Toast } from './ui/toast';
import { Connect } from './screens/Connect';
import { Tv } from './screens/Tv';
import { Faq } from './screens/Faq';
import { Sources } from './screens/Sources';
import { Library } from './screens/Library';
import { Torrent } from './screens/Torrent';
import { Add } from './screens/Add';
import { LocalServer } from './screens/LocalServer';
import { autostartLocal, watchLocalServer } from './server/localServer';
import { Remote } from './screens/Remote';
import { NowPlaying } from './screens/NowPlaying';
import { MiniPlayer } from './ui/MiniPlayer';
import { Settings, runUpdateCheck } from './screens/Settings';
import { ServerSettings } from './screens/ServerSettings';
import { UpdateSheet, sheetBackHandler } from './ui/UpdateSheet';
import { WhatsNewSheet } from './ui/WhatsNewSheet';
import { checkWhatsNew } from '../../src/store/whatsNew';
import { CHANGELOG } from '../../src/lib/changelogData';
import { APP_VERSION } from '../../src/version';
import { updatePrompt } from '../../src/store/updates';
import { ANDROID_UPDATE_URL } from '../../src/lib/updateInfo';
import { tvState, warmUp, cancelWarmUp } from './tv/tvClient';
import { activeTv } from './tv/tvStore';
import { startPlayerLink, attachIfOmpForeground, linkStatus } from './tv/playerLink';
import { installTabSwipe } from './ui/tabSwipe';
import './mobile.css';

const TABS: string[] = ['library', 'add', 'remote', 'settings'];

export function handleBack(): void {
  if (sheetBackHandler.current?.()) return;
  if (goBack()) return;
  try {
    // tab roots: send the app to the background instead of closing it
    void Promise.resolve(CapApp.minimizeApp()).catch(() => {});
  } catch {
    /* not running inside Capacitor */
  }
}

/** A shared magnet opens «Добавить»; with no server yet it waits for the connect. */
function intakeMagnet(l: string): void {
  if (activeServer.value) {
    switchTab({ name: 'add', link: l });
    return;
  }
  setPendingLink(l);
  if (currentRoute.value.name !== 'connect') switchTab({ name: 'connect' });
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

  // player link: listen to the TV; (re)attach on cold start, when the TV connects and when the app returns
  // to the foreground (attachIfOmpForeground skips a live link and a failed TV)
  useEffect(() => {
    startPlayerLink();
    // connect early (retrying while the TV wakes); the effect below attaches once connected
    if (activeTv.value) void warmUp();
    const stop = effect(() => {
      if (tvState.value === 'connected') void attachIfOmpForeground();
    });
    let remove: (() => void) | undefined;
    let cancelled = false;
    try {
      CapApp.addListener('appStateChange', (st) => {
        if (!st.isActive) {
          cancelWarmUp();
        } else if (tvState.value === 'connected') {
          void attachIfOmpForeground();
        } else if (activeTv.value) {
          void warmUp();
        }
      })
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
      stop();
      remove?.();
    };
  }, []);

  // magnet links shared into the app (cold start and while running)
  useEffect(() => {
    let off: (() => void) | undefined;
    try {
      native
        .takePendingMagnet()
        .then((l) => {
          if (l) intakeMagnet(l);
        })
        .catch(() => {});
      off = native.onMagnet(intakeMagnet);
    } catch {
      /* native layer unavailable */
    }
    return () => off?.();
  }, []);

  // embedded TorrServer: status, silent autostart (errors only go to the store), sync with the service
  useEffect(() => {
    void autostartLocal().catch(() => {});
    return watchLocalServer();
  }, []);

  // «Что нового» once after an update
  useEffect(() => {
    checkWhatsNew(CHANGELOG, APP_VERSION);
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
  // swipe left / right between the bottom tabs
  useEffect(() => {
    if (!showNav) return;
    return installTabSwipe({
      tabs: TABS,
      current: () => currentRoute.value.name,
      screen: () => document.querySelector<HTMLElement>('.m-screen'),
      go: (tab) => switchTab({ name: tab } as MRoute),
    });
  }, [showNav]);
  const showMini = (route.name === 'library' || route.name === 'remote') && linkStatus.value !== 'none';
  return (
    <>
      {route.name === 'connect' ? (
        <Connect />
      ) : route.name === 'tv' ? (
        <Tv />
      ) : route.name === 'faq' ? (
        <Faq />
      ) : route.name === 'sources' ? (
        <Sources />
      ) : route.name === 'library' ? (
        <Library />
      ) : route.name === 'torrent' ? (
        <Torrent hash={route.hash} />
      ) : route.name === 'add' ? (
        <Add link={route.link} />
      ) : route.name === 'nowPlaying' ? (
        <NowPlaying />
      ) : route.name === 'localServer' ? (
        <LocalServer />
      ) : route.name === 'serverSettings' ? (
        <ServerSettings url={route.url} />
      ) : route.name === 'remote' ? (
        <Remote />
      ) : (
        <Settings />
      )}
      {prompt && showNav && <UpdateSheet info={prompt} />}
      {/* after an update: waits for the update sheet and for the connect/pairing flows (no nav bar there) */}
      {showNav && !prompt && <WhatsNewSheet />}
      <Toast />
      {showMini && route.name !== 'remote' && <div class="m-mini-pad" />}
      {showMini && <MiniPlayer />}
      {showNav && <NavBar active={route.name as Tab} />}
    </>
  );
}
