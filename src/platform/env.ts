export type PlatformKind = 'webos' | 'androidtv';

interface CapacitorLike {
  getPlatform?: () => string;
}

// androidtv: the TV bundle is loaded inside the Capacitor WebView of the Android APK
export function platformKind(): PlatformKind {
  const cap = (window as unknown as { Capacitor?: CapacitorLike }).Capacitor;
  try {
    if (cap && typeof cap.getPlatform === 'function' && cap.getPlatform() === 'android') return 'androidtv';
  } catch (e) {
    /* fall through to webos */
  }
  return 'webos';
}
