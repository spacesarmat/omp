import type { ComponentChildren } from 'preact';
import { createPortal } from 'preact/compat';
import { useBackHandler } from './backStack';
import { t } from '../../../src/i18n';

/** Bottom sheet with a dimmed backdrop; the backdrop and the system «Назад» (`onBack`, else `onClose`) close it.
 * Portaled to document.body so position:fixed still works inside CSS-transformed ancestors (e.g. NowDeck). */
export function Sheet({
  onClose,
  onBack,
  label,
  children,
}: {
  onClose: () => void;
  onBack?: () => void;
  label: string;
  children: ComponentChildren;
}) {
  useBackHandler(() => (onBack ?? onClose)());
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div class="m-sheet-host">
      <button type="button" class="m-sheet-backdrop" aria-label={t('common.close')} onClick={onClose} />
      <div class="m-sheet" role="dialog" aria-label={label}>
        <div class="m-sheet-grip" />
        {children}
      </div>
    </div>,
    document.body,
  );
}
