import { useEffect, useState } from 'preact/hooks';
import type { RefObject } from 'preact';

export interface VideoState {
  time: number;
  duration: number;
  paused: boolean;
  buffering: boolean;
  error: string | null;
  /** timestamp of the last 'ended' event, 0 if none */
  ended: number;
}

const INITIAL: VideoState = { time: 0, duration: 0, paused: true, buffering: true, error: null, ended: 0 };

export function mediaErrorText(e: MediaError | null): string {
  switch (e ? e.code : 0) {
    case 1: return 'Воспроизведение прервано';
    case 2: return 'Ошибка сети при загрузке видео';
    case 3: return 'Ошибка декодирования — формат не поддерживается телевизором';
    case 4: return 'Формат или кодек не поддерживается телевизором';
    default: return 'Неизвестная ошибка воспроизведения';
  }
}

export function useVideoState(ref: RefObject<HTMLVideoElement | null>, srcKey: string): VideoState {
  const [s, setS] = useState<VideoState>(INITIAL);
  useEffect(() => {
    setS(INITIAL);
    const v = ref.current;
    if (!v) return;
    const upd = (patch: Partial<VideoState>) => setS((prev) => ({ ...prev, ...patch }));
    const dur = () => (isFinite(v.duration) ? v.duration : 0);
    const handlers: { [k: string]: () => void } = {
      timeupdate: () => upd({ time: v.currentTime }),
      durationchange: () => upd({ duration: dur() }),
      loadedmetadata: () => upd({ duration: dur() }),
      play: () => upd({ paused: false }),
      pause: () => upd({ paused: true }),
      waiting: () => upd({ buffering: true }),
      seeking: () => upd({ buffering: true }),
      playing: () => upd({ buffering: false, paused: false }),
      canplay: () => upd({ buffering: false }),
      seeked: () => upd({ buffering: false }),
      error: () => upd({ error: mediaErrorText(v.error), buffering: false }),
      ended: () => upd({ ended: Date.now() }),
    };
    Object.keys(handlers).forEach((k) => v.addEventListener(k, handlers[k]));
    return () => Object.keys(handlers).forEach((k) => v.removeEventListener(k, handlers[k]));
  }, [srcKey]);
  return s;
}
