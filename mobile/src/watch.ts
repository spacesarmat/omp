// «Watch» actions shared by the library and torrent screens: TV launch params, stream URLs,
// and replaceable side effects (TV launch, external player, clipboard).
import { h, type VNode } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Clipboard } from '@capacitor/clipboard';
import { launchOnTv, ompVersionOnTv, tvNoOmp } from './tv/tvClient';
import { reportUrl, markLaunched } from './tv/playerLink';
import { activeTv } from './tv/tvStore';
import { showToast } from './ui/toast';
import { ResumeSheet } from './ui/ResumeSheet';
import { OldTvDialog } from './ui/OldTvDialog';
import { client } from '../../src/store/servers';
import { errorMessage } from '../../src/api/http';
import { compareVersions } from '../../src/lib/version';
import { CONTROL_MIN_VERSION } from '../../src/phone/protocol';
import { native, type ExternalPlayerResult, type OpenPlayerOptions } from './platform/native';
import { currentRoute, navigate, type MRoute } from './nav';
import { parseTorrentData, type TorrServerClient } from '../../src/api/torrserver';
import { recordWatch } from '../../src/store/journal';
import { markWatched, MIN_RESUME } from '../../src/store/progress';
import { saveItemProgress } from '../../src/player/progressSave';
import type { Torrent } from '../../src/api/types';
import { baseName, type TorrentFile } from '../../src/lib/episodes';
import { t as tr } from '../../src/i18n';
import { launchLabel } from './lib/playingNames';

export interface WatchOnTvParams {
  server: string;
  torrent: string;
  file?: number;
  t?: number;
  report?: string;
  /** Phone name: the TV writes its watch journal entries as this phone's. */
  from?: string;
}

/** `t` is kept (0 included) whenever a file is set; values below 1 become 0; `from` only with a file. */
export function watchOnTvParams(serverUrl: string, hash: string, file?: number, t?: number, report?: string, from?: string): WatchOnTvParams {
  const p: WatchOnTvParams = { server: serverUrl, torrent: hash };
  if (file !== undefined) p.file = file;
  if (file !== undefined && t !== undefined) p.t = t >= 1 ? Math.floor(t) : 0;
  if (report) p.report = report;
  if (file !== undefined && from) p.from = from;
  return p;
}

/** Stream URL with credentials embedded: an external player cannot send headers. */
export function streamUrlFor(c: TorrServerClient, t: Pick<Torrent, 'hash'>, file: TorrentFile, withAuth = true): string {
  const url = c.streamUrl(t.hash, file.id, baseName(file.path));
  return withAuth ? c.videoSrc(url) : url;
}

export const noWifi = () => tr('localServer.noWifi');

/** Replaces a loopback host with the phone's LAN address; null when the host is local and there is no address. */
export function lanServerUrl(url: string, ip: string | null): string | null {
  const m = /^([a-z][a-z0-9+.-]*:\/\/(?:[^@\/]*@)?)(127\.0\.0\.1|localhost)(?=[:\/?#]|$)/i.exec(url);
  if (!m) return url;
  return ip ? ip_replace(url, m[1].length, m[2].length, ip) : null;
}

const ip_replace = (url: string, at: number, len: number, ip: string) => url.slice(0, at) + ip + url.slice(at + len);

/** Server URL as the TV (or a copied link) must see it; throws noWifi() when only the phone can reach it. */
export async function tvServerUrl(url: string): Promise<string> {
  if (lanServerUrl(url, '0.0.0.0') === url) return url;
  const r = lanServerUrl(url, await actions.localIpv4().catch(() => null));
  if (r === null) throw new Error(noWifi());
  return r;
}

export interface WatchActions {
  launchOnTv: (params: object) => Promise<void>;
  openExternal: (url: string, mime: string) => Promise<void>;
  /** MX-compatible player for result; null: the app has no such method (fall back to openExternal). */
  openPlayer: (o: OpenPlayerOptions) => Promise<ExternalPlayerResult | null>;
  copyText: (text: string) => Promise<void>;
  /** OMP version installed on the TV; null when unknown. */
  ompVersion: () => Promise<string | null>;
  /** URL the TV posts player state to; null when unavailable. */
  reportUrl: () => Promise<string | null>;
  /** Phone Wi-Fi address; null when not on Wi-Fi. */
  localIpv4: () => Promise<string | null>;
  /** Pause between «launched» and the jump to the player screen (or the remote). */
  remoteDelayMs: number;
  /** Phone model for the watch journal («Телефон» when unknown). */
  phoneName: () => Promise<string>;
  /** Watch journal write on TorrServer (never rejects). */
  recordWatch: (c: TorrServerClient, hash: string, entry: { f: number; t: number; d: number; src: 'phone'; name: string }) => Promise<void>;
}

const defaults: WatchActions = {
  launchOnTv: (p) => launchOnTv(p),
  openExternal: (url, mime) => native.openExternal(url, mime),
  openPlayer: (o) => native.openPlayer(o),
  copyText: (text) => Clipboard.write({ string: text }),
  ompVersion: () => ompVersionOnTv(),
  reportUrl: () => reportUrl(),
  localIpv4: () => native.localIpv4(),
  remoteDelayMs: 1000,
  phoneName: () => native.phoneName(),
  recordWatch: (c, hash, entry) => recordWatch(c, hash, entry),
};

export let actions: WatchActions = defaults;

/** Replaces side effects (tests); null restores the real ones. */
export function setWatchActions(a: Partial<WatchActions> | null): void {
  actions = a ? { ...defaults, ...a } : defaults;
}

const phoneFallback = () => tr('history.phone');

function phoneNameSafe(): Promise<string> {
  return actions.phoneName().then(
    (n) => (typeof n === 'string' && n.trim() ? n.trim() : phoneFallback()),
    () => phoneFallback(),
  );
}

/** Watch journal: this phone started `file` at `t` (TV launch or external player). Never rejects. */
export function recordPhoneWatch(c: TorrServerClient | null, hash: string, file: number, t: number, duration: number, name?: string): Promise<void> {
  if (!c) return Promise.resolve();
  return (name ? Promise.resolve(name) : phoneNameSafe())
    .then((n) =>
      actions.recordWatch(c, hash, {
        f: file,
        t: t >= 1 ? Math.floor(t) : 0,
        d: duration > 0 ? Math.floor(duration) : 0,
        src: 'phone',
        name: n,
      }),
    )
    .catch(() => undefined);
}

export interface PhoneWatch {
  hash: string;
  file: TorrentFile;
  /** Clean episode name for the player's title. */
  title: string;
  /** Saved position, seconds (0: from the start). */
  at: number;
  /** Known duration, seconds (0: unknown). */
  duration: number;
}

/**
 * "Watch on the phone": the stream in another player, from the saved position; the position the player hands
 * back is saved like the TV's (local + TorrServer, watch journal), the end marks the file watched.
 * Older apps without openPlayer: the plain chooser as before. Rejects when no player could be opened.
 */
export async function watchOnPhone(c: TorrServerClient, t: Pick<Torrent, 'hash'>, w: PhoneWatch): Promise<void> {
  // a second tap while the chooser / player is open does nothing: the native side keeps only one pending call
  if (phoneWatchBusy) return;
  phoneWatchBusy = true;
  try {
    await watchOnPhoneOnce(c, t, w);
  } finally {
    phoneWatchBusy = false;
  }
}

let phoneWatchBusy = false;

async function watchOnPhoneOnce(c: TorrServerClient, t: Pick<Torrent, 'hash'>, w: PhoneWatch): Promise<void> {
  const url = streamUrlFor(c, t, w.file);
  const at = w.at >= MIN_RESUME ? Math.floor(w.at) : 0;
  const r = await actions.openPlayer({ url, title: w.title, positionMs: at * 1000, mime: 'video/*' });
  if (r === null) {
    await actions.openExternal(url, 'video/*');
    void recordPhoneWatch(c, w.hash, w.file.id, 0, w.duration);
    return;
  }
  if (!r.returned) {
    // the player tells nothing back (VLC and the like): the journal knows where it was started
    void recordPhoneWatch(c, w.hash, w.file.id, at, w.duration);
    return;
  }
  const dur = r.durationMs !== undefined && r.durationMs > 0 ? r.durationMs / 1000 : w.duration;
  const item = { url, title: w.title, hash: w.hash, fileIndex: w.file.id };
  if (r.ended) {
    if (dur > 0) saveItemProgress(c, item, dur, dur, true);
    else markWatched(w.hash, w.file.id);
    void recordPhoneWatch(c, w.hash, w.file.id, dur, dur);
    return;
  }
  const pos = r.positionMs !== undefined ? r.positionMs / 1000 : 0;
  if (pos >= MIN_RESUME) {
    if (dur > 0) saveItemProgress(c, item, pos, dur, true);
    // no duration anywhere: only the server's resume point can be kept
    else c.setViewed(w.hash, w.file.id, Math.floor(pos)).catch(() => undefined);
  }
  void recordPhoneWatch(c, w.hash, w.file.id, pos >= MIN_RESUME ? pos : at, dur);
}

export function filesOf(t: Torrent): TorrentFile[] {
  return t.file_stats && t.file_stats.length ? t.file_stats : parseTorrentData(t.data);
}

const sameRoute = (a: MRoute, b: MRoute) =>
  a.name === b.name && (a.name !== 'torrent' || (b.name === 'torrent' && a.hash === b.hash));

/**
 * Jumps to `to` (the player screen by default) after a short pause, unless the user has left `from` meanwhile.
 * Returns a cancel function (call it on unmount); `onDone` fires when the timer ends or is cancelled.
 */
export function openRemoteSoon(
  from: MRoute | MRoute['name'],
  onDone?: () => void,
  to: 'nowPlaying' | 'remote' = 'nowPlaying',
): () => void {
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    onDone?.();
  };
  const timer = setTimeout(() => {
    const here = currentRoute.value;
    if (typeof from === 'string' ? here.name === from : sameRoute(here, from)) navigate({ name: to });
    finish();
  }, actions.remoteDelayMs);
  return finish;
}

export const OMP_INSTALL_URL = 'https://github.com/spacesarmat/omp#readme';

/** True when a TV launch failed because OMP is not installed on the TV. */
export function isNoOmp(message: string): boolean {
  return message === tvNoOmp();
}

/** Opens the TV install guide in the external browser. */
export function openInstallGuide(): void {
  window.open(OMP_INSTALL_URL, '_system');
}

export type TvLaunchStep = { kind: 'resume'; at: number; duration?: number } | { kind: 'oldTv'; version: string };

type Answer = 'go' | 'resume' | 'restart' | null;
type ActiveStep = TvLaunchStep & { label: string; tv: string; answer: (v: Answer) => void };

export interface TvLaunchOpts {
  hash: string;
  file?: number;
  /** Saved position, seconds. */
  at?: number;
  duration?: number;
  /** «S02E03 · Title» for the resume sheet. */
  label: string;
  /** True while the launch is in flight and until the post-launch jump has happened. */
  onBusy?: (busy: boolean) => void;
  onError?: (message: string) => void;
  /** Replaces the default «Запустил на …» toast. */
  onLaunched?: (tvName: string) => void;
}

/** Shared entry for every «на ТВ» button: version check → resume choice → launch with report. */
export function useTvLaunch(): { start: (opts: TvLaunchOpts) => Promise<void>; sheet: VNode<any> | null } {
  const [step, setStep] = useState<ActiveStep | null>(null);
  const [alive] = useState({ v: true });
  const busy = useRef(false);
  const cancelJump = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      alive.v = false;
      cancelJump.current?.();
    },
    [],
  );

  // the sheet names the episode cleanly («S02E01», then «S02E01 · Спокойная жизнь» once TMDB tells), never a file name
  const ask = (s: TvLaunchStep, o: TvLaunchOpts, tv: string) =>
    new Promise<Answer>((resolve) => {
      let open = true;
      const answer = (v: Answer) => {
        open = false;
        if (alive.v) setStep(null);
        resolve(v);
      };
      const label = launchLabel(o.hash, o.file, o.label, (named) => {
        if (open && alive.v) setStep((cur) => (cur && cur.answer === answer ? { ...cur, label: named } : cur));
      });
      setStep({
        ...s,
        label,
        tv,
        answer,
      });
    });

  const start = async (o: TvLaunchOpts): Promise<void> => {
    const c = client.value;
    const tv = activeTv.value;
    if (!c) return;
    if (!tv) {
      navigate({ name: 'tv' });
      return;
    }
    if (busy.current) return;
    busy.current = true;
    o.onBusy?.(true);
    o.onError?.('');
    const release = () => {
      busy.current = false;
      if (alive.v) o.onBusy?.(false);
    };
    let jumping = false;
    // no file or an old TV: nothing will report to the phone, land on the remote as in v0.7
    let landing: 'nowPlaying' | 'remote' = o.file === undefined ? 'remote' : 'nowPlaying';
    try {
      const version = await actions.ompVersion();
      if (version && compareVersions(version, CONTROL_MIN_VERSION) < 0) {
        if ((await ask({ kind: 'oldTv', version }, o, tv.name)) !== 'go') return;
        landing = 'remote';
      }
      let t: number | undefined;
      if (o.file !== undefined) {
        t = 0;
        if (o.at !== undefined && o.at >= 1) {
          const choice = await ask({ kind: 'resume', at: o.at, duration: o.duration }, o, tv.name);
          if (choice === null) return;
          if (choice === 'resume') t = o.at;
        }
      }
      // first: without Wi-Fi (noWifi()) there is nothing to launch, so the player-state server is not started
      const serverUrl = await tvServerUrl(c.baseUrl);
      const report = await actions.reportUrl();
      const from = o.file !== undefined ? await phoneNameSafe() : undefined;
      await actions.launchOnTv(watchOnTvParams(serverUrl, o.hash, o.file, t, report || undefined, from));
      if (report && landing === 'nowPlaying') markLaunched();
      if (o.file !== undefined) void recordPhoneWatch(c, o.hash, o.file, t || 0, o.duration || 0, from);
      if (!alive.v) return;
      if (o.onLaunched) o.onLaunched(tv.name);
      else showToast(tr('add.launchedOn', { name: tv.name }));
      jumping = true;
      cancelJump.current = openRemoteSoon(currentRoute.value, release, landing);
    } catch (e) {
      if (alive.v) o.onError?.(errorMessage(e));
    } finally {
      if (!jumping) release();
    }
  };

  let sheet: VNode<any> | null = null;
  if (step) {
    if (step.kind === 'oldTv') {
      sheet = h(OldTvDialog, {
        tvName: step.tv,
        version: step.version,
        onContinue: () => step.answer('go'),
        onGuide: openInstallGuide,
        onClose: () => step.answer(null),
      });
    } else {
      sheet = h(ResumeSheet, {
        info: tr('add.resumeInfo', { label: step.label, tv: step.tv }),
        at: step.at,
        duration: step.duration,
        onResume: () => step.answer('resume'),
        onRestart: () => step.answer('restart'),
        onCancel: () => step.answer(null),
      });
    }
  }
  return { start, sheet };
}
