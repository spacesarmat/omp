// Detects the soft keyboard (the WebView resizes with it) and toggles `m-kb-open` on <html>,
// so the tab bar, the mini player and the bottom reserve can step aside while the user types.
const CLASS = 'm-kb-open';
const DROP = 150;

function viewportHeight(): number {
  const vv = window.visualViewport;
  return vv && vv.height > 0 ? vv.height : window.innerHeight;
}

function editableFocused(): boolean {
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
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update) || 0;
  };

  window.addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('resize', schedule);
  document.addEventListener('focusin', schedule);
  document.addEventListener('focusout', schedule);
  schedule();

  return () => {
    window.removeEventListener('resize', schedule);
    window.visualViewport?.removeEventListener('resize', schedule);
    document.removeEventListener('focusin', schedule);
    document.removeEventListener('focusout', schedule);
    if (frame) cancelAnimationFrame(frame);
    document.documentElement.classList.remove(CLASS);
  };
}
