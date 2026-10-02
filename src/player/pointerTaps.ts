export type TapZone = 'left' | 'center' | 'right';

export function tapZone(x: number, width: number): TapZone {
  if (!(width > 0)) return 'center';
  const r = x / width;
  if (r < 1 / 3) return 'left';
  if (r > 2 / 3) return 'right';
  return 'center';
}

export function edgeSeekStep(base: number, streak: number): number {
  if (streak <= 0) return base;
  if (streak === 1) return Math.min(base * 2, 30);
  return 30;
}

/** Separates single clicks (delayed) from double clicks on the video surface. */
export class TapDetector {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly h: { single(): void; double(zone: TapZone): void };
  private readonly delayMs: number;
  private readonly seekWindowMs: number;
  private readonly now: () => number;
  private lastSeekAt = -Infinity;

  constructor(
    h: { single(): void; double(zone: TapZone): void },
    delayMs = 300,
    seekWindowMs = 500,
    now: () => number = () => Date.now(),
  ) {
    this.h = h;
    this.delayMs = delayMs;
    this.seekWindowMs = seekWindowMs;
    this.now = now;
  }

  tap(zone: TapZone): void {
    const t = this.now();
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
      if (zone !== 'center') this.lastSeekAt = t;
      this.h.double(zone);
      return;
    }
    // seek mode: rapid edge taps right after a double tap keep seeking
    if (zone !== 'center' && t - this.lastSeekAt <= this.seekWindowMs) {
      this.lastSeekAt = t;
      this.h.double(zone);
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.h.single();
    }, this.delayMs);
  }

  cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.lastSeekAt = -Infinity;
  }
}

/** Double-click seek step: base, 2×base (≤30), then 30 s; resets after a pause or a direction change. */
export class SeekStreak {
  private count = 0;
  private lastAt = -Infinity;
  private dir = 0;
  private readonly now: () => number;
  private readonly resetMs: number;

  constructor(now: () => number = () => Date.now(), resetMs = 2000) {
    this.now = now;
    this.resetMs = resetMs;
  }

  next(dir: 1 | -1, base: number): number {
    const t = this.now();
    if (dir !== this.dir || t - this.lastAt > this.resetMs) this.count = 0;
    else this.count++;
    this.dir = dir;
    this.lastAt = t;
    return edgeSeekStep(base, this.count);
  }
}
