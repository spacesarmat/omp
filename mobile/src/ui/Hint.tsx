import { useLayoutEffect, useState } from 'preact/hooks';
import { t } from '../../../src/i18n';
import type { Key } from '../../../src/i18n';
import { settings } from '../../../src/store/settings';
import { currentRoute } from '../nav';
import { hintOffers, markHintSeen, pickHint, registerHint, unregisterHint } from '../../../src/onboarding/hints';

const TEXT: { [id: string]: Key } = {
  catalog: 'hints.catalog',
  mine: 'hints.mine',
  audiobooks: 'hints.audiobooks',
  audiobookPlayer: 'hints.audiobookPlayer',
  videoPlayer: 'hints.videoPlayer',
};

/** Offer this hint while the screen that owns the control is mounted. */
export function useHint(id: string): void {
  useLayoutEffect(() => {
    registerHint(id);
    return () => unregisterHint(id);
  }, [id]);
}

function anchorOf(id: string): HTMLElement | null {
  return document.querySelector('[data-hint-anchor="' + id + '"]');
}

/**
 * One coach mark at a time, under the control it explains. Tap dismisses it for good.
 * Nothing is drawn over «Сейчас играет» (the remote of a film that is already playing).
 */
export function HintHost(p: { blocked: boolean }) {
  const offered = hintOffers();
  const seen = settings.value.seenHints;
  const route = currentRoute.value.name;
  const [box, setBox] = useState<{ id: string; top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (p.blocked || route === 'nowPlaying') {
      setBox(null);
      return;
    }
    const id = pickHint(offered, seen, (hint) => !!anchorOf(hint));
    if (!id) {
      setBox(null);
      return;
    }
    const el = anchorOf(id);
    const r = el ? el.getBoundingClientRect() : null;
    const top = r && r.width > 0 ? Math.min(r.bottom + 8, window.innerHeight - 120) : window.innerHeight - 140;
    const left = r && r.width > 0 ? Math.max(16, Math.min(r.left, window.innerWidth - 280)) : 16;
    setBox((prev) => (prev && prev.id === id && prev.top === top && prev.left === left ? prev : { id, top, left }));
  });

  if (!box) return null;
  const text = TEXT[box.id] ? t(TEXT[box.id]) : box.id;
  return (
    <div class="m-hint" style={{ top: box.top + 'px', left: box.left + 'px' }} data-hint={box.id} role="note">
      <p>{text}</p>
      <button type="button" data-action="hint-dismiss" onClick={() => markHintSeen(box.id)}>
        {t('hints.dismiss')}
      </button>
    </div>
  );
}
