import { useEffect, useState } from 'preact/hooks';
import { navigate } from '../nav';
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
import { activeTv } from '../tv/tvStore';
import { tvState } from '../tv/tvClient';
import { tvSearchOn, setTvSearch } from '../tv/phoneRpc';
import { tvOmpVersions, tvNeedsUpdate, tvOpensUpdate, openUpdateOnTv, type TvOmp } from '../tv/tvUpdate';
import { errorMessage } from '../../../src/api/http';
import { settings, updateSettings } from '../../../src/store/settings';
import { checkForUpdate, latestUpdate, updatePrompt, type CheckResult } from '../../../src/store/updates';
import { updateFeedUrl, updateTitle } from '../../../src/lib/updateInfo';
import { isBetaVersion } from '../../../src/lib/version';
import { APP_VERSION } from '../../../src/version';
import { phoneChangelog } from '../lib/phoneChangelog';
import { openWhatsNew } from '../../../src/store/whatsNew';
import { loadMonitorSettings } from '../../../src/monitor/settings';
import { hoursText } from '../monitor/text';
import { activeMethods, openDonate } from '../donate';
import { Sheet } from '../ui/Sheet';
import { native } from '../platform/native';
import { P2160_RELEASES_URL } from '../../../src/player/player2160';
import { fmtSize, t, type LanguageSetting } from '../../../src/i18n';
import { LANGUAGE_NAMES } from '../../../src/i18n/languageNames';
import { ScreenHeader } from '../ui/ScreenHeader';

type Checker = (o: { manual: boolean; url?: string; minIntervalMs?: number }) => Promise<CheckResult>;
let checker: Checker | null = null;

/** Replaces the update check (tests); null restores the real one. */
export function setUpdateChecker(fn: Checker | null): void {
  checker = fn;
}

export function runUpdateCheck(o: { manual: boolean; url?: string; minIntervalMs?: number }): Promise<CheckResult> {
  return (checker ?? checkForUpdate)(o);
}

/** The phone's APK feed: the beta one with «Получать бета-версии». */
export function phoneFeedUrl(): string {
  return updateFeedUrl(true, settings.value.betaUpdates);
}

/** Under «Get beta versions». */
export const betaHint = (): string => t('settings.betaHint');
/** The badge next to a beta version. */
export const betaBadge = (): string => t('updateScreen.beta');

const PROJECT_URL = 'https://github.com/spacesarmat/omp';
const TORRSERVER_SOURCE_URL = 'https://github.com/YouROK/TorrServer/tree/' + TORRSERVER_VERSION;

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
      <div class="m-set-label">{t('localServer.title')}</div>
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
            <span class="m-muted m-small">{bytes === null ? t('settings.counting') : t('settings.cacheUsed', { used: fmtSize(bytes) })}</span>
          </div>
          <button type="button" class="m-btn m-btn-secondary m-btn-sm" disabled={busy} onClick={() => void clear()}>
            {t('tvSettings.clear')}
          </button>
        </div>
        {st.running && (
          <>
            <div class="m-set-sep" />
            <button type="button" class="m-set-row m-set-pick" onClick={() => navigate({ name: 'serverSettings', url: LOCAL_URL })}>
              <span>{t('serverSettings.title')}</span>
              <Icon d="M9 6l6 6-6 6" size={18} />
            </button>
          </>
        )}
      </div>
      <div class="m-hint-ok">
        <Icon d="M12 8v.01M11 12h1v5h1M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18" size={18} />
        <span>{t('settings.serverNote')}</span>
      </div>
      <div class="m-hint-warn">{t('settings.lanWarn')}</div>
      {st.vpn && <div class="m-hint-warn" role="alert">{t('localServer.vpn')}</div>}
    </section>
  );
}

const CHECK = 'M5 12l5 5l9-10';
const LANGUAGES: LanguageSetting[] = ['system', 'ru', 'en'];

/** «Как в системе» / «Русский» / «English» in the current language. */
function languageName(v: LanguageSetting): string {
  return v === 'ru' || v === 'en' ? LANGUAGE_NAMES[v] : t('settings.language.system');
}

/** «Язык»: the row shows the setting, a sheet offers the three choices; a choice applies at once. */
function LanguageRow() {
  const [open, setOpen] = useState(false);
  const cur = settings.value.language;
  const title = t('settings.language.title');
  return (
    <>
      <button type="button" class="m-set-row m-set-pick" data-row="language" onClick={() => setOpen(true)}>
        <span>{title}</span>
        <span class="m-muted">{languageName(cur)} ›</span>
      </button>
      {open && (
        <Sheet label={title} onClose={() => setOpen(false)}>
          <div class="m-sheet-title">{title}</div>
          <div class="m-sub-pick" role="radiogroup" aria-label={title}>
            {LANGUAGES.map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={cur === v}
                class="m-opt"
                onClick={() => {
                  updateSettings({ language: v });
                  setOpen(false);
                }}
              >
                <span class="m-opt-name m-grow">{languageName(v)}</span>
                {cur === v && <Icon d={CHECK} size={20} />}
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </>
  );
}

/** «Плеер для видео»: the built-in one or 2160 Player (needs the app installed on this phone). */
function VideoPlayerRow() {
  const cur = settings.value.videoPlayer;
  const [pkg, setPkg] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    native.player2160().then(
      (p) => alive && setPkg(p),
      () => alive && setPkg(null),
    );
    return () => {
      alive = false;
    };
  }, []);
  const missing = pkg === null;
  return (
    <section class="m-set-group" data-row="video-player">
      <div class="m-set-row">
        <span>{t('player.videoPlayer')}</span>
      </div>
      <div class="m-seg" role="group" aria-label={t('player.videoPlayer')}>
        <button type="button" class={cur === 'builtin' ? 'on' : ''} aria-pressed={cur === 'builtin'} onClick={() => updateSettings({ videoPlayer: 'builtin' })}>
          {t('player.builtinPlayerPhone')}
        </button>
        <button
          type="button"
          class={cur === 'p2160' ? 'on' : ''}
          aria-pressed={cur === 'p2160'}
          disabled={missing}
          onClick={() => updateSettings({ videoPlayer: 'p2160' })}
        >
          {t('player.p2160')}
        </button>
      </div>
      {missing && (
        <button type="button" class="m-link" data-row="p2160-missing" onClick={() => window.open(P2160_RELEASES_URL, '_system')}>
          {t('player.p2160Missing')}
        </button>
      )}
      <p class="m-muted m-small">{t('player.p2160NotePhone')}</p>
    </section>
  );
}

/** The TV search switch: the TV searches torrent sites through this phone (PhoneRpcService). */
function TvSearchRow() {
  const on = tvSearchOn.value;
  return (
    <div class="m-set-row" data-row="tv-search-service">
      <div class="m-set-text" style="flex-grow: 1">
        <span>{t('settings.tvSearch')}</span>
        <span class="m-muted m-small">{on ? t('settings.tvSearchHint') : t('settings.tvSearchOff')}</span>
      </div>
      <Switch on={on} label={t('settings.tvSearch')} onToggle={() => void setTvSearch(!on)} />
    </div>
  );
}

/** OMP version on the connected TV; an old one gets «Обновить на ТВ». */
function TvOmpRow() {
  const connected = tvState.value === 'connected';
  const ip = activeTv.value ? activeTv.value.ip : '';
  const [v, setV] = useState<TvOmp | null>(null);
  const [hint, setHint] = useState(false);
  useEffect(() => {
    setV(null);
    setHint(false);
    if (!connected) return;
    let alive = true;
    tvOmpVersions().then((r) => alive && setV(r));
    return () => {
      alive = false;
    };
  }, [connected, ip]);
  if (!connected || !v || !v.installed) return null;
  const installed = v.installed;
  const old = tvNeedsUpdate(v);
  const update = () => {
    const opens = tvOpensUpdate(installed);
    // older TV builds only open OMP: the update is started there by hand
    if (!opens) setHint(true);
    openUpdateOnTv().then(
      () => showToast(opens ? t('install.assistant.updateOpened') : t('install.assistant.ompOpened')),
      (e) => showToast(errorMessage(e)),
    );
  };
  return (
    <>
      <div class="m-set-row" data-row="tv-omp">
        <div class="m-set-text">
          <span>{t('settings.tvOmp')}</span>
          <span class={'m-small' + (old ? ' m-accent' : ' m-muted')}>
            {old ? t('settings.tvOmpNewer', { installed: installed, latest: v.latest || '' }) : v.latest ? t('settings.tvOmpLatest', { installed: installed }) : installed}
          </span>
        </div>
        {old && (
          <button type="button" class="m-btn m-btn-primary m-btn-sm" onClick={update}>
            {t('install.plan.updateOnTv')}
          </button>
        )}
      </div>
      {hint && (
        <div class="m-hint-warn" role="status">
          {t('install.assistant.noSelfUpdate')}
        </div>
      )}
    </>
  );
}

export function Settings() {
  const server = activeServer.value;
  const tv = activeTv.value;
  const on = settings.value.updateCheck;
  const monitor = loadMonitorSettings();

  async function check() {
    const r = await runUpdateCheck({ manual: true, url: phoneFeedUrl() }).catch((): CheckResult => 'error');
    if (r === 'error') showToast(t('updateScreen.checkFailed'));
    else if (r === 'latest') showToast(t('updateScreen.latest'));
  }

  return (
    <div class="m-screen" data-route="settings">
      <ScreenHeader title={t('common.settings')} />
      {/* updates first: the version and the check are what people look for most here */}
      <section class="m-set-group">
        <div class="m-set-label">{t('update.sheetLabel')}</div>
        <button type="button" class="m-set-row m-set-row-btn" onClick={() => openWhatsNew(phoneChangelog(), APP_VERSION)}>
          <span>{t('settings.version')}</span>
          <span class="m-muted">
            {APP_VERSION}
            {isBetaVersion(APP_VERSION) && <span class="m-badge-beta">{betaBadge()}</span>} · {t('whatsNew.title')} ›
          </span>
        </button>
        {/* a found update stays offered here until it is installed, also after «Позже» */}
        {latestUpdate.value ? (
          <button type="button" class="m-btn m-btn-primary" data-row="update-available" onClick={() => (updatePrompt.value = latestUpdate.value)}>
            {updateTitle(latestUpdate.value.version, APP_VERSION)}
          </button>
        ) : (
          <button type="button" class="m-btn m-btn-secondary" onClick={() => void check()}>
            {t('updateScreen.check')}
          </button>
        )}
        <div class="m-set-row">
          <span>{t('tvSettings.updateOnStart')}</span>
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label={t('tvSettings.updateOnStart')}
            class={'m-switch' + (on ? ' on' : '')}
            onClick={() => updateSettings({ updateCheck: !on })}
          >
            <span class="m-switch-knob" />
          </button>
        </div>
        <div class="m-set-row" data-row="beta">
          <div class="m-set-text">
            <span>{t('settings.betaTitle')}</span>
            <span class="m-small m-muted">{betaHint()}</span>
          </div>
          <Switch
            on={settings.value.betaUpdates}
            label={t('settings.betaTitle')}
            onToggle={() => updateSettings({ betaUpdates: !settings.value.betaUpdates })}
          />
        </div>
      </section>
      <section class="m-set-group">
        <LanguageRow />
      </section>
      <VideoPlayerRow />
      {localServer.value.supported && <LocalServerSection />}
      <section class="m-set-group">
        <div class="m-set-label">{t('tvSettings.server')}</div>
        <div class="m-set-row">
          <div class="m-set-text">
            <span>{server ? server.name : t('settings.notChosen')}</span>
            {server && <span class="m-muted m-small">{server.url}</span>}
          </div>
          <button type="button" class="m-btn m-btn-secondary m-btn-sm" onClick={() => navigate({ name: 'connect' })}>
            {t('settings.change')}
          </button>
        </div>
        {server && (
          <button type="button" class="m-set-row m-set-pick" onClick={() => navigate({ name: 'serverSettings' })}>
            <span>{t('serverSettings.title')}</span>
            <Icon d="M9 6l6 6l-6 6" size={20} />
          </button>
        )}
      </section>
      <section class="m-set-group">
        <button type="button" class="m-set-row m-set-pick" onClick={() => navigate({ name: 'sources' })}>
          <span>{t('tvSettings.sources')}</span>
          <Icon d="M9 6l6 6l-6 6" size={20} />
        </button>
        <button type="button" class="m-set-row m-set-pick" onClick={() => navigate({ name: 'monitor' })}>
          <span>{t('monitor.title')}</span>
          <span class="m-muted">{monitor.enabled ? hoursText(monitor.hours) : t('sources.state.off')} ›</span>
        </button>
      </section>
      <section class="m-set-group">
        <div class="m-set-label">{t('history.tv')}</div>
        <div class="m-set-row">
          <div class="m-set-text">
            <span>{tv ? tv.name : t('settings.notChosen')}</span>
            {tv && <span class="m-muted m-small">{tv.ip}</span>}
          </div>
          <button type="button" class="m-btn m-btn-secondary m-btn-sm" onClick={() => navigate({ name: 'tv' })}>
            {t('settings.choose')}
          </button>
        </div>
        <TvOmpRow />
        <TvSearchRow />
        <button type="button" class="m-set-row m-set-pick" onClick={() => navigate({ name: 'install' })}>
          <span>{t('install.assistant.title')}</span>
          <Icon d="M9 6l6 6l-6 6" size={20} />
        </button>
      </section>
      <section class="m-set-group">
        <button type="button" class="m-set-row m-set-pick" onClick={() => navigate({ name: 'faq' })}>
          <span>{t('common.faq')}</span>
          <Icon d="M9 6l6 6l-6 6" size={20} />
        </button>
      </section>
      <section class="m-set-group">
        <div class="m-set-label">{t('tvSettings.about')}</div>
        <button type="button" class="m-set-row m-set-pick" onClick={() => navigate({ name: 'backup' })}>
          <span>{t('backup.title')}</span>
          <Icon d="M9 6l6 6l-6 6" size={20} />
        </button>
        <button type="button" class="m-set-row m-set-pick" onClick={() => navigate({ name: 'log' })}>
          <span>{t('log.screenTitle')}</span>
          <Icon d="M9 6l6 6l-6 6" size={20} />
        </button>
        {activeMethods().length > 0 && (
          <button type="button" class="m-set-row m-set-pick" onClick={openDonate}>
            <span>{t('donate.title')}</span>
            <Icon d="M9 6l6 6l-6 6" size={20} />
          </button>
        )}
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
