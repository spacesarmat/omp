import { t } from '../i18n';
import { useEffect, useRef } from 'preact/hooks';
import { getCurrentFocusKey, setFocus, doesFocusableExist } from '@noriginmedia/norigin-spatial-navigation';
import { whatsNew, closeWhatsNew, markWhatsNewShown } from '../store/whatsNew';
import { FocusGroup, Focusable, Button } from './components';
import { useKeys } from './keys';

/** The automatic «Что нового в …» waits while the player, the update screen or another prompt is open. */
export function shouldShowWhatsNew(routeName: string): boolean {
  return routeName !== 'player' && routeName !== 'update' && routeName !== 'pairPhone';
}

/** «Что нового»: one focusable block per version (D-pad scrolls the list), OK closes. */
export function WhatsNewDialog() {
  const w = whatsNew.value;
  const prevFocus = useRef<string | undefined>(undefined);
  const seen = useRef<string | null>(null);
  const cur = w ? w.title : null;
  if (cur !== seen.current) {
    seen.current = cur;
    if (cur) {
      try {
        prevFocus.current = getCurrentFocusKey() || undefined;
      } catch (e) {
        prevFocus.current = undefined;
      }
    }
  }

  useEffect(() => { if (cur) markWhatsNewShown(); }, [cur]);

  const close = () => {
    const k = prevFocus.current;
    prevFocus.current = undefined;
    closeWhatsNew();
    if (k && doesFocusableExist(k)) setFocus(k);
  };

  useKeys((a) => {
    if (!whatsNew.value) return false;
    if (a === 'back') { close(); return true; }
    return 'spatial';
  }, 70);

  if (!w) return null;
  return (
    <div class="dialog-backdrop">
      <FocusGroup key={w.title} focusKey="WHATSNEW" className="dialog whatsnew-dialog" boundary autoFocus preferredChildFocusKey="whatsnew-ok">
        <div class="dialog-title">{w.title}</div>
        <div class="whatsnew-list">
          {w.entries.map((e, i) => (
            <Focusable key={e.version} focusKey={'whatsnew-v' + i} className="whatsnew-ver">
              <h2>{e.version}</h2>
              <ul class="update-notes">{e.items.map((n, j) => <li key={j}>{n}</li>)}</ul>
            </Focusable>
          ))}
          {w.entries.length === 0 && <div class="muted">{t('whatsNew.empty')}</div>}
        </div>
        <div class="row update-actions">
          <Button focusKey="whatsnew-ok" label="OK" className="primary" onPress={close} />
        </div>
      </FocusGroup>
    </div>
  );
}
