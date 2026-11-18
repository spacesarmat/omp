// Store-build stand-in for src/platform/hbchannel.ts. vite.store.config.ts aliases the real module
// here so Homebrew Channel Luna calls are not in the ipk. The sideload build does not use this file.
// Do not import the real module: the alias would either loop or pull the Luna calls back in.

export type HbPresence = 'installed' | 'missing' | 'unknown';

export function hbPresence(): Promise<HbPresence> {
  return Promise.resolve('missing');
}

export function hbHasRoot(): Promise<boolean> {
  return Promise.resolve(false);
}

export function openHbChannel(_addRepositoryUrl?: string): Promise<void> {
  return Promise.resolve();
}

export function installStatus(_m: { statusText?: string; progress?: number; finished?: boolean }): { stage: 'done'; text: string } {
  return { stage: 'done', text: '' };
}

export function hbInstall(
  _ipkUrl: string,
  _ipkHash: string,
  _onStatus: (s: { stage: string; text: string }) => void,
  _onError: (e: Error) => void,
): () => void {
  return () => undefined;
}
