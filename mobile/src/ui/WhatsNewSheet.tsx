import { useEffect } from 'preact/hooks';
import { Sheet } from './Sheet';
import { whatsNew, closeWhatsNew, markWhatsNewShown } from '../../../src/store/whatsNew';
import { CHANGELOG_URL } from '../../../src/lib/changelogData';
import { activeMethods, openDonate } from '../donate';
import { t } from '../../../src/i18n';

/** «Что нового»: opened from Settings or once after an update; state lives in the whatsNew signal. */
export function WhatsNewSheet() {
  const w = whatsNew.value;
  useEffect(() => {
    if (w) markWhatsNewShown();
  }, [w ? w.title : '']);
  if (!w) return null;
  return (
    <Sheet label={t('whatsNew.title')} onClose={closeWhatsNew}>
      <div class="m-sheet-title">{w.title}</div>
      <div class="m-whatsnew m-sheet-scroll">
        {w.entries.map((e) => (
          <section key={e.version}>
            <h3>{e.version}</h3>
            <ul class="m-notes">
              {e.items.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </section>
        ))}
        {w.entries.length === 0 && <div class="m-muted">{t('whatsNew.empty')}</div>}
      </div>
      <button type="button" class="m-btn m-btn-secondary" onClick={() => window.open(CHANGELOG_URL, '_system')}>
        {t('whatsNew.allChanges')}
      </button>
      {activeMethods().length > 0 && (
        <button
          type="button"
          class="m-link"
          onClick={() => {
            closeWhatsNew();
            openDonate();
          }}
        >
          {t('donate.title')}
        </button>
      )}
      <button type="button" class="m-btn m-btn-primary" onClick={closeWhatsNew}>
        {t('common.close')}
      </button>
    </Sheet>
  );
}
