// The small menu a long press on a poster opens. One action: share the title.
import { createPortal } from 'preact/compat';
import { t } from '../../../src/i18n';
import { Sheet } from '../ui/Sheet';
import { Icon, ICONS } from '../ui/Icon';

export function ShareMenu(p: { label: string; onClose: () => void; onShare: () => void }) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <Sheet label={p.label} onClose={p.onClose}>
      <div class="m-sheet-title">{p.label}</div>
      <button
        type="button"
        class="m-opt"
        data-share="title"
        onClick={() => {
          p.onClose();
          p.onShare();
        }}
      >
        <Icon d={ICONS.share} size={22} />
        <span class="m-opt-name">{t('share.action')}</span>
      </button>
    </Sheet>,
    document.body,
  );
}
