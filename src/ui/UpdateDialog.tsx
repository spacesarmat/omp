import { useEffect, useRef } from 'preact/hooks';
import { getCurrentFocusKey, setFocus, doesFocusableExist } from '@noriginmedia/norigin-spatial-navigation';
import { updatePrompt, skipVersion, dismissPrompt } from '../store/updates';
import { APP_VERSION } from '../version';
import { FocusGroup, Button } from './components';
import { useKeys } from './keys';
import { navigate } from './nav';

export function UpdateDialog() {
  const info = updatePrompt.value;
  const prevFocus = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (info) {
      try {
        prevFocus.current = getCurrentFocusKey() || undefined;
      } catch (e) {
        prevFocus.current = undefined;
      }
    }
  }, [info ? info.version : null]);

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
        <div class="dialog-title">Доступна версия {info.version}</div>
        {info.notes.length > 0 && <ul class="update-notes">{info.notes.slice(0, 8).map((n, i) => <li key={i}>{n}</li>)}</ul>}
        <div class="muted update-current">Сейчас установлена {APP_VERSION}</div>
        <div class="row update-actions">
          <Button label="Обновить" className="primary" onPress={() => { dismissPrompt(); navigate({ name: 'update' }); }} />
          <Button label="Позже" onPress={later} />
          <Button label="Пропустить эту версию" onPress={() => { skipVersion(info.version); restore(); }} />
        </div>
      </FocusGroup>
    </div>
  );
}
