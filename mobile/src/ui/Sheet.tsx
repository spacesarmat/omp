import type { ComponentChildren } from 'preact';

/** Bottom sheet with a dimmed backdrop; the backdrop closes it. */
export function Sheet({ onClose, label, children }: { onClose: () => void; label: string; children: ComponentChildren }) {
  return (
    <div class="m-sheet-host">
      <button type="button" class="m-sheet-backdrop" aria-label="Закрыть" onClick={onClose} />
      <div class="m-sheet" role="dialog" aria-label={label}>
        <div class="m-sheet-grip" />
        {children}
      </div>
    </div>
  );
}
