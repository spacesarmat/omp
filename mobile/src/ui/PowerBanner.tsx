import { useState } from 'preact/hooks';
import { t } from '../../../src/i18n';

/** «Включить» for a device that is not connected, plus the Wake-on-LAN hint. */
export function PowerBanner({ offline, name, onWake }: { offline: boolean; name: string; onWake: () => void }) {
  const [hint, setHint] = useState(false);
  if (!offline) return null;
  return (
    <div class="m-field" data-power={name}>
      <button type="button" class="m-btn m-btn-primary tm" data-code="P08.2" onClick={onWake}>
        {t('remote.powerOn')}
      </button>
      <button type="button" class="m-btn m-btn-secondary tm" data-code="P08.3" aria-expanded={hint} onClick={() => setHint((v) => !v)}>
        {t('remote.wolHow')}
      </button>
      {hint && <p class="m-muted m-small">{t('remote.wolHint')}</p>}
    </div>
  );
}
