import { useEffect, useRef, useState } from 'preact/hooks';

export interface NextEpisodeOptions {
  itemKey: unknown;
  enabled: boolean;
  hasNext: boolean;
  time: number;
  duration: number;
  ended: number;
  paused: boolean;
  /** Start of the credits when known: the countdown begins there instead of 30 s before the end. */
  creditsStart?: number | null;
  onNext: () => void;
  onEnd: () => void;
}

/** Whether the «next episode» countdown is due: from the credits when known, else in the last 30 s. */
export function countdownDue(o: { time: number; duration: number; creditsAt?: number }): boolean {
  const remaining = o.duration - o.time;
  if (!(o.duration > 60) || !(remaining > 0)) return false;
  if (o.creditsAt !== undefined && o.creditsAt > 0 && o.creditsAt < o.duration && o.time >= o.creditsAt) return true;
  return remaining <= 30;
}

/** Shows a 10 s countdown from the start of the credits (or in the last 30 s when they are unknown), then switches to the next one. */
export function useNextEpisode(o: NextEpisodeOptions): { countdown: number | null; dismiss: () => void } {
  const [dismissed, setDismissed] = useState(false);
  const [left, setLeft] = useState<number | null>(null);
  const onNext = useRef(o.onNext);
  const onEnd = useRef(o.onEnd);
  onNext.current = o.onNext;
  onEnd.current = o.onEnd;

  useEffect(() => {
    setDismissed(false);
    setLeft(null);
  }, [o.itemKey]);

  const show = o.enabled && o.hasNext && !dismissed && !o.paused && countdownDue({ time: o.time, duration: o.duration, creditsAt: o.creditsStart || undefined });

  useEffect(() => {
    if (!show) {
      setLeft(null);
      return;
    }
    let n = 10;
    setLeft(n);
    const t = setInterval(() => {
      n--;
      if (n <= 0) {
        clearInterval(t);
        onNext.current();
      } else {
        setLeft(n);
      }
    }, 1000);
    return () => clearInterval(t);
  }, [show]);

  useEffect(() => {
    if (!o.ended) return;
    if (o.enabled && o.hasNext) onNext.current();
    else onEnd.current();
  }, [o.ended]);

  return { countdown: show ? left : null, dismiss: () => setDismissed(true) };
}
