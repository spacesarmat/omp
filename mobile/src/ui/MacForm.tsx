import { useState } from 'preact/hooks';
import { t } from '../../../src/i18n';
import { normalizeMac } from '../tv/tvStore';
import { TextField } from './TextField';

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

export interface ManualDraft {
  name: string;
  mac: string;
  ip?: string;
}

/** Add a device by MAC. The IP is optional and only helps the subnet broadcast. */
export function MacForm({ onAdd }: { onAdd: (d: ManualDraft) => void }) {
  const [error, setError] = useState('');

  function save(e: Event) {
    e.preventDefault();
    const data = new FormData(e.currentTarget as HTMLFormElement);
    const next = normalizeMac(String(data.get('mac') || ''));
    const label = String(data.get('name') || '').trim();
    const addr = String(data.get('ip') || '').trim();
    if (!next) {
      setError(t('remote.badMac'));
      return;
    }
    if (addr && !IPV4.test(addr)) {
      setError(t('install.assistant.badIp'));
      return;
    }
    setError('');
    onAdd({ name: label || t('remote.macDevice'), mac: next, ip: addr || undefined });
    const form = e.currentTarget as HTMLFormElement;
    form.reset();
  }

  return (
    <form class="m-field" onSubmit={save}>
      <label for="wol-name">{t('remote.macName')}</label>
      <TextField id="wol-name" name="name" class="m-input" />
      <label for="wol-mac">{t('remote.macLabel')}</label>
      <TextField id="wol-mac" name="mac" class="m-input" />
      <label for="wol-ip">{t('remote.macIp')}</label>
      <TextField id="wol-ip" name="ip" class="m-input" inputMode="decimal" />
      {error && (
        <div class="m-error" role="alert">
          {error}
        </div>
      )}
      <button type="submit" class="m-btn m-btn-primary tm" data-code="P10.2">
        {t('remote.macAdd')}
      </button>
    </form>
  );
}
