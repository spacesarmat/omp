import { useEffect, useState } from 'preact/hooks';
import { navigate, goBack } from '../nav';
import { Icon } from '../ui/Icon';
import {
  localServer,
  localAutostart,
  setAutostart,
  startLocal,
  stopLocal,
  refreshLocalServer,
  localCacheBytes,
  clearLocalCache,
  LOCAL_PORT,
  localName,
  LOCAL_URL,
  canRun,
  needsDownload,
  downloadSize,
} from '../server/localServer';
import { TORRSERVER_VERSION } from '../server/torrserverVersion';
import { showToast } from '../ui/toast';
import { activeServer, addServer, servers } from '../../../src/store/servers';
import { settings, updateSettings } from '../../../src/store/settings';
import { fmtSize, t } from '../../../src/i18n';

const PROJECT_URL = 'https://github.com/spacesarmat/omp';
const TORRSERVER_SOURCE_URL = 'https://github.com/YouROK/TorrServer/tree/' + TORRSERVER_VERSION;
const BACK = 'M15 5l-7 7 7 7';
const CHEVRON = 'M9 6l6 6-6 6';

function Switch(p: { on: boolean; label: string; disabled?: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={p.on}
      aria-label={p.label}
      class={'m-switch' + (p.on ? ' on' : '')}
      disabled={p.disabled}
      onClick={p.onToggle}
    >
      <span class="m-switch-knob" />
    </button>
  );
}

/** TorrServer that runs on this phone: on/off, autostart, playback files, version, network warnings. */
function LocalServerSection() {
  const st = localServer.value;
  const [bytes, setBytes] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    void refreshLocalServer();
  }, []);
  useEffect(() => {
    let alive = true;
    void localCacheBytes().then((b) => alive && setBytes(b));
    return () => {
      alive = false;
    };
  }, [st.running]);

  async function toggle() {
    if (busy) return;
    // no binary yet: the setup screen offers the download
    if (!st.running && !canRun(st)) {
      navigate({ name: 'localServer' });
      return;
    }
    setBusy(true);
    try {
      if (st.running) await stopLocal();
      else {
        setStarting(true);
        await startLocal();
        // started here, not through the setup screen: make it a saved server too (not the active one)
        if (localServer.value.running && !servers.value.some((s) => s.url === LOCAL_URL)) {
          addServer({ name: localName(), url: LOCAL_URL });
        }
      }
    } finally {
      setStarting(false);
      setBusy(false);
    }
  }

  async function clear() {
    if (busy) return;
    setBusy(true);
    try {
      await clearLocalCache();
      setBytes(await localCacheBytes());
    } catch {
      showToast(t('settings.clearFailed'));
    } finally {
      setBusy(false);
    }
  }

  const missing = !st.running && !canRun(st);
  const size = downloadSize(st);
  const meta = missing
    ? size
      ? t('settings.localMissingSize', { size: size })
      : t('settings.localMissing')
    : [st.version, st.ip ? st.ip + ':' + LOCAL_PORT : ''].filter(Boolean).join(' · ');
  return (
    <section class="m-set-group" data-section="local-server">
      <div class="m-set-label">{t('settings.phoneServer')}</div>
      <div class="m-set-card">
        <div class="m-set-row">
          <span class={'m-status-dot' + (st.running ? ' on' : '')} />
          <div class="m-set-text" style="flex-grow: 1">
            <span style="font-weight: 700">{starting ? t('settings.localStarting') : st.running ? t('sources.flare.works') : missing ? t('settings.localNotDownloaded') : t('settings.localStopped')}</span>
            {meta && <span class="m-muted m-small">{meta}</span>}
          </div>
          <Switch on={st.running} label={t('localServer.title')} disabled={starting} onToggle={() => void toggle()} />
        </div>
        {st.error && (
          <div class="m-error" role="alert">
            {st.error}
          </div>
        )}
        {needsDownload(st) && st.binary === 'outdated' && (
          <>
            <div class="m-set-sep" />
            <div class="m-set-row" data-local="update">
              <div class="m-set-text" style="flex-grow: 1">
                <span>{t('settings.localNewVersion')}</span>
                <span class="m-muted m-small">{[st.pinVersion, size].filter(Boolean).join(' · ')}</span>
              </div>
              <button type="button" class="m-btn m-btn-secondary m-btn-sm" onClick={() => navigate({ name: 'localServer' })}>
                {t('settings.localUpdate')}
              </button>
            </div>
          </>
        )}
        <div class="m-set-sep" />
        <div class="m-set-row">
          <div class="m-set-text" style="flex-grow: 1">
            <span>{t('settings.autostart')}</span>
            <span class="m-muted m-small">{t('settings.autostartSub')}</span>
          </div>
          <Switch on={localAutostart.value} label={t('settings.autostart')} onToggle={() => setAutostart(!localAutostart.value)} />
        </div>
        <div class="m-set-sep" />
        <div class="m-set-row">
          <div class="m-set-text" style="flex-grow: 1">
            <span>{t('settings.cacheTitle')}</span>
            <span class="m-muted m-small">{t('settings.cacheHint')}</span>
            <span class="m-muted m-small">{bytes === null ? t('settings.counting') : t('settings.cacheUsed', { used: fmtSize(bytes) })}</span>
          </div>
          <button type="button" class="m-btn m-btn-secondary m-btn-sm" disabled={busy} onClick={() => void clear()}>
            {t('tvSettings.clear')}
          </button>
        </div>
      </div>
      <div class="m-hint-ok">
        <Icon d="M12 8v.01M11 12h1v5h1M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18" size={18} />
        <span>{t('settings.serverNote')}</span>
      </div>
      <p class="m-muted m-small" data-row="lan-warn">{t('settings.lanWarn')}</p>
      {st.vpn && <div class="m-hint-warn" role="alert">{t('localServer.vpn')}</div>}
    </section>
  );
}

/** One entry for the server that is playing (the phone server, when it is the only one running). */
function ServerSettingsRow() {
  const server = activeServer.value;
  const localOn = localServer.value.running;
  if (!server && !localOn) return null;
  return (
    <section class="m-set-group" data-section="server-settings">
      <button
        type="button"
        class="m-set-row m-set-pick"
        data-row="server-settings"
        onClick={() => navigate(server ? { name: 'serverSettings' } : { name: 'serverSettings', url: LOCAL_URL })}
      >
        <div class="m-set-text" style="flex-grow: 1">
          <span>{t('serverSettings.title')}</span>
          {server && <span class="m-muted m-small">{server.name}</span>}
        </div>
        <Icon d={CHEVRON} size={18} />
      </button>
    </section>
  );
}

/** Technical settings: the phone server, server options, betas, backup, log and credits. */
export function Advanced() {
  const on = settings.value.updateCheck;
  return (
    <div class="m-screen" data-route="advanced">
      <div class="m-bar">
        <button type="button" class="m-icon-btn" aria-label={t('common.back')} onClick={() => goBack()}>
          <Icon d={BACK} />
        </button>
        <h1 class="m-bar-title">{t('settings.advanced')}</h1>
      </div>

      {localServer.value.supported && <LocalServerSection />}
      <ServerSettingsRow />

      <section class="m-set-group" data-section="updates">
        <div class="m-set-row">
          <span>{t('tvSettings.updateOnStart')}</span>
          <Switch on={on} label={t('tvSettings.updateOnStart')} onToggle={() => updateSettings({ updateCheck: !on })} />
        </div>
        <div class="m-set-row" data-row="beta">
          <div class="m-set-text">
            <span>{t('settings.betaTitle')}</span>
            <span class="m-small m-muted">{t('settings.betaHint')}</span>
          </div>
          <Switch
            on={settings.value.betaUpdates}
            label={t('settings.betaTitle')}
            onToggle={() => updateSettings({ betaUpdates: !settings.value.betaUpdates })}
          />
        </div>
      </section>

      <section class="m-set-group">
        <button type="button" class="m-set-row m-set-pick" onClick={() => navigate({ name: 'backup' })}>
          <span>{t('backup.title')}</span>
          <Icon d={CHEVRON} size={20} />
        </button>
        <button type="button" class="m-set-row m-set-pick" onClick={() => navigate({ name: 'log' })}>
          <span>{t('log.screenTitle')}</span>
          <Icon d={CHEVRON} size={20} />
        </button>
        <button type="button" class="m-btn m-btn-secondary" onClick={() => window.open(PROJECT_URL, '_system')}>
          {t('settings.projectPage')}
        </button>
        <button type="button" class="m-link" onClick={() => window.open(TORRSERVER_SOURCE_URL, '_system')}>
          TorrServer © YouROK, GPL-3.0
        </button>
        <p class="m-muted m-small m-set-attr">{t('settings.tmdbData')}</p>
      </section>
    </div>
  );
}
