// Store-build stand-in for src/platform/devmode.ts. No Developer Mode launch, no applicationManager.
// The sideload build keeps src/platform/devmode.ts (vite.store.config.ts aliases only the store build).

export function devmodeExtendAt(now: number): number {
  return now;
}

export function devmodeExpiring(_now: number): boolean {
  return false;
}

export function openDevMode(): Promise<void> {
  return Promise.resolve();
}

export function extendDevMode(_now: number): Promise<void> {
  return Promise.resolve();
}
