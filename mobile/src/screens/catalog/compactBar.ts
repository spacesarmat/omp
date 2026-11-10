// Phone landscape «Обзор»: the title and the view / sort / search buttons share the top bar with «Мои / Обзор».
// The same query as the compact catalog CSS. A tall window (portrait, a tablet, the desktop preview) stays two rows.
import { useEffect, useState } from 'preact/hooks';
import { signal } from '@preact/signals';

export const COMPACT_CATALOG_MQ = '(orientation: landscape) and (max-height: 520px)';

/** The slot inside the library header. Set from the slot's ref, null when that row is not mounted. */
export const discoverHeadSlot = signal<HTMLElement | null>(null);

export function setDiscoverHeadSlot(node: HTMLElement | null): void {
  if (discoverHeadSlot.value !== node) discoverHeadSlot.value = node;
}

function readCompact(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia(COMPACT_CATALOG_MQ).matches;
  } catch {
    return false;
  }
}

/** True while the phone is in the compact landscape catalog bar. Portrait stays false. */
export function useCompactCatalogBar(): boolean {
  const [on, setOn] = useState(readCompact);
  useEffect(() => {
    let mq: MediaQueryList;
    try {
      mq = matchMedia(COMPACT_CATALOG_MQ);
    } catch {
      return;
    }
    const apply = () => setOn(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);
  return on;
}
