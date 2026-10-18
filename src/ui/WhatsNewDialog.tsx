import { t } from '../i18n';
import { useEffect, useRef } from 'preact/hooks';
import { doesFocusableExist, getCurrentFocusKey, setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { focusAfterClose } from './focus';
import { whatsNew, closeWhatsNew, markWhatsNewShown } from '../store/whatsNew';
import { FocusGroup, Focusable, Button } from './components';
import { useKeys } from './keys';

/** The automatic «Что нового в …» waits while the player, the update screen or another prompt is open. */
export function shouldShowWhatsNew(routeName: string): boolean {
  return routeName !== 'player' && routeName !== 'update' && routeName !== 'pairPhone';
}

function focusIsInWhatsNew(key: string): boolean {
  return key === 'WHATSNEW' || key.indexOf('whatsnew-') === 0;
}

let stopPulse: (() => void) | null = null;

/** Pull focus onto OK when it is still on the screen behind the dialog. */
export function focusWhatsNew(): void {
  if (!whatsNew.peek()) return;
  let k = '';
  try {
    k = getCurrentFocusKey() || '';
  } catch (e) {
    k = '';
  }
  if (focusIsInWhatsNew(k)) return;
  if (doesFocusableExist('whatsnew-ok')) setFocus('whatsnew-ok');
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

  // Library rows call setFocus when they arrive, after this dialog has opened. Keep OK focused until it closes.
  useEffect(() => {
    if (!cur) return;
    focusWhatsNew();
    const timers = [0, 50, 400].map((ms) => setTimeout(focusWhatsNew, ms));
    const pulse = setInterval(focusWhatsNew, 300);
    const stop = () => {
      timers.forEach(clearTimeout);
      clearInterval(pulse);
    };
    stopPulse = stop;
    return () => {
      if (stopPulse === stop) stopPulse = null;
      stop();
    };
  }, [cur]);

  const close = () => {
    if (stopPulse) {
      stopPulse();
      stopPulse = null;
    }
    const k = prevFocus.current;
    prevFocus.current = undefined;
    closeWhatsNew();
    focusAfterClose(k);
  };

  useKeys((a) => {
    if (!whatsNew.value) return false;
    if (a === 'back') { close(); return true; }
    let k = '';
    try {
      k = getCurrentFocusKey() || '';
    } catch (e) {
      k = '';
    }
    // OK must not open the tile that still has focus behind the dialog
    if (!focusIsInWhatsNew(k)) {
      focusWhatsNew();
      return true;
    }
    return 'spatial';
  }, 70);

  if (!w) return null;
  return (
    <div class="dialog-backdrop">
      <FocusGroup key={w.title} focusKey="WHATSNEW" className="dialog whatsnew-dialog" boundary autoFocus autoRestoreFocus={false} preferredChildFocusKey="whatsnew-ok">
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
