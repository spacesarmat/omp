export type PlatformKind = 'webos' | 'androidtv';

interface CapacitorLike {
  getPlatform?: () => string;
}

let previewKind: PlatformKind | null = null;

export function setPreviewPlatformKind(kind: PlatformKind | null): () => void {
  const previous = previewKind;
  previewKind = kind;
  let active = true;
  return () => {
    if (!active) return;
    previewKind = previous;
    active = false;
  };
}

// androidtv: the TV bundle is loaded inside the Capacitor WebView of the Android APK
export function platformKind(): PlatformKind {
  if (previewKind) return previewKind;
  const cap = (window as unknown as { Capacitor?: CapacitorLike }).Capacitor;
  try {
    if (cap && typeof cap.getPlatform === 'function' && cap.getPlatform() === 'android') return 'androidtv';
  } catch (e) {
    /* fall through to webos */
  }
  return 'webos';
}
