import { useEffect } from 'preact/hooks';
import { Sheet } from './Sheet';
import { sheetBackHandler } from './UpdateSheet';
import { whatsNew, closeWhatsNew, markWhatsNewShown } from '../../../src/store/whatsNew';
import { CHANGELOG_URL } from '../../../src/lib/changelogData';

/** «Что нового»: opened from Settings or once after an update; state lives in the whatsNew signal. */
export function WhatsNewSheet() {
  const w = whatsNew.value;
  useEffect(() => {
    if (!w) return;
    const h = () => {
      closeWhatsNew();
      return true;
    };
    sheetBackHandler.current = h;
    return () => {
      if (sheetBackHandler.current === h) sheetBackHandler.current = null;
    };
  }, [!!w]);
  useEffect(() => {
    if (w) markWhatsNewShown();
  }, [w ? w.title : '']);
  if (!w) return null;
  return (
    <Sheet label="Что нового" onClose={closeWhatsNew}>
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
        {w.entries.length === 0 && <div class="m-muted">Список изменений недоступен</div>}
      </div>
      <button type="button" class="m-btn m-btn-secondary" onClick={() => window.open(CHANGELOG_URL, '_system')}>
        Все изменения на GitHub
      </button>
      <button type="button" class="m-btn m-btn-primary" onClick={closeWhatsNew}>
        Закрыть
      </button>
    </Sheet>
  );
}
