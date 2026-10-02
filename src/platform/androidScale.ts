// Android TV: the TV interface is laid out for 1920×1080 CSS px. MainActivity turns on the wide viewport so
// <meta name="viewport" content="width=1920"> applies; this is the safety net for WebViews that still report a
// different layout width — the .app root is scaled to fit the window.

const BASE_W = 1920;
const BASE_H = 1080;
const TOLERANCE = 2;

interface ScaleWindow {
  innerWidth: number;
}

function setTransform(el: HTMLElement, value: string): void {
  const st = el.style as CSSStyleDeclaration & { webkitTransform?: string; webkitTransformOrigin?: string };
  st.transform = value;
  st.webkitTransform = value;
  const origin = value ? '0 0' : '';
  st.transformOrigin = origin;
  st.webkitTransformOrigin = origin;
}

/** Scales `el` by innerWidth/1920 unless the window is already ~1920 wide; returns the applied factor. */
export function applyTvScale(el: HTMLElement, win: ScaleWindow = window): number {
  const w = win.innerWidth;
  if (!(w > 0) || Math.abs(w - BASE_W) <= TOLERANCE) {
    setTransform(el, '');
    return 1;
  }
  const s = w / BASE_W;
  el.style.width = BASE_W + 'px';
  el.style.height = BASE_H + 'px';
  setTransform(el, 'scale(' + s + ')');
  return s;
}

/** Keeps the .app root scaled on load and resize; returns the uninstaller. */
export function installAndroidScale(root?: HTMLElement | null): () => void {
  const el = root || (document.querySelector('.app') as HTMLElement | null);
  if (!el) return () => undefined;
  const update = () => { applyTvScale(el); };
  update();
  window.addEventListener('resize', update);
  window.addEventListener('load', update);
  return () => {
    window.removeEventListener('resize', update);
    window.removeEventListener('load', update);
    setTransform(el, '');
  };
}
