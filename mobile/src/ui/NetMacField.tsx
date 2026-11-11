import { useState } from 'preact/hooks';
import { t } from '../../../src/i18n';
import { normalizeMac } from '../tv/tvStore';
import { TextField } from './TextField';

/** MAC for a TV found on the network. Wake-on-LAN needs it, and discovery often does not send one. */
export function NetMacField({ id, onSave }: { id: string; onSave: (mac: string) => boolean }) {
  const [error, setError] = useState('');

  function save(e: Event) {
    e.preventDefault();
    const data = new FormData(e.currentTarget as HTMLFormElement);
    const next = normalizeMac(String(data.get('mac') || ''));
    if (!next || !onSave(next)) {
      setError(t('remote.badMac'));
      return;
    }
    setError('');
  }

  return (
    <form class="m-field" onSubmit={save}>
      <label for={id}>{t('remote.macForWake')}</label>
      <TextField id={id} name="mac" class="m-input" />
      {error && (
        <div class="m-error" role="alert">
          {error}
        </div>
      )}
      <button type="submit" class="m-btn m-btn-primary m-btn-sm tm" data-code="P10.2">
        {t('remote.macAdd')}
      </button>
    </form>
  );
}
