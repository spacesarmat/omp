// «Тачпад» for OMP on Android TV: the box has no pointer, so the pad speaks in keys. A swipe gives arrows (one per
// PAD_STEP px of travel on its main axis, more for a fast swipe), a two-finger swipe repeated Up / Down, a tap OK,
// a long press Menu. The keys go out one at a time over /omp/key; a fast swipe never floods the box (KeyPump).

export type PadKey = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';

/** Finger travel for one arrow. */
export const PAD_STEP = 40;
/** A press held this long without moving is «Меню». */
export const LONG_PRESS_MS = 550;
/** Movement under this is still a tap. */
export const TAP_SLOP = 8;

/** The travel of a fast swipe counts more: up to double above ~1.5 px/ms. */
export function padGain(pxPerMs: number): number {
  if (pxPerMs > 1.5) return 2;
  if (pxPerMs > 0.7) return 1.5;
  return 1;
}

/** Turns finger travel into arrows: the main axis only, the other one starts over after each arrow. */
export class PadArrows {
  private ax = 0;
  private ay = 0;

  constructor(private readonly step: number = PAD_STEP) {}

  reset(): void {
    this.ax = 0;
    this.ay = 0;
  }

  /** One finger moved by dx, dy (px) in dtMs; the arrows it gives, in order. */
  move(dx: number, dy: number, dtMs: number): PadKey[] {
    const g = padGain(Math.sqrt(dx * dx + dy * dy) / Math.max(1, dtMs));
    this.ax += dx * g;
    this.ay += dy * g;
    const out: PadKey[] = [];
    if (Math.abs(this.ax) >= Math.abs(this.ay)) {
      while (Math.abs(this.ax) >= this.step) {
        out.push(this.ax > 0 ? 'RIGHT' : 'LEFT');
        this.ax -= this.ax > 0 ? this.step : -this.step;
        this.ay = 0;
      }
    } else {
      while (Math.abs(this.ay) >= this.step) {
        out.push(this.ay > 0 ? 'DOWN' : 'UP');
        this.ay -= this.ay > 0 ? this.step : -this.step;
        this.ax = 0;
      }
    }
    return out;
  }

  /** Two fingers moved by dy: the list scrolls with the fingers (up → the next rows: Down). */
  scroll(dy: number, dtMs: number): PadKey[] {
    const g = padGain(Math.abs(dy) / Math.max(1, dtMs));
    this.ay += dy * g;
    const out: PadKey[] = [];
    while (Math.abs(this.ay) >= this.step) {
      out.push(this.ay < 0 ? 'DOWN' : 'UP');
      this.ay -= this.ay > 0 ? this.step : -this.step;
    }
    return out;
  }
}

/** What a finger that went down and up did: a tap is OK, a long press Menu (sent while held), a move nothing more. */
export function pressKey(moved: boolean, heldMs: number, longSent: boolean): 'ENTER' | null {
  if (moved || longSent || heldMs >= LONG_PRESS_MS) return null;
  return 'ENTER';
}

/**
 * Sends keys one after another; at most `max` wait, the oldest waiting ones are dropped when a fast swipe makes more
 * (the box shows the latest intent, not a backlog). A failed key ends the queue and reports once.
 */
export class KeyPump<K extends string = string> {
  private queue: K[] = [];
  private busy = false;

  constructor(
    private readonly send: (k: K) => Promise<void>,
    private readonly max: number = 4,
    private readonly onError: (e: unknown) => void = () => undefined,
  ) {}

  push(keys: K[]): void {
    if (!keys.length) return;
    this.queue = this.queue.concat(keys);
    // the first key leaves at once when idle; of the rest only the latest `max` wait
    this.next();
    if (this.queue.length > this.max) this.queue = this.queue.slice(this.queue.length - this.max);
  }

  /** Keys waiting (not counting the one on its way). */
  get waiting(): number {
    return this.queue.length;
  }

  private next(): void {
    if (this.busy) return;
    const k = this.queue.shift();
    if (k === undefined) return;
    this.busy = true;
    this.send(k).then(
      () => {
        this.busy = false;
        this.next();
      },
      (e) => {
        this.busy = false;
        this.queue = [];
        this.onError(e);
      },
    );
  }
}
