import { useEffect } from 'preact/hooks';
import { effect } from '@preact/signals';
import { App as CapApp } from '@capacitor/app';
import { currentRoute, goBack, switchTab, setPendingLink, type MRoute } from './nav';
import { activeServer, client } from '../../src/store/servers';
import { refreshTorrents } from '../../src/store/library';
import { native } from './platform/native';
import { NavBar, TAB_IDS, type Tab } from './ui/NavBar';
import { Toast, showToast } from './ui/toast';
import { catalogMode, setCatalogMode } from './catalog/phoneCatalog';
import { Connect } from './screens/Connect';
import { Tv } from './screens/Tv';
import { Faq } from './screens/Faq';
import { Log } from './screens/Log';
import { Backup } from './screens/Backup';
import { InstallAssistant } from './screens/InstallAssistant';
import { Sources } from './screens/Sources';
import { FlareSolverr } from './screens/FlareSolverr';
import { SourceSite } from './screens/SourceSite';
import { installPhoneCloudflare } from './cloudflare';
import { Library } from './screens/Library';
import { Torrent } from './screens/Torrent';
import { Add } from './screens/Add';
import { LocalServer } from './screens/LocalServer';
import { autostartLocal, watchLocalServer } from './server/localServer';
import { Remote } from './screens/Remote';
import { NowPlaying } from './screens/NowPlaying';
import { MiniPlayer } from './ui/MiniPlayer';
import { Settings, runUpdateCheck, phoneFeedUrl } from './screens/Settings';
import { ServerSettings } from './screens/ServerSettings';
import { UpdateSheet } from './ui/UpdateSheet';
import { runBack } from './ui/backStack';
import { WhatsNewSheet } from './ui/WhatsNewSheet';
import { DonateSheet } from './ui/DonateSheet';
import { syncSupport, localSupportUntil } from './donate';
import { torrents } from '../../src/store/library';
import { checkWhatsNew } from '../../src/store/whatsNew';
import { phoneChangelog } from './lib/phoneChangelog';
import { APP_VERSION } from '../../src/version';
import { updatePrompt, installUpdateChecks } from '../../src/store/updates';
import { tvState, warmUp, cancelWarmUp } from './tv/tvClient';
import { activeTv } from './tv/tvStore';
import { startPlayerLink, attachIfOmpForeground, linkStatus } from './tv/playerLink';
import { installTabSwipe } from './ui/tabSwipe';
import { News } from './screens/News';
import { SubFindings } from './screens/SubFindings';
import { Monitor } from './screens/Monitor';
import { TitleCard } from './screens/catalog/TitleCard';
import { Series } from './screens/Series';
import { monitorNative } from './monitor/native';
import { reloadLog } from '../../src/lib/log';
import { Fragment } from 'preact';
import { lang, t, type Lang } from '../../src/i18n';
import { applySchedule, monitorFinished, notifyBlocked, openNewsLink, reloadMonitor, startupNotify } from './monitor/ui';
import './mobile.css';

const TABS: string[] = TAB_IDS;

/** «Каталог»: a second Back within this long after the first one sends the app to the background. */
export const BACK_AGAIN_MS = 2000;
let firstBackAt = -Infinity;

/** Tests: forget the first press. */
export function resetBackPress(): void {
  firstBackAt = -Infinity;
}

/**
 * Android Back: an open sheet closes, a nested screen goes back; the root of another tab switches to «Каталог»
 * (like its tab), «Обзор» to «Мои»; on «Мои» the first press asks for a second one, which (within 2 s) sends the
 * app to the background instead of closing it.
 */
export function handleBack(): void {
  if (runBack()) return;
  if (goBack()) return;
  const name = currentRoute.peek().name;
  if (name !== 'library' && TABS.indexOf(name) >= 0) {
    firstBackAt = -Infinity;
    switchTab({ name: 'library' });
    return;
  }
  if (name === 'library' && catalogMode.peek() !== 'mine') {
    firstBackAt = -Infinity;
    setCatalogMode('mine');
    return;
  }
  const now = Date.now();
  if (now - firstBackAt > BACK_AGAIN_MS) {
    firstBackAt = now;
    showToast(t('nav.backAgain'), BACK_AGAIN_MS);
    return;
  }
  firstBackAt = -Infinity;
  try {
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

/** Sends the resolved UI language to the native side now and on every change; returns the stopper. */
export function syncNativeLanguage(set: (l: Lang) => Promise<void> = (l) => native.setLanguage(l)): () => void {
  return effect(() => {
    void set(lang.value);
  });
}

export function App() {
  // the native copy (notifications, install assistant…) follows the page's language
  useEffect(() => syncNativeLanguage(), []);

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
        // the background page may have written new findings meanwhile
        if (st.isActive) reloadMonitor();
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

  // monitoring: (re)schedule the background check with the saved settings (idempotent), follow finished background
  // runs (reload the stores and the library) and open the findings of tapped notifications
  useEffect(() => {
    void applySchedule();
    // the notification permission: once when monitoring is on, and for a run that could not notify while OMP was closed
    if (activeServer.value) void startupNotify().catch(() => {});
    const offDone = monitorNative.onDone((summary) => {
      reloadLog(); // the background page wrote its summary to the log
      monitorFinished(summary);
      const c = client.value;
      if (c) void refreshTorrents(c).catch(() => {});
      if (summary && summary.notifyBlocked) void notifyBlocked().catch(() => {});
    });
    const offOpen = monitorNative.onOpen(openNewsLink);
    void monitorNative.takeOpen().then((url) => {
      if (url) openNewsLink(url);
    });
    return () => {
      offDone();
      offOpen();
    };
  }, []);

  // support code: the TVs learn it from the server's journal; a server (or a new one) without the mark gets it
  useEffect(
    () =>
      effect(() => {
        const list = torrents.value;
        const c = client.value;
        if (localSupportUntil.value) void syncSupport(c, list);
      }),
    [],
  );

  // embedded TorrServer: status, silent autostart (errors only go to the store), sync with the service
  useEffect(() => {
    void autostartLocal().catch(() => {});
    return watchLocalServer();
  }, []);

  // the visible Cloudflare check: searches on the phone and «Пройти на телефоне» from the paired Android TV
  useEffect(() => installPhoneCloudflare(), []);

  // «Что нового» once after an update
  useEffect(() => {
    checkWhatsNew(phoneChangelog(), APP_VERSION);
  }, []);

  // background update check 3 s after start and on each return to OMP (at most hourly); honours the setting
  useEffect(
    () => installUpdateChecks((gap) => void runUpdateCheck({ manual: false, url: phoneFeedUrl(), minIntervalMs: gap }).catch(() => {})),
    [],
  );

  const route = currentRoute.value;
  const prompt = updatePrompt.value;
  const tabRoot = TABS.includes(route.name);
  // a «Обзор» title card keeps the bottom tabs with «Каталог» highlighted
  const showNav = tabRoot || route.name === 'title' || route.name === 'series';
  // swipe left / right between the bottom tabs
  useEffect(() => {
    if (!tabRoot) return;
    return installTabSwipe({
      tabs: TABS,
      current: () => currentRoute.value.name,
      screen: () => document.querySelector<HTMLElement>('.m-screen'),
      go: (tab) => switchTab({ name: tab } as MRoute),
    });
  }, [tabRoot]);
  const showMini = (route.name === 'library' || route.name === 'remote') && linkStatus.value !== 'none';
  // a language change remounts the whole UI (t() does not subscribe components to the language)
  return (
    <Fragment key={lang.value}>
      {route.name === 'connect' ? (
        <Connect />
      ) : route.name === 'tv' ? (
        <Tv />
      ) : route.name === 'faq' ? (
        <Faq q={route.q} />
      ) : route.name === 'install' ? (
        <InstallAssistant key={route.ip ? 'steps:' + route.ip : 'find'} ip={route.ip} kind={route.kind} brand={route.brand} />
      ) : route.name === 'log' ? (
        <Log />
      ) : route.name === 'backup' ? (
        <Backup />
      ) : route.name === 'sources' ? (
        <Sources />
      ) : route.name === 'sourceSite' ? (
        <SourceSite id={route.id} />
      ) : route.name === 'flaresolverr' ? (
        <FlareSolverr />
      ) : route.name === 'library' ? (
        <Library />
      ) : route.name === 'news' ? (
        <News seg={route.seg} finding={route.finding} watch={route.watch} />
      ) : route.name === 'subFindings' ? (
        <SubFindings id={route.id} finding={route.finding} watch={route.watch} />
      ) : route.name === 'monitor' ? (
        <Monitor />
      ) : route.name === 'torrent' ? (
        <Torrent hash={route.hash} />
      ) : route.name === 'add' ? (
        <Add link={route.link} query={route.query} run={route.run} entry={route} />
      ) : route.name === 'nowPlaying' ? (
        <NowPlaying />
      ) : route.name === 'localServer' ? (
        <LocalServer />
      ) : route.name === 'serverSettings' ? (
        <ServerSettings url={route.url} />
      ) : route.name === 'remote' ? (
        <Remote />
      ) : route.name === 'series' ? (
        <Series key={route.key} seriesKey={route.key} />
      ) : route.name === 'title' ? (
        <TitleCard key={route.kind + ':' + route.id} kind={route.kind} id={route.id} />
      ) : (
        <Settings />
      )}
      {prompt && tabRoot && <UpdateSheet info={prompt} />}
      {/* after an update: waits for the update sheet and for the connect/pairing flows (no nav bar there) */}
      {tabRoot && !prompt && <WhatsNewSheet />}
      {tabRoot && <DonateSheet />}
      <Toast />
      {showMini && route.name !== 'remote' && <div class="m-mini-pad" />}
      {showMini && <MiniPlayer />}
      {showNav && <NavBar active={route.name === 'title' || route.name === 'series' ? 'library' : (route.name as Tab)} />}
    </Fragment>
  );
}
