/** A short haptic tick (remote keys, a pinch step); silent where the device or WebView has no vibration. */
export function vibrate(): void {
  try {
    navigator.vibrate?.(10);
  } catch {
    /* no vibration support */
  }
}
