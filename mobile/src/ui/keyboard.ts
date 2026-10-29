// Detects the soft keyboard (visualViewport shrinks) and toggles `m-kb-open` on <html>,
// so the tab bar, the mini player and the bottom reserve can step aside while the user types.
// Also sets `--kb-inset`: how many px of the layout viewport sit under the IME (0 when closed).
const CLASS = 'm-kb-open';
const DROP = 150;

function viewportHeight(): number {
  const vv = window.visualViewport;
  return vv && vv.height > 0 ? vv.height : window.innerHeight;
}

/** Layout px covered by the soft keyboard / occluded below the visual viewport. */
export function keyboardInset(): number {
  const vv = window.visualViewport;
  if (!vv || !(vv.height > 0)) return 0;
  return Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
}

/** A text field has the focus: a shorter window then means the soft keyboard (also read by landscapeCols.ts). */
export function editableFocused(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA') return true;
  if (tag === 'INPUT') {
    const type = ((el as HTMLInputElement).type || 'text').toLowerCase();
    return !['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'file', 'image', 'color'].includes(type);
  }
  return el.isContentEditable === true || el.getAttribute('contenteditable') === 'true';
}

function setInset(px: number) {
  document.documentElement.style.setProperty('--kb-inset', px + 'px');
}

export function startKeyboardWatch(): () => void {
  let base = viewportHeight();
  let landscape = window.innerWidth > window.innerHeight;
  let frame = 0;

  const update = () => {
    frame = 0;
    const isLandscape = window.innerWidth > window.innerHeight;
    const h = viewportHeight();
    if (isLandscape !== landscape) {
      landscape = isLandscape;
      base = h;
    }
    if (h > base) base = h;
    const open = base - h > DROP && editableFocused();
    document.documentElement.classList.toggle(CLASS, open);
    setInset(open ? keyboardInset() : 0);
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update) || 0;
  };

  window.addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('scroll', schedule);
  document.addEventListener('focusin', schedule);
  document.addEventListener('focusout', schedule);
  schedule();

  return () => {
    window.removeEventListener('resize', schedule);
    window.visualViewport?.removeEventListener('resize', schedule);
    window.visualViewport?.removeEventListener('scroll', schedule);
    document.removeEventListener('focusin', schedule);
    document.removeEventListener('focusout', schedule);
    if (frame) cancelAnimationFrame(frame);
    document.documentElement.classList.remove(CLASS);
    setInset(0);
  };
}
