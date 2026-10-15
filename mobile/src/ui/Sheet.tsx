import type { ComponentChildren } from 'preact';
import { useBackHandler } from './backStack';
import { t } from '../../../src/i18n';

/** Bottom sheet with a dimmed backdrop; the backdrop and the system «Назад» (`onBack`, else `onClose`) close it. */
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
  return (
    <div class="m-sheet-host">
      <button type="button" class="m-sheet-backdrop" aria-label={t('common.close')} onClick={onClose} />
      <div class="m-sheet" role="dialog" aria-label={label}>
        <div class="m-sheet-grip" />
        {children}
      </div>
    </div>
  );
}
