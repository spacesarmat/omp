import { useEffect, useState } from 'preact/hooks';
import { navigate } from '../nav';
import { FoundTvs } from '../ui/FoundTvs';
import { Icon } from '../ui/Icon';
import { showToast } from '../ui/toast';
import { TorrServerClient } from '../../../src/api/torrserver';
import { activeServer, client, serverHost } from '../../../src/store/servers';
import { activeTv } from '../tv/tvStore';
import { tvState } from '../tv/tvClient';
import { tvSearchOn, setTvSearch } from '../tv/phoneRpc';
import { tvOmpVersions, tvNeedsUpdate, tvOpensUpdate, openUpdateOnTv, type TvOmp } from '../tv/tvUpdate';
import { errorMessage } from '../../../src/api/http';
import { settings, updateSettings } from '../../../src/store/settings';
import { checkForUpdate, latestUpdate, updatePrompt, type CheckResult } from '../../../src/store/updates';
import { updateFeedUrl, updateTitle } from '../../../src/lib/updateInfo';
import { clampLabelPx, isBetaBuild, PHONE_LABEL_PX } from '../../../src/testmode/active';
import { isBetaVersion } from '../../../src/lib/version';
import { APP_VERSION } from '../../../src/version';
import { phoneChangelog } from '../lib/phoneChangelog';
import { openWhatsNew } from '../../../src/store/whatsNew';
import { openOnboarding } from '../../../src/onboarding/gate';
import { resetHints } from '../../../src/onboarding/hints';
import { loadMonitorSettings } from '../../../src/monitor/settings';
import { hoursText } from '../monitor/text';
import { activeMethods, openDonate } from '../donate';
import { Sheet } from '../ui/Sheet';
import { billingSession, onBillingChange } from '../../../src/billing/session';
import { t, type LanguageSetting } from '../../../src/i18n';
import { LANGUAGE_NAMES } from '../../../src/i18n/languageNames';
import { ScreenHeader } from '../ui/ScreenHeader';
import { phonePlayerName } from './VideoPlayer';
import { localServer, canRun } from '../server/localServer';

function testLabelPhone(): number {
  return clampLabelPx(settings.value.testLabelPhonePx, PHONE_LABEL_PX);
}

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

const CHECK = 'M5 12l5 5l9-10';
const CHEVRON = 'M9 6l6 6l-6 6';
const LANGUAGES: LanguageSetting[] = ['system', 'ru', 'en'];

/** «Как в системе» / «Русский» / «English» in the current language. */
function languageName(v: LanguageSetting): string {
  return v === 'ru' || v === 'en' ? LANGUAGE_NAMES[v] : t('settings.language.system');
}

function billingDay(ms: number): string {
  if (!ms) return '';
  const d = new Date(ms);
  const p = (n: number) => (n < 10 ? '0' : '') + n;
  return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear();
}

/** A name a person chose. Empty when the server is still named after its address. */
function chosenName(s: { name: string; url: string }): string {
  const host = serverHost(s.url);
  const name = (s.name || '').trim();
  if (!name || serverHost(name).toLowerCase() === host.toLowerCase()) return '';
  return name;
}

/** «Язык»: the row shows the setting, a sheet offers the three choices; a choice applies at once. */
function LanguageRow() {
  const [open, setOpen] = useState(false);
  const cur = settings.value.language;
  const title = t('settings.language.title');
  return (
    <>
      <button type="button" class="m-set-row m-set-pick tm" data-code="P11.7" data-row="language" onClick={() => setOpen(true)}>
        <span>{title}</span>
        <span class="m-muted">{languageName(cur)} ›</span>
      </button>
      {open && (
        <Sheet label={title} testId="PD01" onClose={() => setOpen(false)}>
          <div class="m-sheet-title">{title}</div>
          <div class="m-sub-pick" role="radiogroup" aria-label={title}>
            {LANGUAGES.map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={cur === v}
                class="m-opt tm"
                data-code={v === 'system' ? 'PD01.1' : v === 'ru' ? 'PD01.2' : 'PD01.3'}
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

/** «Плеер для видео»: opens its own screen (the three options do not fit in a segment). */
function VideoPlayerRow() {
  return (
    <button type="button" class="m-set-row m-set-pick tm" data-code="P11.6" data-row="video-player" onClick={() => navigate({ name: 'videoPlayer' })}>
      <span>{t('player.videoPlayer')}</span>
      <span class="m-muted">{phonePlayerName(settings.value.phonePlayer)} ›</span>
    </button>
  );
}

/** The TV search switch: the TV searches torrent sites through this phone (PhoneRpcService). */
function TvSearchRow() {
  const on = tvSearchOn.value;
  return (
    <div class="m-set-row tm" data-code="P11.4" data-row="tv-search-service">
      <div class="m-set-text" style="flex-grow: 1">
        <span>{t('settings.tvSearch')}</span>
        <span class="m-muted m-small">{on ? t('settings.tvSearchHint') : t('settings.tvSearchOff')}</span>
      </div>
      <Switch on={on} label={t('settings.tvSearch')} onToggle={() => void setTvSearch(!on)} />
    </div>
  );
}

/** Installed and newest OMP on the connected TV. */
function useTvOmp(): { ready: boolean; v: TvOmp | null } {
  const connected = tvState.value === 'connected';
  const ip = activeTv.value ? activeTv.value.ip : '';
  const [v, setV] = useState<TvOmp | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setV(null);
    setReady(false);
    if (!connected) return;
    let alive = true;
    tvOmpVersions().then((r) => {
      if (!alive) return;
      setV(r);
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [connected, ip]);
  return { ready, v };
}

/** OMP on the connected TV, only while a newer build exists. */
function TvOmpRow({ v }: { v: TvOmp | null }) {
  const [hint, setHint] = useState(false);
  if (!v || !v.installed || !tvNeedsUpdate(v)) return null;
  const installed = v.installed;
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
          <span class="m-small m-accent">{t('settings.tvOmpNewer', { installed: installed, latest: v.latest || '' })}</span>
        </div>
        <button
          type="button"
          class={'m-btn m-btn-sm' + (latestUpdate.value ? ' m-btn-secondary' : ' m-btn-primary')}
          onClick={update}
        >
          {t('install.plan.updateOnTv')}
        </button>
      </div>
      {hint && (
        <div class="m-hint-warn" role="status">
          {t('install.assistant.noSelfUpdate')}
        </div>
      )}
    </>
  );
}

/** «Подписка до …» or «Войти», opening the account screen. */
function AccountRow() {
  const [session, setSession] = useState(billingSession());
  useEffect(() => onBillingChange(() => setSession(billingSession())), []);
  const until = session && session.token ? billingDay(session.paidUntil) : '';
  return (
    <button type="button" class="m-set-row m-set-pick tm" data-code="P11.1" data-row="account" onClick={() => navigate({ name: 'account' })}>
      <span>{until ? t('settings.subscribedUntil', { date: until }) : t('common.signIn')}</span>
      <Icon d={CHEVRON} size={20} />
    </button>
  );
}

function useReachable(url: string): 'none' | 'checking' | 'ok' | 'down' {
  const [st, setSt] = useState<'checking' | 'ok' | 'down'>('checking');
  useEffect(() => {
    if (!url) return;
    let alive = true;
    setSt('checking');
    const c = client.peek();
    const probe = c && c.baseUrl === url ? c : new TorrServerClient({ url });
    probe.echo().then(
      () => alive && setSt('ok'),
      () => alive && setSt('down'),
    );
    return () => {
      alive = false;
    };
  }, [url]);
  if (!url) return 'none';
  return st;
}

function reachText(st: 'none' | 'checking' | 'ok' | 'down'): string {
  if (st === 'ok') return t('settings.reachable');
  if (st === 'down') return t('settings.unreachable');
  if (st === 'checking') return t('settings.checking');
  return '';
}

/** «Сервер на телефоне» next to «Откуда смотреть»: its state, and its screen (start, download, update). */
function PhoneServerRow() {
  const st = localServer.value;
  if (!st.supported) return null;
  const state = st.running ? t('sources.flare.works') : !canRun(st) ? t('settings.localNotDownloaded') : t('settings.localStopped');
  return (
    <button type="button" class="m-set-row m-set-pick tm" data-code="P11.21" data-row="phone-server" onClick={() => navigate({ name: 'localServer' })}>
      <div class="m-set-text" style="flex-grow: 1">
        <span>{t('settings.phoneServer')}</span>
        <span class="m-muted m-small">{state}</span>
      </div>
      <Icon d={CHEVRON} size={20} />
    </button>
  );
}

export function Settings() {
  const server = activeServer.value;
  const tv = activeTv.value;
  const monitor = loadMonitorSettings();
  const omp = useTvOmp();
  const reach = useReachable(server ? server.url : '');
  const connected = tvState.value === 'connected';
  const ompMissing = omp.ready && !!omp.v && !omp.v.installed;
  const showWizard = !tv || (connected && ompMissing);

  async function check() {
    const r = await runUpdateCheck({ manual: true, url: phoneFeedUrl() }).catch((): CheckResult => 'error');
    if (r === 'error') showToast(t('updateScreen.checkFailed'));
    else if (r === 'latest') showToast(t('updateScreen.latest'));
  }

  const where = server ? chosenName(server) || t('tvSettings.server') : t('settings.notChosen');
  const whereLine = server ? where + ' · ' + reachText(reach) : where;

  return (
    <div class="m-screen" data-route="settings">
      <ScreenHeader title={t('common.settings')} />

      <section class="m-set-group" data-section="account">
        <div class="m-set-label">{t('settings.account')}</div>
        <AccountRow />
      </section>

      <section class="m-set-group" data-section="tv">
        <div class="m-set-label">{t('history.tv')}</div>
        <div class="m-set-row">
          <div class="m-set-text">
            <span>{tv ? tv.name : t('settings.notChosen')}</span>
          </div>
          <button type="button" class="m-btn m-btn-secondary m-btn-sm tm" data-code="P11.2" onClick={() => navigate({ name: 'tv' })}>
            {tv ? t('settings.change') : t('settings.choose')}
          </button>
        </div>
        {!tv && <FoundTvs />}
        <TvOmpRow v={omp.v} />
        <TvSearchRow />
        {showWizard && (
          <button type="button" class="m-set-row m-set-pick tm" data-code="P11.3" data-row="install" onClick={() => navigate({ name: 'install' })}>
            <span>{t('install.assistant.title')}</span>
            <Icon d={CHEVRON} size={20} />
          </button>
        )}
      </section>

      <section class="m-set-group" data-section="watch">
        <div class="m-set-label">{t('settings.watch')}</div>
        <div class="m-set-row tm" data-code="P11.5" data-row="watch-from">
          <div class="m-set-text" style="flex-grow: 1">
            <span>{t('settings.watchFrom')}</span>
            <span class="m-muted m-small">{whereLine}</span>
          </div>
          <button type="button" class="m-btn m-btn-secondary m-btn-sm" onClick={() => navigate({ name: 'connect' })}>
            {t('settings.change')}
          </button>
        </div>
        <PhoneServerRow />
        <VideoPlayerRow />
        <LanguageRow />
      </section>

      <section class="m-set-group" data-section="search">
        <div class="m-set-label">{t('settings.search')}</div>
        <button type="button" class="m-set-row m-set-pick tm" data-code="P11.8" data-row="audiobooks" onClick={() => navigate({ name: 'audiobooks' })}>
          <span>{t('audiobooks.title')}</span>
          <Icon d={CHEVRON} size={20} />
        </button>
        <button type="button" class="m-set-row m-set-pick tm" data-code="P11.9" onClick={() => navigate({ name: 'sources' })}>
          <span>{t('settings.whereSearch')}</span>
          <Icon d={CHEVRON} size={20} />
        </button>
        <div class="m-set-row tm" data-code="P11.10" data-row="live-seeds">
          <div class="m-set-text">
            <span>{t('settings.liveSeeds')}</span>
            <span class="m-muted m-small">{t('settings.liveSeedsHint')}</span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={settings.value.liveSeeds}
            aria-label={t('settings.liveSeeds')}
            class={'m-switch' + (settings.value.liveSeeds ? ' on' : '')}
            onClick={() => updateSettings({ liveSeeds: !settings.value.liveSeeds })}
          >
            <span class="m-switch-knob" />
          </button>
        </div>
        <button type="button" class="m-set-row m-set-pick tm" data-code="P11.11" onClick={() => navigate({ name: 'monitor' })}>
          <span>{t('settings.followNew')}</span>
          <span class="m-muted">{monitor.enabled ? hoursText(monitor.hours) : t('sources.state.off')} ›</span>
        </button>
      </section>

      <section class="m-set-group" data-section="app">
        <div class="m-set-label">{t('settings.app')}</div>
        {isBetaBuild() && (
          <div class="m-set-row tm" data-code="P11.19">
            <div class="m-set-text" style="flex-grow: 1">
              <span>{t('settings.testModeTitle')}</span>
              <span class="m-muted m-small">{t('settings.testModeHint')}</span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.value.testMode}
              aria-label={t('settings.testModeTitle')}
              class={'m-switch tm' + (settings.value.testMode ? ' on' : '')}
              data-code={settings.value.testMode ? 'P11.19.1' : 'P11.19.2'}
              onClick={() => updateSettings({ testMode: !settings.value.testMode })}
            >
              <span class="m-switch-knob" />
            </button>
          </div>
        )}
        {/* the size of labels that are not shown is not a setting: the slider comes with the switch on */}
        {isBetaBuild() && settings.value.testMode && (
          <div class="m-set-row m-test-size tm" data-code="P11.20">
            <span>{t('settings.testLabelSize')}</span>
            <span class="m-muted m-test-size-value">{testLabelPhone()} px</span>
            <input
              type="range"
              class="m-test-size-range"
              min={PHONE_LABEL_PX.min}
              max={PHONE_LABEL_PX.max}
              step={PHONE_LABEL_PX.step}
              value={testLabelPhone()}
              aria-label={t('settings.testLabelSize')}
              onInput={(e) => updateSettings({ testLabelPhonePx: clampLabelPx(Number((e.currentTarget as HTMLInputElement).value), PHONE_LABEL_PX) })}
            />
          </div>
        )}
        <button type="button" class="m-set-row m-set-row-btn tm" data-code="P11.12" onClick={() => openWhatsNew(phoneChangelog(), APP_VERSION)}>
          <span>{t('settings.version')}</span>
          <span class="m-muted">
            {APP_VERSION}
            {isBetaVersion(APP_VERSION) && <span class="m-badge-beta">{betaBadge()}</span>} · {t('whatsNew.title')} ›
          </span>
        </button>
        {latestUpdate.value ? (
          <button type="button" class="m-btn m-btn-primary tm" data-code="P11.13" data-row="update-available" onClick={() => (updatePrompt.value = latestUpdate.value)}>
            {updateTitle(latestUpdate.value.version, APP_VERSION)}
          </button>
        ) : (
          <button type="button" class="m-btn m-btn-secondary tm" data-code="P11.13" onClick={() => void check()}>
            {t('updateScreen.check')}
          </button>
        )}
        <button type="button" class="m-set-row m-set-pick tm" data-code="P11.14" onClick={() => navigate({ name: 'faq' })}>
          <span>{t('settings.help')}</span>
          <Icon d={CHEVRON} size={20} />
        </button>
        <button type="button" class="m-set-row m-set-pick tm" data-code="P11.15" data-row="onboarding" onClick={() => openOnboarding()}>
          <span>{t('settings.showOnboarding')}</span>
          <Icon d={CHEVRON} size={20} />
        </button>
        <button
          type="button"
          class="m-set-row m-set-pick tm"
          data-code="P11.16"
          data-row="reset-hints"
          onClick={() => {
            resetHints();
            showToast(t('settings.hintsAgain'));
          }}
        >
          <span>{t('settings.resetHints')}</span>
          <Icon d={CHEVRON} size={20} />
        </button>
        {activeMethods().length > 0 && (
          <button type="button" class="m-set-row m-set-pick tm" data-code="P11.17" onClick={openDonate}>
            <span>{t('settings.support')}</span>
            <Icon d={CHEVRON} size={20} />
          </button>
        )}
      </section>

      <section class="m-set-group" data-section="advanced">
        <button type="button" class="m-set-row m-set-pick tm" data-code="P11.18" data-row="advanced" onClick={() => navigate({ name: 'advanced' })}>
          <span>{t('settings.advanced')}</span>
          <Icon d={CHEVRON} size={20} />
        </button>
      </section>
    </div>
  );
}
