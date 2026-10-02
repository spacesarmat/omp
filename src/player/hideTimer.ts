export interface HideGate { paused: boolean; buffering: boolean; seeking: boolean; error: boolean; dialogOpen: boolean }

/** The panel may auto-hide only while really playing, with no seek preview, error or dialog. */
export function canHideControls(g: HideGate): boolean {
  return !g.paused && !g.buffering && !g.seeking && !g.error && !g.dialogOpen;
}

/** True when a pointer move should re-show/re-arm the panel: it is hidden, or the pointer moved > 8 px. */
export function pointerMoveCounts(controlsVisible: boolean, last: { x: number; y: number } | null, x: number, y: number): boolean {
  if (!controlsVisible || !last) return true;
  return Math.abs(x - last.x) > 8 || Math.abs(y - last.y) > 8;
}

/** Auto-hide timer for the player panel: re-armable, and a no-op if hiding isn't allowed when it fires. */
export class HideTimer {
  private t: ReturnType<typeof setTimeout> | null = null;
  constructor(private canHide: () => boolean, private hide: () => void, private ms: number = 4000) {}

  arm(): void {
    this.cancel();
    this.t = setTimeout(() => {
      this.t = null;
      if (this.canHide()) this.hide();
    }, this.ms);
  }

  cancel(): void {
    if (this.t) clearTimeout(this.t);
    this.t = null;
  }
}
