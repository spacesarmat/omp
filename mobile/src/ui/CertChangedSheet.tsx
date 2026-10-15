import { certAsk, answerCertChange } from '../tv/certPin';
import { Sheet } from './Sheet';
import { t } from '../../../src/i18n';

/** Shown when a paired TV or box presents a different certificate than the one remembered at the first connection. */
export function CertChangedSheet() {
  if (!certAsk.value) return null;
  return (
    <Sheet onClose={() => answerCertChange(false)} label={t('cert.title')}>
      <div class="m-sheet-title">{t('cert.title')}</div>
      <p>{t('cert.text')}</p>
      <button type="button" class="m-btn m-btn-primary" onClick={() => answerCertChange(true)}>
        {t('cert.trust')}
      </button>
      <button type="button" class="m-btn" onClick={() => answerCertChange(false)}>
        {t('common.cancel')}
      </button>
    </Sheet>
  );
}
