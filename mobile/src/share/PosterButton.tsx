// A catalog poster: a tap opens the card, a long press opens the title actions.
import { useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { CatalogTitle } from '../../../src/catalog/tmdb';
import { useLongPress } from '../ui/longPress';
import { CatalogMenu } from './CatalogMenu';

export function PosterButton(p: {
  item: CatalogTitle;
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
      {open && <CatalogMenu item={p.item} onClose={() => setOpen(false)} />}
    </>
  );
}
