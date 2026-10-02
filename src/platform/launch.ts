declare global {
  interface Window {
    PalmSystem?: { launchParams?: string };
  }
}

export function readLaunchParams(): string | null {
  try {
    const p = window.PalmSystem && window.PalmSystem.launchParams;
    return typeof p === 'string' && p ? p : null;
  } catch (e) {
    return null;
  }
}

/** webOS fires webOSRelaunch on document when the running app is launched again (needs handlesRelaunch). */
export function onRelaunch(cb: (raw: string | null) => void): () => void {
  const h = () => cb(readLaunchParams());
  document.addEventListener('webOSRelaunch', h);
  return () => document.removeEventListener('webOSRelaunch', h);
}
