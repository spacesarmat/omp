// «Watch» actions shared by the library and torrent screens: TV launch params, stream URLs,
// and replaceable side effects (TV launch, external player, clipboard).
import { h, type VNode } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Clipboard } from '@capacitor/clipboard';
import { launchOnTv, ompVersionOnTv, TV_NO_OMP } from './tv/tvClient';
import { reportUrl } from './tv/playerLink';
import { activeTv } from './tv/tvStore';
import { showToast } from './ui/toast';
import { ResumeSheet } from './ui/ResumeSheet';
import { OldTvDialog } from './ui/OldTvDialog';
import { client } from '../../src/store/servers';
import { errorMessage } from '../../src/api/http';
import { compareVersions } from '../../src/lib/version';
import { CONTROL_MIN_VERSION } from '../../src/phone/protocol';
import { native } from './platform/native';
import { currentRoute, navigate, type MRoute } from './nav';
import { parseTorrentData, type TorrServerClient } from '../../src/api/torrserver';
import type { Torrent } from '../../src/api/types';
import { baseName, type TorrentFile } from '../../src/lib/episodes';

export interface WatchOnTvParams {
  server: string;
  torrent: string;
  file?: number;
  t?: number;
  report?: string;
}

/** `t` is kept (0 included) whenever a file is set; values below 1 become 0. */
export function watchOnTvParams(serverUrl: string, hash: string, file?: number, t?: number, report?: string): WatchOnTvParams {
  const p: WatchOnTvParams = { server: serverUrl, torrent: hash };
  if (file !== undefined) p.file = file;
  if (file !== undefined && t !== undefined) p.t = t >= 1 ? Math.floor(t) : 0;
  if (report) p.report = report;
  return p;
}

/** Stream URL with credentials embedded: an external player cannot send headers. */
export function streamUrlFor(c: TorrServerClient, t: Pick<Torrent, 'hash'>, file: TorrentFile, withAuth = true): string {
  const url = c.streamUrl(t.hash, file.id, baseName(file.path));
  return withAuth ? c.videoSrc(url) : url;
}

export interface WatchActions {
  launchOnTv: (params: object) => Promise<void>;
  openExternal: (url: string, mime: string) => Promise<void>;
  copyText: (text: string) => Promise<void>;
  /** OMP version installed on the TV; null when unknown. */
  ompVersion: () => Promise<string | null>;
  /** URL the TV posts player state to; null when unavailable. */
  reportUrl: () => Promise<string | null>;
  /** Pause between «launched» and the jump to the remote. */
  remoteDelayMs: number;
}

const defaults: WatchActions = {
  launchOnTv: (p) => launchOnTv(p),
  openExternal: (url, mime) => native.openExternal(url, mime),
  copyText: (text) => Clipboard.write({ string: text }),
  ompVersion: () => ompVersionOnTv(),
  reportUrl: () => reportUrl(),
  remoteDelayMs: 1000,
};

export let actions: WatchActions = defaults;

/** Replaces side effects (tests); null restores the real ones. */
export function setWatchActions(a: Partial<WatchActions> | null): void {
  actions = a ? { ...defaults, ...a } : defaults;
}

export function filesOf(t: Torrent): TorrentFile[] {
  return t.file_stats && t.file_stats.length ? t.file_stats : parseTorrentData(t.data);
}

const sameRoute = (a: MRoute, b: MRoute) =>
  a.name === b.name && (a.name !== 'torrent' || (b.name === 'torrent' && a.hash === b.hash));

/**
 * Jumps to the remote after a short pause, unless the user has left `from` meanwhile.
 * Returns a cancel function (call it on unmount); `onDone` fires when the timer ends or is cancelled.
 */
export function openRemoteSoon(from: MRoute | MRoute['name'], onDone?: () => void): () => void {
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    onDone?.();
  };
  const timer = setTimeout(() => {
    const here = currentRoute.value;
    if (typeof from === 'string' ? here.name === from : sameRoute(here, from)) navigate({ name: 'remote' });
    finish();
  }, actions.remoteDelayMs);
  return finish;
}

export const OMP_INSTALL_URL = 'https://github.com/spacesarmat/omp#readme';

/** True when a TV launch failed because OMP is not installed on the TV. */
export function isNoOmp(message: string): boolean {
  return message === TV_NO_OMP;
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
  /** True while the launch is in flight and until the jump to the remote has happened. */
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

  const ask = (s: TvLaunchStep, label: string, tv: string) =>
    new Promise<Answer>((resolve) => {
      setStep({
        ...s,
        label,
        tv,
        answer: (v) => {
          if (alive.v) setStep(null);
          resolve(v);
        },
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
    try {
      const version = await actions.ompVersion();
      if (version && compareVersions(version, CONTROL_MIN_VERSION) < 0) {
        if ((await ask({ kind: 'oldTv', version }, o.label, tv.name)) !== 'go') return;
      }
      let t: number | undefined;
      if (o.file !== undefined) {
        t = 0;
        if (o.at !== undefined && o.at >= 1) {
          const choice = await ask({ kind: 'resume', at: o.at, duration: o.duration }, o.label, tv.name);
          if (choice === null) return;
          if (choice === 'resume') t = o.at;
        }
      }
      const report = await actions.reportUrl();
      await actions.launchOnTv(watchOnTvParams(c.baseUrl, o.hash, o.file, t, report || undefined));
      if (!alive.v) return;
      if (o.onLaunched) o.onLaunched(tv.name);
      else showToast('Запустил на ' + tv.name + ' — пульт уже открыт');
      jumping = true;
      cancelJump.current = openRemoteSoon(currentRoute.value, release);
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
        info: step.label + ' · на ' + step.tv,
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
