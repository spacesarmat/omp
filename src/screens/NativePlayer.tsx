import { useEffect, useState } from 'preact/hooks';
import { client } from '../store/servers';
import { settings } from '../store/settings';
import { nativePlugin } from '../platform/androidNative';
import { decideStart } from '../player/resume';
import { NativeSession, NativeState, nativeHeading } from '../player/nativePlayer';
import type { PlayItem } from '../player/types';
import { setPlayerBridge, postSoon } from '../phone/link';
import { goBack } from '../ui/nav';
import { toast } from '../ui/toast';

interface Props {
  queue: PlayItem[];
  index: number;
  startAt?: number;
}

function changed(a: NativeState | null, b: NativeState): boolean {
  return !a || a.index !== b.index || a.paused !== b.paused || a.buffering !== b.buffering
    || a.audio.sel !== b.audio.sel || a.subs.sel !== b.subs.sel
    || a.audio.list.length !== b.audio.list.length || a.subs.list.length !== b.subs.list.length;
}

function failText(e: unknown): string {
  const m = e && typeof e === 'object' && typeof (e as { message?: unknown }).message === 'string' ? (e as { message: string }).message : '';
  return /[А-Яа-яЁё]/.test(m) ? m : 'Не удалось открыть плеер';
}

/** Android TV: the player route opens the native Media3 player and stays as a placeholder behind it. */
export function NativePlayerScreen({ queue, index, startAt }: Props) {
  const [current, setCurrent] = useState(index);
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    const plugin = nativePlugin();
    if (!plugin || !queue[index]) {
      toast('Плеер недоступен', 'error');
      goBack();
      return undefined;
    }
    let cancelled = false;
    let session: NativeSession | null = null;
    let unbridge: (() => void) | null = null;
    decideStart(queue[index], startAt).then((pos) => {
      if (cancelled) return;
      if (pos < 0) {
        goBack();
        return;
      }
      const s = settings.value;
      const run = new NativeSession(plugin, client.value, queue, {
        onState: (st, prev) => {
          if (!prev || prev.index !== st.index) setCurrent(st.index);
          if (changed(prev, st)) postSoon();
        },
        onClosed: (_c, replaced) => {
          if (unbridge) unbridge();
          unbridge = null;
          if (!cancelled && !replaced) goBack();
        },
      });
      session = run;
      unbridge = setPlayerBridge({ snapshot: () => run.snapshot(), exec: (cmd) => run.exec(cmd) });
      run.start({
        index, startAt: pos, seekStep: s.seekStep, autoNext: s.autoNext,
        audioLang: s.audioLang, subLang: s.subLang, subtitlesOn: s.subtitlesOn,
      }).then(
        () => { if (!cancelled) setOpened(true); },
        (e) => {
          if (unbridge) unbridge();
          unbridge = null;
          if (cancelled) return;
          toast(failText(e), 'error');
          goBack();
        },
      );
    });
    return () => {
      cancelled = true;
      if (session) session.dispose();
      if (unbridge) unbridge();
    };
  }, []);

  const item = queue[current];
  return (
    <div class="player native-player">
      <div class="native-player-note">
        <div class="native-player-text">{opened ? 'Плеер открыт на телевизоре' : 'Открываем плеер…'}</div>
        {item && <div class="native-player-title">{nativeHeading(item)}</div>}
      </div>
    </div>
  );
}
