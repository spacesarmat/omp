// Android TV: the remote's Back and media keys never reach the WebView as webOS key codes. MainActivity
// intercepts them and calls window.__ompKey(<webOS keyCode>) (Back → 461, media → 415/19/179/417/412/33/34/413).
// The key is dispatched as a keydown on the focused element, so it runs the same path as a real key press.

declare global {
  interface Window {
    __ompKey?: (code: number) => boolean;
    __ompBack?: () => boolean;
  }
}

export const BACK_KEY = 461;

/** Dispatches a keydown with the given keyCode; true when the app handled it (default prevented). */
export function sendKey(code: number): boolean {
  let e: Event;
  try {
    e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true });
  } catch (_e) {
    e = document.createEvent('Event');
    e.initEvent('keydown', true, true);
  }
  // keyCode/which are read-only getters on KeyboardEvent; own properties shadow them
  Object.defineProperty(e, 'keyCode', { value: code });
  Object.defineProperty(e, 'which', { value: code });
  const target = (document.activeElement as HTMLElement | null) || document.body;
  target.dispatchEvent(e);
  return e.defaultPrevented;
}

/** Installs window.__ompKey / window.__ompBack for MainActivity. Returns the uninstaller. */
export function installAndroidKeyBridge(): () => void {
  window.__ompKey = (code: number) => sendKey(code);
  window.__ompBack = () => sendKey(BACK_KEY);
  return () => {
    delete window.__ompKey;
    delete window.__ompBack;
  };
}
