import { Icon } from './Icon';
import { navigate } from '../nav';
import { activeTv } from '../tv/tvStore';
import { tvState } from '../tv/tvClient';

/** Header chip: icon only. Green when the TV is connected, neutral otherwise. */
export function TvChip() {
  const tv = activeTv.value;
  const connected = !!tv && tvState.value === 'connected';
  const label = !tv
    ? 'Выбрать телевизор'
    : connected
      ? 'Телевизор «' + tv.name + '» подключён'
      : 'Телевизор «' + tv.name + '» не подключён';
  return (
    <button type="button" class={'m-tvchip' + (connected ? ' on' : '')} aria-label={label} onClick={() => navigate({ name: 'tv' })}>
      <Icon d="M3 5h18v11H3zM8 20h8" size={22} />
    </button>
  );
}
