const ROW = '.m-disc-rail-row, .m-tc-similar, .m-tc-cast, .m-chips, .m-tabs, .m-hfilters, .m-disc-chips, .m-tc-chips';

/** Vertical wheel over a horizontal row scrolls that row. */
export function wheelToRow(event: Pick<WheelEvent, 'target' | 'deltaX' | 'deltaY' | 'preventDefault'>): boolean {
  const node = event.target as { closest?: (selector: string) => HTMLElement | null } | null;
  const row = node && node.closest ? node.closest(ROW) : null;
  if (!row || row.scrollWidth <= row.clientWidth + 1) return false;
  if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return false;
  row.scrollLeft += event.deltaY;
  event.preventDefault();
  return true;
}

export function installWheelScroll(target: Window | Document = window): () => void {
  const onWheel = (event: Event) => {
    wheelToRow(event as WheelEvent);
  };
  target.addEventListener('wheel', onWheel, { passive: false });
  return () => target.removeEventListener('wheel', onWheel);
}
