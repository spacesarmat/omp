import { useRef, useState } from 'preact/hooks';
import { Sheet } from './Sheet';
import { native } from '../platform/native';
import { installLocalUpdate, isDownloadCancelled } from '../server/localServer';
import { dismissComponent, laterComponent } from '../../../src/store/componentUpdates';
import type { ComponentOffer } from '../../../src/lib/componentVersions';
import { errorMessage } from '../../../src/api/http';
import { t } from '../../../src/i18n';

export function ComponentUpdateSheet({ offer }: { offer: ComponentOffer }) {
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [askMobile, setAskMobile] = useState(false);
  const running = useRef(false);
  const title = offer.kind === 'player' ? t('componentUpdate.titlePlayer') : t('componentUpdate.titleTorr');
  const canInstall = !!(offer.apk || offer.installEmbedded);
  const line = offer.apk
    ? t('componentUpdate.playerInstall', { installed: offer.installed, latest: offer.latest })
    : offer.installEmbedded
      ? t('componentUpdate.torrInstall', { installed: offer.installed, latest: offer.latest })
      : t('componentUpdate.body', { installed: offer.installed, latest: offer.latest });

  async function update() {
    if (running.current) return;
    if (offer.installEmbedded && offer.mobileData && !askMobile) {
      setAskMobile(true);
      return;
    }
    setAskMobile(false);
    running.current = true;
    setError('');
    setPct(null);
    setBusy(true);
    try {
      if (offer.apk) {
        await native.downloadAndInstallApk(offer.apk.url, offer.apk.sha256, (p) => {
          if (typeof p === 'number' && isFinite(p)) setPct(Math.max(0, Math.min(100, Math.round(p))));
        });
      } else if (offer.installEmbedded) {
        await installLocalUpdate((p) => {
          if (typeof p.percent === 'number') setPct(Math.max(0, Math.min(100, Math.round(p.percent))));
        });
      } else {
        window.open(offer.releaseUrl, '_system');
      }
      dismissComponent();
    } catch (e) {
      if (!isDownloadCancelled(e)) setError(errorMessage(e));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  return (
    <Sheet label={title} onClose={() => !busy && dismissComponent()} onBack={() => !busy && dismissComponent()}>
      <div class="m-sheet-title">{title}</div>
      <div>{line}</div>
      {!canInstall && <div class="m-muted">{t('componentUpdate.linkNote')}</div>}
      {askMobile && (
        <div class="m-hint-warn">{t('localServer.mobileText')}</div>
      )}
      {busy && pct !== null && <div>{t('componentUpdate.downloading', { pct })}</div>}
      {error && (
        <div class="m-error" role="alert">
          {error}
        </div>
      )}
      <button type="button" class="m-btn m-btn-primary" disabled={busy} onClick={() => void update()}>
        {askMobile ? t('localServer.download') : t('componentUpdate.update')}
      </button>
      <button type="button" class="m-btn m-btn-secondary" disabled={busy} onClick={() => laterComponent()}>
        {t('common.later')}
      </button>
    </Sheet>
  );
}
