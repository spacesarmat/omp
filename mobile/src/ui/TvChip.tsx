import { Icon } from './Icon';
import { navigate } from '../nav';
import { activeTv } from '../tv/tvStore';

/** Header chip: green with the TV name when one is saved, grey «Подключить ТВ» otherwise. */
export function TvChip() {
  const tv = activeTv.value;
  return (
    <button type="button" class={'m-tvchip' + (tv ? ' on' : '')} onClick={() => navigate({ name: 'tv' })}>
      <Icon d="M3 5h18v11H3zM8 20h8" size={16} />
      <span>{tv ? tv.name : 'Подключить ТВ'}</span>
    </button>
  );
}
