import { useEffect, useRef, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { latestUpdate, checkForUpdate, dismissPrompt } from '../store/updates';
import { HB_REPO_URL, HB_SITE_URL, RELEASES_URL, updateTitle } from '../lib/updateInfo';
import { isBetaVersion } from '../lib/version';
import { settings, updateSettings } from '../store/settings';
import { hbPresence, hbHasRoot, openHbChannel, hbInstall, InstallStatus, HbPresence } from '../platform/hbchannel';
import { APP_VERSION } from '../version';
import { CHANGELOG } from '../lib/changelogData';
import { openWhatsNew } from '../store/whatsNew';
import { FocusGroup, Button, ProgressBar } from '../ui/components';
import { Qr } from '../ui/Qr';
import { restoreFocus } from '../ui/focus';
import { toast } from '../ui/toast';
import { platformKind } from '../platform/env';
import { installApk } from '../platform/androidNative';
import { t } from '../i18n';
import type { UpdateInfo } from '../lib/updateInfo';

interface ApkJob {
  version: string;
  running: boolean;
  /** Progress of the running download; null until the first event. */
  pct: number | null;
  /** The system installer was opened. */
  done: boolean;
  error: string | null;
}

/** Survives leaving the screen: the native download keeps running. */
export const apkJob = signal<ApkJob | null>(null);

/** Android TV: one method — download the APK from update-android.json and open the system installer. */
function ApkInstall({ info }: { info: UpdateInfo }) {
  // a job for another version is stale unless it is still running
  const job = apkJob.value && (apkJob.value.running || apkJob.value.version === info.version) ? apkJob.value : null;
  const startedHere = useRef(false);
  const running = !!job && job.running;

  const patch = (version: string, p: Partial<ApkJob>) => {
    const cur = apkJob.value;
    if (cur && cur.version === version) apkJob.value = { ...cur, ...p };
  };

  const install = () => {
    if (apkJob.value && apkJob.value.running) return;
    const version = info.version;
    startedHere.current = true;
    apkJob.value = { version, running: true, pct: null, done: false, error: null };
    installApk(info.ipkUrl, info.ipkHash, (pct) => patch(version, { pct }), info.apks).then(
      () => patch(version, { running: false, done: true }),
      (e: Error) => patch(version, { running: false, error: e.message }),
    );
  };

  let statusText: string | null = null;
  if (running) {
    if (job!.pct !== null) statusText = t('update.hb.downloadingPct', { p: job!.pct! });
    else statusText = startedHere.current ? t('update.hb.downloading') : t('updateScreen.alreadyDownloading');
  } else if (job && job.done) {
    statusText = t('updateScreen.confirmInstall');
  }
  const label = job && job.error ? t('updateScreen.retry') : job && job.done ? t('updateScreen.installAgain') : t('updateScreen.downloadInstall');

  return (
    <section class="update-block">
      <h2>{t('updateScreen.installNow')}</h2>
      {statusText && <div class="update-status">{statusText}</div>}
      {running && job!.pct !== null && <ProgressBar ratio={job!.pct / 100} />}
      {job && job.error && <div class="banner-error">{job.error}</div>}
      <div class="row update-actions">
        <Button focusKey="upd-install" label={label} className="primary" onPress={install} disabled={running} />
      </div>
      <div class="muted">{t('updateScreen.keepData')}</div>
    </section>
  );
}

export function UpdateScreen() {
  const info = latestUpdate.value;
  const android = platformKind() === 'androidtv';
  const [root, setRoot] = useState(false);
  const [hb, setHb] = useState<HbPresence>('unknown');
  const [status, setStatus] = useState<InstallStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const cancel = useRef<(() => void) | null>(null);

  const stopInstall = () => {
    if (cancel.current) {
      const c = cancel.current;
      cancel.current = null;
      c();
    }
  };

  useEffect(() => {
    let dead = false;
    if (!android) {
      hbHasRoot().then((r) => { if (!dead) setRoot(r); });
      hbPresence().then((p) => { if (!dead) setHb(p); });
    }
    restoreFocus('UPDATE');
    return () => {
      dead = true;
      stopInstall();
    };
  }, []);

  const check = () => {
    if (checking) return;
    setChecking(true);
    checkForUpdate({ manual: true }).then((r) => {
      setChecking(false);
      dismissPrompt(); // already on the update screen
      if (r === 'error') toast(t('updateScreen.checkFailed'), 'error');
      else if (r === 'latest') toast(t('updateScreen.latest'));
    });
  };

  const install = () => {
    if (!info) return;
    stopInstall();
    setError(null);
    setStatus({ stage: 'download', text: t('update.hb.downloading') });
    cancel.current = hbInstall(
      info.ipkUrl,
      info.ipkHash,
      (s) => {
        setStatus(s);
        if (s.stage === 'done') stopInstall();
      },
      (e) => {
        stopInstall();
        setStatus(null);
        setError(t('updateScreen.installFailed', { error: e.message }));
      },
    );
  };

  const openHb = (withRepo: boolean) => {
    openHbChannel(withRepo ? HB_REPO_URL : undefined).catch(() => toast(t('updateScreen.openHbFailed'), 'error'));
  };

  const busy = !!status && status.stage !== 'done';

  return (
    <FocusGroup focusKey="UPDATE" className="screen update">
      <h1>{t('updateScreen.title')}</h1>
      {info && <div class="update-title">{updateTitle(info.version, APP_VERSION)}</div>}
      <div class="muted">
        {t('updateScreen.installed', { version: APP_VERSION })}
        {isBetaVersion(APP_VERSION) && <span class="badge-beta">{t('updateScreen.beta')}</span>}
      </div>
      {!info && (
        <div class="row update-actions">
          <Button focusKey="upd-check" label={checking ? t('updateScreen.checking') : t('updateScreen.check')} onPress={check} disabled={checking} />
        </div>
      )}
      <div class="row update-actions">
        <Button focusKey="upd-whatsnew" label={t('whatsNew.title')} onPress={() => openWhatsNew(CHANGELOG, APP_VERSION)} />
        <Button
          focusKey="upd-beta"
          label={t('updateScreen.betaToggle', { state: settings.value.betaUpdates ? t('updateScreen.betaOn') : t('updateScreen.betaOff') })}
          onPress={() => {
            updateSettings({ betaUpdates: !settings.value.betaUpdates });
            // the other feed decides what is offered now
            latestUpdate.value = null;
            check();
          }}
        />
      </div>
      <div class="muted">{t('updateScreen.betaNote')}</div>
      {info && info.notes.length > 0 && (
        <ul class="update-notes">{info.notes.slice(0, 8).map((n, i) => <li key={i}>{n}</li>)}</ul>
      )}

      {info && android && <ApkInstall info={info} />}

      {info && !android && root && (
        <section class="update-block">
          <h2>{t('updateScreen.installNow')}</h2>
          {status && <div class="update-status">{status.text}</div>}
          {status && status.stage === 'download' && status.progress !== undefined && <ProgressBar ratio={status.progress / 100} />}
          {error && <div class="banner-error">{error}</div>}
          <div class="row update-actions">
            <Button focusKey="upd-install" label={error ? t('updateScreen.retry') : t('updateScreen.install')} className="primary" onPress={install} disabled={busy} />
          </div>
        </section>
      )}

      {!android && (
        <section class="update-block">
          <h2>{t('updateScreen.viaHb')}</h2>
          {hb === 'missing' ? (
            <div class="update-row">
              <Qr text={HB_SITE_URL} size={200} />
              <div class="update-text">{t('updateScreen.hbMissing')}</div>
            </div>
          ) : (
            <div>
              {hb === 'unknown' && <div class="muted">{t('updateScreen.hbIfInstalled')}</div>}
              <div class="row update-actions">
                <Button focusKey="upd-hb-open" label={t('updateScreen.openHb')} onPress={() => openHb(false)} />
                <Button focusKey="upd-hb-repo" label={t('updateScreen.addRepo')} onPress={() => openHb(true)} />
              </div>
              <div class="muted">{t('updateScreen.hbHint')}</div>
            </div>
          )}
        </section>
      )}

      {!android && (
        <section class="update-block">
          <h2>{t('updateScreen.fromPc')}</h2>
          <div class="update-row">
            <Qr text={(info && info.releaseUrl) || RELEASES_URL} size={200} />
            <ol class="update-text">
              <li>{t('updateScreen.pc1')}</li>
              <li>{t('updateScreen.pc2')}</li>
              <li>{t('updateScreen.keepData')}</li>
            </ol>
          </div>
        </section>
      )}
    </FocusGroup>
  );
}
