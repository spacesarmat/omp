export type SidebarMode = 'expanded' | 'rail' | 'hidden';

export const SIDEBAR_KEY = 'omp.desktop.sidebar';
export const SIDEBAR_NARROW_PX = 960;

const MODES: SidebarMode[] = ['expanded', 'rail', 'hidden'];

export function nextSidebarMode(mode: SidebarMode): SidebarMode {
  const index = MODES.indexOf(mode);
  return MODES[(index < 0 ? 0 : index + 1) % MODES.length];
}

export function readSidebarMode(storage: Pick<Storage, 'getItem'> | null): SidebarMode {
  const value = storage ? storage.getItem(SIDEBAR_KEY) : null;
  return value === 'rail' || value === 'hidden' || value === 'expanded' ? value : 'expanded';
}

export function writeSidebarMode(storage: Pick<Storage, 'setItem'> | null, mode: SidebarMode): void {
  if (storage) storage.setItem(SIDEBAR_KEY, mode);
}

export function sidebarIsNarrow(width: number): boolean {
  return width > 0 && width < SIDEBAR_NARROW_PX;
}

export function sidebarShortcut(event: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }): boolean {
  return event.key.toLowerCase() === 'b' && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey;
}
