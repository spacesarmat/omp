export type DesktopHotkey =
  | 'play-pause'
  | 'seek-back'
  | 'seek-forward'
  | 'volume-down'
  | 'volume-up'
  | 'fullscreen'
  | 'search'
  | 'back';

function typingTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false;
  const el = target as { tagName?: string; isContentEditable?: boolean };
  const tag = (el.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'button' || !!el.isContentEditable;
}

/** Desktop keys. Space and arrows stay with a text field. Ctrl/Cmd+K and Esc always count. */
export function desktopHotkey(event: KeyboardEvent): DesktopHotkey | null {
  const key = event.key;
  const typing = typingTarget(event.target);
  if ((event.ctrlKey || event.metaKey) && !event.altKey && key.toLowerCase() === 'k') return 'search';
  if (key === 'Escape') return 'back';
  if (typing) return null;
  if (key === ' ' || key === 'Spacebar') return 'play-pause';
  if (key === 'ArrowLeft') return 'seek-back';
  if (key === 'ArrowRight') return 'seek-forward';
  if (key === 'ArrowDown') return 'volume-down';
  if (key === 'ArrowUp') return 'volume-up';
  if (key === 'f' || key === 'F') return 'fullscreen';
  return null;
}
