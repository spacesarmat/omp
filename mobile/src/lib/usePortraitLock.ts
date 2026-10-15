import { useEffect } from 'preact/hooks';
import { native } from '../platform/native';

/** Locks the phone Activity to portrait while the host screen is mounted (no-op on TV / web without API). */
export function usePortraitLock(): void {
  useEffect(() => {
    void native.setOrientation('portrait');
    const o = typeof screen !== 'undefined' ? screen.orientation : null;
    if (o && typeof o.lock === 'function') {
      void o.lock('portrait').catch(() => {});
    }
    return () => {
      void native.setOrientation('unlock');
      if (o && typeof o.unlock === 'function') {
        try {
          o.unlock();
        } catch {
          /* older browsers */
        }
      }
    };
  }, []);
}
