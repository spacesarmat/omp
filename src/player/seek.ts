export function seekStep(base: number, repeat: number): number {
  return base * Math.min(1 + Math.floor(repeat / 4), 6);
}

/** Collects repeated ←/→ presses into one target and seeks once the user stops pressing. */
export class SeekAccumulator {
  private target: number | null = null;
  private repeat = 0;
  private lastAt = -Infinity;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly apply: (t: number) => void;
  private readonly delayMs: number;
  private readonly now: () => number;

  constructor(apply: (t: number) => void, delayMs = 700, now: () => number = () => Date.now()) {
    this.apply = apply;
    this.delayMs = delayMs;
    this.now = now;
  }

  press(dir: 1 | -1, current: number, duration: number, base: number): number {
    const t = this.now();
    this.repeat = t - this.lastAt < 900 ? this.repeat + 1 : 0;
    this.lastAt = t;
    const from = this.target === null ? current : this.target;
    const max = duration > 0 ? Math.max(0, duration - 1) : Infinity;
    this.target = Math.max(0, Math.min(max, from + dir * seekStep(base, this.repeat)));
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.commit(), this.delayMs);
    return this.target;
  }

  pending(): number | null {
    return this.target;
  }

  commit(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.target !== null) {
      const v = this.target;
      this.target = null;
      this.apply(v);
    }
  }

  cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.target = null;
  }
}
