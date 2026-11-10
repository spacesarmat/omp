// Device class for ranking. Kept separate so search and catalog code can read it
// without loading the native HTTP stack.
export type WatchClass = 'tv' | 'phone';

let deviceClass: WatchClass = 'tv';

export function setWatchDeviceClass(kind: WatchClass): void {
  deviceClass = kind === 'tv' ? 'tv' : 'phone';
}

export function watchDeviceClass(): WatchClass {
  return deviceClass;
}
