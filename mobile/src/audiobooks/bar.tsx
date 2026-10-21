import { t } from '../../../src/i18n';
import { goBack } from '../nav';
import { Icon } from '../ui/Icon';

const BACK = 'M15 5l-7 7 7 7';

/** The back row of an audiobook screen, same as the other screens under «Настройки». */
export function AudiobookBar({ title, code }: { title: string; code?: string }) {
  return (
    <div class="m-bar">
      <button type="button" class={code ? 'm-icon-btn tm' : 'm-icon-btn'} data-code={code} aria-label={t('common.back')} onClick={() => goBack()}>
        <Icon d={BACK} />
      </button>
      <h1 class="m-bar-title">{title}</h1>
    </div>
  );
}
