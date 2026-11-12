import { useEffect, useState } from 'preact/hooks';
import QRCode from 'qrcode';
import { t } from '../../../src/i18n';
import { Icon } from '../ui/Icon';
import { showToast } from '../ui/toast';
import { resetTo, afterConnectRoute, goBack } from '../nav';
import { FaqDone } from '../ui/faqJump';
import { errorMessage } from '../../../src/api/http';
import {
  localServer,
  setupLocal,
  SETUP_STEPS,
  LOCAL_PORT,
  needsDownload,
  downloadSize,
  downloadLine,
  isDownloadCancelled,
  cancelLocalDownload,
  getLocalServerInfo,
} from '../server/localServer';
import { TORRSERVER_VERSION } from '../server/torrserverVersion';
import type { LocalDownloadProgress, LocalServerInfo } from '../platform/native';

let addrCopy: ((text: string) => Promise<void>) | null = null;

/** Tests replace copying the server address. Null restores the browser clipboard. */
export function setAddrCopy(fn: ((text: string) => Promise<void>) | null): void {
  addrCopy = fn;
}

function clock(d = new Date()): string {
  const p = (n: number) => (n < 10 ? '0' : '') + n;
  return p(d.getHours()) + ':' + p(d.getMinutes());
}

const CHECK = 'M5 12.5l4.5 4.5L19 7';
const SPIN = 'M12 3a9 9 0 1 0 9 9';
const FAIL = 'M12 7v6M12 17h.01';
const BACK = 'M15 5l-7 7 7 7';

/** The subpage header: «Назад» and the screen title (the look of the other settings subpages). */
function Header() {
  return (
    <div class="m-bar">
      <button type="button" class="m-icon-btn tm" data-code="P16.1" aria-label={t('common.back')} onClick={() => goBack()}>
        <Icon d={BACK} />
      </button>
      <h1 class="m-bar-title">{t('localServer.title')}</h1>
    </div>
  );
}

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
  // size of the download in bytes (for «12 из 31 МБ»); 0 when unknown
  const [total, setTotal] = useState(0);
  const [qr, setQr] = useState('');
  const [since, setSince] = useState('');

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
      setTotal(info.downloadBytes ?? 0);
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

  const ipLive = localServer.value.ip;
  const addrLive = ipLive ? ipLive + ':' + LOCAL_PORT : '';
  const addrReady = !offer && !checking && !error && step >= SETUP_STEPS && !!addrLive;
  useEffect(() => {
    if (!addrReady) {
      setQr('');
      return;
    }
    setSince((prev) => prev || clock());
    let alive = true;
    void QRCode.toDataURL('http://' + addrLive, { margin: 1, width: 160 }).then(
      (url) => alive && setQr(url),
      () => alive && setQr(''),
    );
    return () => {
      alive = false;
    };
  }, [addrReady, addrLive]);

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
        <FaqDone mark="server" />
          <Header />
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
        <FaqDone mark="server" />
        <Header />
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
  const verify = progress?.phase === 'verify';
  const pct = verify ? 100 : (progress?.percent ?? 0);
  const first =
    progress === null
      ? t('localServer.preparing', { version })
      : verify
        ? t('localServer.verifying', { version })
        : t('localServer.downloading', { version });
  const labels = [first, t('localServer.stepRun'), t('localServer.stepCheck'), t('localServer.stepConnect')];
  const done = step >= SETUP_STEPS;
  // the step the error belongs to (an error after the last step stays on the last one)
  const failAt = error ? Math.min(step, labels.length - 1) : -1;
  const ip = ipLive;
  const addr = addrLive;

  async function copyAddr() {
    if (!addr) return;
    try {
      if (addrCopy) await addrCopy(addr);
      else if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(addr);
      showToast(t('donate.copied'));
    } catch {
      showToast(t('settings.clearFailed'));
    }
  }

  return (
    <div class="m-screen" data-route="localServer">
      <FaqDone mark="server" />
      <Header />
      <div class="m-steps">
        {labels.map((label, i) => {
          const state = checking ? 'wait' : i === failAt ? 'fail' : i < step ? 'ok' : i === step && !error ? 'run' : 'wait';
          return (
            <div key={i} class={'m-step ' + state} data-state={state}>
              <span class="m-step-dot">
                {state === 'wait' ? (
                  <span class="m-step-num">{i + 1}</span>
                ) : (
                  <Icon d={state === 'ok' ? CHECK : state === 'run' ? SPIN : FAIL} size={16} spin={state === 'run'} />
                )}
              </span>
              <div class="m-step-body">
                <span class="m-step-label">{label}</span>
                {i === 0 && downloading && (
                  <>
                    <span class="m-bar-track m-step-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
                      <span class="m-bar-fill" style={{ width: pct + '%' }} />
                    </span>
                    {!verify && <span class="m-step-sub">{downloadLine(pct, total)}</span>}
                  </>
                )}
                {state === 'fail' && (
                  <div class="m-error m-step-error" role="alert">
                    {error}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {done && (
        <div class="m-addr-card">
          <div class="m-muted m-small">{t('localServer.addrForTv')}</div>
          {addr ? (
            <div class="m-addr-row">
              <div class="m-addr">{addr}</div>
              <button type="button" class="m-icon-btn" data-copy-addr aria-label={t('localServer.copyAddr')} onClick={() => void copyAddr()}>
                <Icon d="M8 8h11v11H8zM5 16V5h11" size={18} />
              </button>
              {qr ? <img class="m-addr-qr" data-qr alt={t('localServer.qrAddr')} src={qr} /> : null}
            </div>
          ) : (
            <div class="m-error">{t('localServer.noWifi')}</div>
          )}
          {since && addr ? <div class="m-muted m-small" data-local-since>{t('localServer.sinceLine', { time: since, net: addr })}</div> : null}
          {localServer.value.vpn && <div class="m-hint-warn" role="alert">{t('localServer.vpn')}</div>}
          <div class="m-muted m-note m-addr-hint">{t('localServer.tvHint')}</div>
        </div>
      )}
      {((downloading && !verify) || error || done) && (
        <div class="m-local-actions">
          {downloading && !verify && (
            <button type="button" class="m-btn m-btn-secondary" onClick={() => void cancelLocalDownload()}>
              {t('common.cancel')}
            </button>
          )}
          {error && (
            <button type="button" class="m-btn m-btn-secondary" onClick={() => setAttempt(attempt + 1)}>
              {t('common.retry')}
            </button>
          )}
          {done && (
            <button type="button" class="m-btn m-btn-primary" onClick={() => resetTo(afterConnectRoute())}>
              {t('localServer.openCatalog')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
