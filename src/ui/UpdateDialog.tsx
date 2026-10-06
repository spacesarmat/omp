import { t } from '../i18n';
import { useRef } from 'preact/hooks';
import { getCurrentFocusKey, setFocus, doesFocusableExist } from '@noriginmedia/norigin-spatial-navigation';
import { updatePrompt, skipVersion, dismissPrompt } from '../store/updates';
import { APP_VERSION } from '../version';
import { updateNotes } from '../lib/updateInfo';
import { FocusGroup, Button } from './components';
import { useKeys } from './keys';
import { navigate } from './nav';

/** The prompt is never shown over the player or the update screen; the signal survives, so it appears after leaving it. */
export function shouldShowUpdateDialog(routeName: string): boolean {
  return routeName !== 'player' && routeName !== 'update';
}

export function UpdateDialog() {
  const info = updatePrompt.value;
  const prevFocus = useRef<string | undefined>(undefined);

  // capture synchronously during render: the child FocusGroup (autoFocus) steals focus in its own mount effect,
  // which runs before any effect of this component
  const seen = useRef<string | null>(null);
  const curVersion = info ? info.version : null;
  if (curVersion !== seen.current) {
    seen.current = curVersion;
    if (curVersion) {
      try {
        prevFocus.current = getCurrentFocusKey() || undefined;
      } catch (e) {
        prevFocus.current = undefined;
      }
    }
  }

  const restore = () => {
    const k = prevFocus.current;
    prevFocus.current = undefined;
    if (k && doesFocusableExist(k)) setFocus(k);
  };
  const later = () => { dismissPrompt(); restore(); };

  // modal: keys never reach the screen below; the confirm DialogHost (100) still wins
  useKeys((a) => {
    if (!updatePrompt.value) return false;
    if (a === 'back') { later(); return true; }
    return 'spatial';
  }, 70);

  if (!info) return null;
  return (
    <div class="dialog-backdrop">
      <FocusGroup key={info.version} focusKey="UPDATE-DIALOG" className="dialog update-dialog" boundary autoFocus>
        <div class="dialog-title">{t('update.available', { version: info.version })}</div>
        {updateNotes(info, 'tv').length > 0 && <ul class="update-notes">{updateNotes(info, 'tv').slice(0, 8).map((n, i) => <li key={i}>{n}</li>)}</ul>}
        <div class="muted update-current">{t('update.current', { version: APP_VERSION })}</div>
        <div class="row update-actions">
          <Button label={t('tv.updateDialog.update')} className="primary" onPress={() => { dismissPrompt(); navigate({ name: 'update' }); }} />
          <Button label={t('common.later')} onPress={later} />
          <Button label={t('tv.updateDialog.skip')} onPress={() => { skipVersion(info.version); restore(); }} />
        </div>
      </FocusGroup>
    </div>
  );
}
