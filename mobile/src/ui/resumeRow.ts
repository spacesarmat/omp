// «Продолжить просмотр»: compact cards that fill the row.
// At least RESUME_MIN_VISIBLE cards stay on screen. A wider row fits more, near RESUME_CARD_TARGET px.
// The gap matches .m-resume-row in mobile.css (8px). The CSS fallback is four cards: calc((100% - 24px) / 4).

/** Gap between continue cards, px. */
export const RESUME_GAP = 8;
/** Never fewer than this many cards across the visible row. */
export const RESUME_MIN_VISIBLE = 4;
/** Preferred card width. Wider screens fit more cards instead of growing these. */
export const RESUME_CARD_TARGET = 96;

export interface ResumeRowLayout {
  /** How many cards fill the visible width. */
  visible: number;
  /** Card width in px. 0 before the row has been measured. */
  cardPx: number;
}

/** How many cards fit in `width` px, and the width of each so they fill that row evenly. */
export function resumeRowLayout(width: number): ResumeRowLayout {
  if (!(width > 0)) return { visible: RESUME_MIN_VISIBLE, cardPx: 0 };
  const fit = Math.floor((width + RESUME_GAP) / (RESUME_CARD_TARGET + RESUME_GAP));
  const visible = Math.max(RESUME_MIN_VISIBLE, fit);
  const cardPx = (width - RESUME_GAP * (visible - 1)) / visible;
  return { visible, cardPx };
}

/**
 * The measured row is in the document only in «Мои», not in history, selection or the unavailable state,
 * and only while the section is open and has cards. The width hook must follow the same flag: a row that
 * mounts later (Discover, then Mine) is measured on that mount, not left on the four-card fallback.
 */
export function resumeRowActive(o: {
  mine: boolean;
  history: boolean;
  selecting: boolean;
  unavailable: boolean;
  open: boolean;
  count: number;
}): boolean {
  return o.mine && !o.history && !o.selecting && !o.unavailable && o.open && o.count > 0;
}

/** Inline style for the measured card width. Unset until the row has a width, so the CSS fallback applies. */
export function resumeCardStyle(cardPx: number): string | undefined {
  return cardPx > 0 ? '--m-resume-card:' + cardPx + 'px' : undefined;
}
