import { useState } from 'preact/hooks';
import { t } from '../../../src/i18n';
import { IR_BRAND_IDS } from '../tv/power/irCodes';
import type { Key } from '../../../src/i18n';

const BRAND_KEY: { [id: string]: Key } = {
  lg: 'remote.ir.lg',
  samsung: 'remote.ir.samsung',
  sony: 'remote.ir.sony',
  philips: 'remote.ir.philips',
  panasonic: 'remote.ir.panasonic',
};

function brandLabel(id: string): string {
  return t(BRAND_KEY[id] || 'remote.ir.lg');
}

export interface IrHardware {
  transmit: boolean;
  receive: boolean;
}

export interface IrButtonRow {
  id: string;
  name: string;
}

/** IR controls. Hidden when the phone cannot transmit. Native learning is hidden when the phone cannot receive. */
export function IrPanel({
  hardware,
  buttons,
  onTest,
  onDelete,
  onLearn,
  onImport,
  onSend,
  onLearnExt,
}: {
  hardware: IrHardware;
  buttons: IrButtonRow[];
  onTest: (brand: string) => void;
  onDelete: (id: string) => void;
  onLearn: () => void;
  onImport: (text: string) => void;
  onSend?: (id: string) => void;
  onLearnExt?: () => void;
}) {
  const [brand, setBrand] = useState('lg');
  const [paste, setPaste] = useState('');
  if (!hardware.transmit) return null;
  return (
    <div class="m-field">
      <h2 class="m-small">{t('remote.ir.title')}</h2>
      <label for="ir-brand">{t('remote.ir.brand')}</label>
      <select id="ir-brand" class="m-input tm" data-code="P08.4" value={brand} onChange={(e) => setBrand((e.target as HTMLSelectElement).value)}>
        {IR_BRAND_IDS.map((id) => (
          <option key={id} value={id}>
            {brandLabel(id)}
          </option>
        ))}
      </select>
      <button type="button" class="m-btn m-btn-primary tm" data-code="P08.5" onClick={() => onTest(brand)}>
        {t('remote.ir.test')}
      </button>
      {hardware.receive && (
        <button type="button" class="m-btn m-btn-secondary tm" data-code="P08.6" onClick={onLearn}>
          {t('remote.ir.learnPhone')}
        </button>
      )}
      {onLearnExt && (
        <button type="button" class="m-btn m-btn-secondary tm" data-code="P08.9" onClick={onLearnExt}>
          {t('remote.ir.learnExt')}
        </button>
      )}
      <input
        class="tm"
        data-code="P08.10"
        type="file"
        accept=".ir,.txt,text/plain"
        onChange={(e) => {
          const file = (e.target as HTMLInputElement).files && (e.target as HTMLInputElement).files![0];
          if (!file) return;
          void file.text().then(onImport);
        }}
      />
      <label for="ir-paste">{t('remote.ir.paste')}</label>
      <textarea id="ir-paste" class="m-input" rows={3} value={paste} onInput={(e) => setPaste((e.target as HTMLTextAreaElement).value)} />
      <button type="button" class="m-btn m-btn-secondary tm" data-code="P08.8" onClick={() => onImport(paste)}>
        {t('remote.ir.importBtn')}
      </button>
      {buttons.map((b) => (
        <div key={b.id} class="m-tv-row">
          <button type="button" class="m-btn m-btn-secondary m-btn-sm" onClick={() => onSend && onSend(b.id)}>
            {b.name}
          </button>
          <button type="button" class="m-btn m-btn-secondary m-btn-sm tm" data-code="P08.7" onClick={() => onDelete(b.id)}>
            {t('remote.ir.delete')}
          </button>
        </div>
      ))}
    </div>
  );
}
