// A catalog poster: a tap opens the card, a long press opens «Поделиться».
import { useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { Kind } from '../../../src/catalog/tmdb';
import { useLongPress } from '../ui/longPress';
import { ShareMenu } from './ShareMenu';
import { posterShare } from './text';
import { sendShare } from './send';

export function PosterButton(p: {
  item: { kind: Kind; id: number; title: string; year: number };
  className: string;
  label: string;
  anchor?: string;
  onOpen: () => void;
  children: ComponentChildren;
}) {
  const [open, setOpen] = useState(false);
  const press = useLongPress(() => setOpen(true), p.onOpen);
  return (
    <>
      <button type="button" class={p.className} aria-label={p.label} data-anchor={p.anchor} {...press}>
        {p.children}
      </button>
      {open && (
        <ShareMenu
          label={p.item.title}
          onClose={() => setOpen(false)}
          onShare={() => void sendShare(posterShare(p.item))}
        />
      )}
    </>
  );
}
