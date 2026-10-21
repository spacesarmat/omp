// Sheet when the OMP pin for TorrServer is newer than the binary on disk.
import { useRef, useState } from 'preact/hooks';
import { Sheet } from './Sheet';
import {
  cancelLocalDownload,
  dismissLocalUpdate,
  downloadLine,
  downloadSize,
  installLocalUpdate,
  isDownloadCancelled,
  skipLocalPin,
} from '../server/localServer';
import { TORRSERVER_VERSION } from '../server/torrserverVersion';
import type { LocalDownloadProgress, LocalServerInfo } from '../platform/native';
import { errorMessage } from '../../../src/api/http';
import { t } from '../../../src/i18n';

export function LocalUpdateSheet({ info }: { info: LocalServerInfo }) {
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState<number | null>(null);
  const [verify, setVerify] = useState(false);
  const [error, setError] = useState('');
  const [askMobile, setAskMobile] = useState(false);
  const running = useRef(false);
  const busyRef = useRef(false);
  busyRef.current = busy;
  const pin = info.pinVersion || TORRSERVER_VERSION;
  const size = downloadSize(info);
  const total = info.downloadBytes ?? 0;

  async function install() {
    if (running.current) return;
    if (info.mobileData && !askMobile) {
      setAskMobile(true);
      return;
    }
    setAskMobile(false);
    running.current = true;
    setError('');
    setPct(null);
    setVerify(false);
    setBusy(true);
    try {
      await installLocalUpdate((p: LocalDownloadProgress) => {
        if (p.phase === 'verify') {
          setVerify(true);
          setPct(100);
        } else if (typeof p.percent === 'number') {
          setVerify(false);
          setPct(Math.max(0, Math.min(100, Math.round(p.percent))));
        }
      });
    } catch (e) {
      if (isDownloadCancelled(e)) {
        setBusy(false);
        running.current = false;
        return;
      }
      setError(errorMessage(e));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  const locked = busy;
  return (
    <Sheet
      testId="PD27"
      label={t('settings.localNewVersion')}
      onClose={() => !locked && dismissLocalUpdate()}
      onBack={() => !busyRef.current && dismissLocalUpdate()}
    >
      <div class="m-sheet-title">{t('settings.localNewVersion')}</div>
      <div class="m-muted m-small">
        {pin}
        {size ? ' · ' + size : ''}
      </div>
      <div class="m-local-text">{t('localServer.updateText', { version: pin })}</div>
      {askMobile ? (
        <div class="m-field" role="alertdialog" aria-label={t('localServer.mobileAsk', { what: size ? size.replace('~', '') : 'TorrServer' })}>
          <div class="m-hint-warn">{t('localServer.mobileText')}</div>
          <button type="button" class="m-btn m-btn-primary" onClick={() => void install()}>
            {t('localServer.download')}
          </button>
          <button type="button" class="m-btn m-btn-secondary" onClick={() => setAskMobile(false)}>
            {t('common.cancel')}
          </button>
        </div>
      ) : (
        <>
          {busy && (
            <div class="m-field">
              <div>
                {verify
                  ? t('localServer.verifying', { version: pin })
                  : pct !== null
                    ? t('localServer.downloading', { version: pin })
                    : t('localServer.preparing', { version: pin })}
              </div>
              <span class="m-bar-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? 0}>
                <span class="m-bar-fill" style={{ width: (pct ?? 0) + '%' }} />
              </span>
              {!verify && pct !== null && <div class="m-muted m-small">{downloadLine(pct, total || undefined)}</div>}
            </div>
          )}
          {error && (
            <div class="m-error" role="alert">
              {error}
            </div>
          )}
          {busy && !verify ? (
            <button type="button" class="m-btn m-btn-secondary" onClick={() => void cancelLocalDownload()}>
              {t('common.cancel')}
            </button>
          ) : (
            <button type="button" class="m-btn m-btn-primary" disabled={locked} onClick={() => void install()}>
              {size ? t('localServer.updateServerSize', { size }) : t('localServer.updateServer')}
            </button>
          )}
          <div class="m-sheet-row">
            <button type="button" class="m-btn m-btn-secondary" disabled={locked} onClick={dismissLocalUpdate}>
              {t('common.later')}
            </button>
            <button type="button" class="m-btn m-btn-secondary" disabled={locked} onClick={() => skipLocalPin(pin)}>
              {t('update.skip')}
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}
