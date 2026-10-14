// Vertical pages of «Сейчас на ТВ»: the remote sits above the card, the release's episodes sit below.
export type DeckPane = 'remote' | 'now' | 'episodes';

/** A release switches past this share of the screen, or on a short flick. */
const FAR = 0.22;
const FLICK_PX = 48;
const FLICK = 0.55;

/** The pane after a vertical drag. `dy` is the finger movement: positive means down. */
export function deckPaneAfter(pane: DeckPane, dy: number, ms: number, height: number): DeckPane {
  const travel = Math.abs(dy);
  const flick = travel >= FLICK_PX && travel / Math.max(ms, 1) >= FLICK;
  const far = travel >= Math.max(1, height) * FAR;
  if (!flick && !far) return pane;
  if (dy > 0) return pane === 'episodes' ? 'now' : pane === 'now' ? 'remote' : pane;
  return pane === 'remote' ? 'now' : pane === 'now' ? 'episodes' : pane;
}

/** A sideways swipe on an episode row (either way) starts that episode. */
export function episodeSwipePlays(dx: number, dy: number, ms: number): boolean {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax < ay * 1.2) return false;
  return ax >= 72 || (ax >= 36 && ax / Math.max(ms, 1) >= 0.45);
}
