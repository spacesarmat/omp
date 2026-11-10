import { useRef, useState } from 'preact/hooks';
import { getCurrentFocusKey } from '@noriginmedia/norigin-spatial-navigation';
import { focusAfterClose } from './focus';
import { componentPrompt, dismissComponent, laterComponent } from '../store/componentUpdates';
import { installApk } from '../platform/androidNative';
import { platformKind } from '../platform/env';
import { t } from '../i18n';
import { FocusGroup, Button } from './components';
import { Qr } from './Qr';
import { useKeys } from './keys';

/** Not over the player or the update screen. The signal stays, so the dialog appears after leaving them. */
export function shouldShowComponentDialog(routeName: string): boolean {
  return routeName !== 'player' && routeName !== 'update';
}

export function ComponentUpdateDialog() {
  const offer = componentPrompt.value;
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [sawQr, setSawQr] = useState(false);
  const prevFocus = useRef<string | undefined>(undefined);
  const seen = useRef<string | null>(null);
  const key = offer ? offer.kind + ':' + offer.latest : null;
  if (key !== seen.current) {
    const opening = !seen.current && !!key;
    seen.current = key;
    setBusy(false);
    setPct(null);
    setError('');
    setSawQr(false);
    if (opening) {
      try {
        prevFocus.current = getCurrentFocusKey() || undefined;
      } catch (e) {
        prevFocus.current = undefined;
      }
    }
  }

  const restoreIfClosed = () => {
    if (componentPrompt.value) return;
    const k = prevFocus.current;
    prevFocus.current = undefined;
    focusAfterClose(k);
  };
  const later = () => {
    laterComponent();
    restoreIfClosed();
  };

  useKeys((a) => {
    if (!componentPrompt.value || busy) return busy ? true : false;
    if (a === 'back') {
      dismissComponent();
      restoreIfClosed();
      return true;
    }
    return 'spatial';
  }, 68);

  if (!offer) return null;
  const installable = !!(offer.apk && platformKind() === 'androidtv');
  const title = offer.kind === 'player' ? t('componentUpdate.titlePlayer') : t('componentUpdate.titleTorr');
  const line = installable
    ? t(offer.kind === 'player' ? 'componentUpdate.playerInstall' : 'componentUpdate.torrInstall', {
        installed: offer.installed,
        latest: offer.latest,
      })
    : t('componentUpdate.body', { installed: offer.installed, latest: offer.latest });

  const update = () => {
    if (busy) return;
    if (installable && offer.apk) {
      setError('');
      setBusy(true);
      installApk(offer.apk.url, offer.apk.sha256, (p) => setPct(p)).then(
        () => {
          setBusy(false);
          dismissComponent();
          restoreIfClosed();
        },
        (e) => {
          setBusy(false);
          const msg = e && typeof (e as Error).message === 'string' ? (e as Error).message : '';
          setError(msg || t('componentUpdate.failed'));
        },
      );
      return;
    }
    setSawQr(true);
  };

  return (
    <div class="dialog-backdrop">
      <FocusGroup key={key || 'component'} focusKey="COMPONENT-UPDATE" className="dialog update-dialog" boundary autoFocus>
        <div class="dialog-title">{title}</div>
        <div>{line}</div>
        {!installable && <div class="muted">{t('componentUpdate.qrNote')}</div>}
        {!installable && (
          <div class="row">
            <Qr text={offer.releaseUrl} size={220} />
          </div>
        )}
        {busy && pct !== null && <div>{t('componentUpdate.downloading', { pct })}</div>}
        {error && <div>{error}</div>}
        {sawQr && <div>{t('componentUpdate.seenQr')}</div>}
        <div class="row update-actions">
          <Button focusKey="cmp-upd" label={t('componentUpdate.update')} className="primary" disabled={busy} onPress={update} />
          <Button focusKey="cmp-later" label={t('common.later')} disabled={busy} onPress={later} />
        </div>
      </FocusGroup>
    </div>
  );
}
