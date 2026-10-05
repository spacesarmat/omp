import { Icon } from './Icon';
import { navigate } from '../nav';
import { activeTv } from '../tv/tvStore';
import { tvState } from '../tv/tvClient';
import { t } from '../../../src/i18n';

/** Header chip: icon only. Green when the TV is connected, neutral otherwise. */
export function TvChip() {
  const tv = activeTv.value;
  const connected = !!tv && tvState.value === 'connected';
  const label = !tv
    ? t('remote.chip.choose')
    : connected
      ? t('remote.chip.connected', { name: tv.name })
      : t('remote.chip.disconnected', { name: tv.name });
  return (
    <button type="button" class={'m-tvchip' + (connected ? ' on' : '')} aria-label={label} onClick={() => navigate({ name: 'tv' })}>
      <Icon d="M3 5h18v11H3zM8 20h8" size={22} />
    </button>
  );
}
