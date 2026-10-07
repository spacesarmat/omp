import { useEffect, useState } from 'preact/hooks';
import { effect } from '@preact/signals';
import { client } from '../store/servers';
import { settings } from '../store/settings';
import { nativePlugin } from '../platform/androidNative';
import { decideStart } from '../player/resume';
import { NativeSession, nativeHeading, nativePlayerOpen } from '../player/nativePlayer';
import type { ProbeLoader, SkipIo } from '../player/nativePlayer';
import type { TorrServerClient } from '../api/torrserver';
import type { PlayItem } from '../player/types';
import { WatchJournal, journalSource } from '../player/watchJournal';
import { recordWatch, loadSkip, saveSkip } from '../store/journal';
import { setPlayerBridge, postSoon } from '../phone/link';
import { goBack, currentRoute } from '../ui/nav';
import { toast } from '../ui/toast';
import { t, lang } from '../i18n';
import { donateCardEnabled } from '../player/DonateCard';
import { journalSupportActive } from '../store/support';
import { getTrackPref } from '../store/trackPrefs';
import { seriesTracksFor } from '../store/seriesTracks';
import { nativeTrackStart } from '../player/trackPrefs';
import { p2160Package, play2160 } from '../player/player2160';
import { getLocalProgress } from '../store/progress';
import { engineFor, knownProbe } from '../player/nativeEngine';

interface Props {
  queue: PlayItem[];
  index: number;
  startAt?: number;
  /** Name of the phone that launched the player (watch journal source). */
  from?: string;
}

function failText(e: unknown): string {
  const m = e && typeof e === 'object' && typeof (e as { message?: unknown }).message === 'string' ? (e as { message: string }).message : '';
  return lang.peek() === 'ru' && /[\u0400-\u04FF]/.test(m) ? m : t('nativePlayer.openFailed');
}

/** ffprobe for chapters and skips: only when the server has ffprobe (checked once), only for torrent files. */
function probeLoader(c: TorrServerClient | null): ProbeLoader | null {
  if (!c) return null;
  let available: Promise<boolean> | null = null;
  return (item) => {
    if (!item.hash || item.fileIndex === undefined) return Promise.resolve(null);
    const hash = item.hash;
    const index = item.fileIndex;
    // probed earlier in this app run (the file opened again)
    const known = knownProbe(hash, index);
    if (known) return Promise.resolve(known);
    if (!available) available = c.ffprobeAvailable();
    return available.then((ok) => (ok ? c.probe(hash, index) : null));
  };
}

/** Skip settings of a torrent (journal on TorrServer) for auto skip and the marks from the player menu. */
function skipIo(c: TorrServerClient | null): SkipIo | null {
  if (!c) return null;
  return { load: (hash) => loadSkip(c, hash), save: (hash, patch) => saveSkip(c, { hash }, patch) };
}

/** Android TV: the player route opens the native player and stays as a placeholder behind it. */
export function NativePlayerScreen({ queue, index, startAt, from }: Props) {
  const [current, setCurrent] = useState(index);
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    const plugin = nativePlugin();
    if (!plugin || !queue[index]) {
      toast(t('nativePlayer.unavailable'), 'error');
      goBack();
      return undefined;
    }
    let cancelled = false;
    // Preact runs unmount cleanups after paint: navigate back only while this player route is still on top
    const route = currentRoute.value;
    const leave = () => { if (!cancelled && currentRoute.value === route) goBack(); };
    let session: NativeSession | null = null;
    let unbridge: (() => void) | null = null;
    let unwatch: (() => void) | null = null;
    // a launch while the native player is open (phone) must not ask behind the player
    decideStart(queue[index], startAt, !nativePlayerOpen()).then((pos) => {
      if (cancelled) return;
      if (pos < 0) {
        leave();
        return;
      }
      const s = settings.value;
      const c = client.value;
      const journal = new WatchJournal((h, e) => { recordWatch(c, h, e); }, journalSource(from));
      const startBuiltin = () => {
      const run = new NativeSession(plugin, c, queue, {
        onState: (st, prev) => {
          if (!prev || prev.index !== st.index) setCurrent(st.index);
          // every state event (≈1 Hz, evaluateJavascript) posts: the page timers are throttled while
          // PlayerActivity covers the WebView, so the interval alone lets «Сейчас играет» go stale
          postSoon();
        },
        onClosed: (_c, replaced) => {
          if (unbridge) unbridge();
          unbridge = null;
          if (!replaced) leave();
        },
      }, journal, probeLoader(c), skipIo(c));
      session = run;
      unbridge = setPlayerBridge({ snapshot: () => run.snapshot(), exec: (cmd) => run.exec(cmd) });
      const donate = donateCardEnabled(journalSupportActive());
      // a support mark read later (the skip settings' list) hides the card in the open player
      if (donate) unwatch = effect(() => { if (journalSupportActive()) run.hideDonate(); });
      const firstHash = queue[index].hash;
      run.start({
        index, startAt: pos, seekStep: s.seekStep, autoNext: s.autoNext,
        // «Озвучка» of the series (else the torrent's own choice, else the settings): by title, then language
        ...nativeTrackStart(seriesTracksFor(firstHash), firstHash ? getTrackPref(firstHash) : null, s),
        donate,
        // «Плеер»: the torrent's choice from the player menu wins over the setting
        engine: engineFor(s.playerEngine, queue[index].hash ? getTrackPref(queue[index].hash!) : null),
      }).then(
        () => { if (!cancelled) setOpened(true); },
        (e) => {
          if (unbridge) unbridge();
          unbridge = null;
          if (cancelled) return;
          toast(failText(e), 'error');
          leave();
        },
      );
      };
      if (s.videoPlayer === 'p2160') {
        const first = queue[index];
        const dur = first.hash && first.fileIndex !== undefined ? (getLocalProgress(first.hash, first.fileIndex) || { duration: 0 }).duration : 0;
        // 2160 Player when installed (else the built-in one): the position it hands back is saved, then back
        p2160Package(plugin).then((pkg) => {
          if (!pkg) return false;
          const io = skipIo(c);
          const prefs = io && first.hash ? io.load(first.hash).catch(() => null) : Promise.resolve(null);
          // the watch journal («История») like the built-in player: the start, then where the user stopped
          journal.start(first, pos, dur);
          return prefs.then((p) => play2160(plugin, c, queue, index, pos, p, dur)).then(
            (saved) => {
              if (saved) {
                // another item of the playlist: its own entry
                if (saved.item !== first) journal.start(saved.item, 0, saved.duration);
                journal.end(saved.item, saved.time, saved.duration);
              } else journal.end(first, pos, dur);
              leave();
              return true;
            },
            (e) => { journal.end(first, pos, dur); if (!cancelled) { toast(failText(e), 'error'); leave(); } return true; },
          );
        }).then((handled) => { if (!handled && !cancelled) startBuiltin(); });
        return;
      }
      startBuiltin();
    });
    return () => {
      cancelled = true;
      if (session) session.detach();
      if (unbridge) unbridge();
      if (unwatch) unwatch();
    };
  }, []);

  const item = queue[current];
  return (
    <div class="player native-player">
      <div class="native-player-note">
        <div class="native-player-text">{opened ? t('nativePlayer.opened') : t('nativePlayer.opening')}</div>
        {item && <div class="native-player-title">{nativeHeading(item)}</div>}
      </div>
    </div>
  );
}
