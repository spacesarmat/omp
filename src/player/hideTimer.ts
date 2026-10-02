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
