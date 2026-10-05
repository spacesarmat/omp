import { useEffect, useState } from 'preact/hooks';
import { t } from '../../../src/i18n';
import { Icon } from '../ui/Icon';
import { resetTo, afterConnectRoute } from '../nav';
import { errorMessage } from '../../../src/api/http';
import {
  localServer,
  setupLocal,
  SETUP_STEPS,
  LOCAL_PORT,
  needsDownload,
  downloadSize,
  isDownloadCancelled,
  cancelLocalDownload,
  getLocalServerInfo,
} from '../server/localServer';
import { TORRSERVER_VERSION } from '../server/torrserverVersion';
import type { LocalDownloadProgress, LocalServerInfo } from '../platform/native';

const CHECK = 'M5 12.5l4.5 4.5L19 7';
const SPIN = 'M12 3a9 9 0 1 0 9 9';
const DOT = 'M12 12h.01';

export function LocalServer() {
  const [step, setStep] = useState(0);
  const [version, setVersion] = useState(TORRSERVER_VERSION);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  // the binary has to be downloaded and the user has not agreed yet
  const [offer, setOffer] = useState<LocalServerInfo | null>(null);
  const [checking, setChecking] = useState(true);
  // the user tapped «Скачать» (or «Запустить текущую версию» for an outdated binary)
  const [approved, setApproved] = useState<'download' | 'skip' | null>(null);
  const [progress, setProgress] = useState<LocalDownloadProgress | null>(null);
  // on mobile data the download is confirmed first
  const [askMobile, setAskMobile] = useState(false);

  useEffect(() => {
    let alive = true;
    setStep(0);
    setError('');
    setProgress(null);
    setChecking(true);
    let current = 0;
    void (async () => {
      const info = await getLocalServerInfo();
      if (!alive) return;
      setChecking(false);
      // a download already running (the screen was left and opened again): show it, it is joined below
      if (info.downloading) setProgress({ phase: 'download', percent: info.downloadPercent ?? 0 });
      else if (needsDownload(info) && approved === null) {
        setOffer(info);
        return;
      }
      setOffer(null);
      setAskMobile(false);
      await setupLocal(
        (i, v) => {
          if (!alive) return;
          current = i;
          setStep(i);
          setVersion(v);
          if (i > 0) setProgress(null);
        },
        (p) => alive && setProgress(p),
        approved !== 'skip',
        () => alive,
      );
    })().catch((e) => {
      if (!alive) return;
      setChecking(false);
      setProgress(null);
      if (isDownloadCancelled(e)) {
        // back to the offer
        setApproved(null);
        return;
      }
      setStep(current);
      setError(errorMessage(e));
    });
    return () => {
      alive = false;
    };
  }, [attempt, approved]);

  if (offer) {
    const update = offer.binary === 'outdated';
    const size = downloadSize(offer);
    const pinned = offer.pinVersion || TORRSERVER_VERSION;
    const startDownload = () => {
      if (offer.mobileData && !askMobile) setAskMobile(true);
      else setApproved('download');
    };
    if (askMobile) {
      return (
        <div class="m-screen" data-route="localServer">
          <h1 class="m-title">{t('localServer.title')}</h1>
          <div class="m-local-card" data-local="mobile">
            <div class="m-local-title">{t('localServer.mobileAsk', { what: size ? size.replace('~', '') : 'TorrServer' })}</div>
            <div class="m-local-text">{t('localServer.mobileText')}</div>
            <button type="button" class="m-btn m-btn-primary" onClick={startDownload}>
              {t('localServer.download')}
            </button>
            <button type="button" class="m-btn m-btn-secondary" onClick={() => setAskMobile(false)}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      );
    }
    return (
      <div class="m-screen" data-route="localServer">
        <h1 class="m-title">{t('localServer.title')}</h1>
        <div class="m-local-card" data-local="offer">
          <div class="m-local-text">
            {update ? t('localServer.updateText', { version: pinned }) : t('localServer.offerText', { version: pinned })}
          </div>
          <button type="button" class="m-btn m-btn-primary" onClick={startDownload}>
            {update
              ? size
                ? t('localServer.updateServerSize', { size })
                : t('localServer.updateServer')
              : size
                ? t('library.downloadServerSize', { size })
                : t('library.downloadServer')}
          </button>
          {update && (
            <button type="button" class="m-btn m-btn-secondary" onClick={() => setApproved('skip')}>
              {t('localServer.runCurrent')}
            </button>
          )}
        </div>
      </div>
    );
  }

  const downloading = progress !== null && step === 0 && !error;
  const first =
    progress === null
      ? t('localServer.preparing', { version })
      : progress.phase === 'verify'
        ? t('localServer.verifying', { version })
        : t('localServer.downloading', { version, pct: progress.percent ?? 0 });
  const labels = [first, t('localServer.stepRun'), t('localServer.stepCheck'), t('localServer.stepConnect')];
  const done = step >= SETUP_STEPS;
  const ip = localServer.value.ip;
  return (
    <div class="m-screen" data-route="localServer">
      <h1 class="m-title">{t('localServer.title')}</h1>
      <div class="m-steps">
        {labels.map((label, i) => {
          const state = checking ? 'wait' : i < step ? 'ok' : i === step ? (error ? 'fail' : 'run') : 'wait';
          return (
            <div key={i} class={'m-step ' + state} data-state={state}>
              <span class="m-step-dot">
                <Icon d={state === 'ok' ? CHECK : state === 'run' ? SPIN : DOT} size={16} />
              </span>
              <span class="m-step-label">{label}</span>
            </div>
          );
        })}
      </div>
      {downloading && (
        <>
          <span
            class="m-bar-track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress!.phase === 'verify' ? 100 : (progress!.percent ?? 0)}
          >
            <span class="m-bar-fill" style={{ width: (progress!.phase === 'verify' ? 100 : (progress!.percent ?? 0)) + '%' }} />
          </span>
          {progress!.phase === 'download' && (
            <button type="button" class="m-btn m-btn-secondary" onClick={() => void cancelLocalDownload()}>
              {t('common.cancel')}
            </button>
          )}
        </>
      )}
      {error && (
        <>
          <div class="m-error" role="alert">
            {error}
          </div>
          <button type="button" class="m-btn m-btn-secondary" onClick={() => setAttempt(attempt + 1)}>
            {t('common.retry')}
          </button>
        </>
      )}
      {done && (
        <>
          <div class="m-addr-card">
            <div class="m-muted m-small">{t('localServer.addrForTv')}</div>
            {ip ? (
              <div class="m-addr">
                {ip}:{LOCAL_PORT}
              </div>
            ) : (
              <div class="m-error">{t('localServer.noWifi')}</div>
            )}
            {localServer.value.vpn && <div class="m-hint-warn" role="alert">{t('localServer.vpn')}</div>}
            <div class="m-muted m-note">{t('localServer.tvHint')}</div>
          </div>
          <button type="button" class="m-btn m-btn-primary" onClick={() => resetTo(afterConnectRoute())}>
            {t('localServer.openCatalog')}
          </button>
        </>
      )}
    </div>
  );
}
