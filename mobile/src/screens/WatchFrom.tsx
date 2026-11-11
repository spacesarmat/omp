// «Откуда смотреть»: which TorrServer this phone plays from.
// Does not write the TV, the phone link, or switch a server while something is playing.
import { useEffect, useState } from 'preact/hooks';
import { t } from '../../../src/i18n';
import { TorrServerClient } from '../../../src/api/torrserver';
import {
  activeServer,
  activeServerId,
  removeServer,
  serverLabel,
  servers,
  setActiveServer,
  type SavedServer,
} from '../../../src/store/servers';
import { goBack, navigate } from '../nav';
import { nowPlaying } from '../tv/playerLink';
import { Icon } from '../ui/Icon';
import { askConfirm } from '../ui/confirm';
import {
  acceptedSsid,
  nextManualSsid,
  readCurrentNetwork,
  removeDecision,
  selectDecision,
  type WifiRead,
} from '../servers/currentNetwork';
import { normalizeSsid } from '../servers/wifiSelect';
import {
  clearAfterPlayback,
  considerWifi,
  forgetPendingServer,
  dropWifiProfile,
  loadWifiPrefs,
  queueAfterPlayback,
  searchLan,
  setWifiEnabled,
  setWifiManual,
  setWifiOverride,
  setWifiPrimary,
  watchPlaybackEnd,
  wifiPrefsVersion,
} from '../servers/wifiRun';

watchPlaybackEnd();

const BACK = 'M15 5l-7 7 7 7';

function failNote(read: WifiRead): string {
  if (read.kind === 'unsupported') return t('settings.watchFromUnsupported');
  if (read.kind === 'denied') return t('settings.watchFromDenied');
  if (read.kind === 'blocked') return t('settings.watchFromBlocked');
  if (read.kind === 'location') return t('settings.watchFromLocation');
  if (read.kind === 'nowifi') return t('settings.watchFromNowifi');
  if (read.kind === 'prompt') return t('settings.watchFromPermitLater');
  return t('settings.watchFromHidden');
}

function modeIsAuto(): boolean {
  const p = loadWifiPrefs();
  return p.enabled && !p.overrideId;
}

function playingNow(): boolean {
  const n = nowPlaying.peek();
  return !!(n && n.hash);
}

function reachText(st: 'checking' | 'ok' | 'down'): string {
  if (st === 'ok') return t('settings.reachable');
  if (st === 'down') return t('settings.unreachable');
  return t('settings.checking');
}

/** The active phone server's echo. A miss is "down", never a guessed "ok". */
function useReachable(url: string): 'none' | 'checking' | 'ok' | 'down' {
  const [st, setSt] = useState<'checking' | 'ok' | 'down'>('checking');
  useEffect(() => {
    if (!url) return;
    let alive = true;
    setSt('checking');
    new TorrServerClient({ url: url }).echo().then(
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

export function WatchFrom() {
  const list = servers.value;
  const current = activeServer.value;
  const prefs = loadWifiPrefs();
  void wifiPrefsVersion.value;
  const auto = prefs.enabled && !prefs.overrideId;
  const reach = useReachable(current ? current.url : '');
  const [manual, setManual] = useState(prefs.manualSsid);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [checks, setChecks] = useState<{ [id: string]: 'checking' | 'ok' | 'down' }>({});
  const ssid = normalizeSsid(prefs.manualSsid);

  useEffect(() => {
    setManual(loadWifiPrefs().manualSsid);
  }, [wifiPrefsVersion.value]);

  function remember(name: string) {
    setWifiManual(name);
  }

  async function useCurrent() {
    if (busy) return;
    setBusy(true);
    try {
      let read = await readCurrentNetwork(false);
      if (read.kind === 'prompt' || read.kind === 'denied') {
        const ok = await askConfirm(t('settings.watchFromPermitAsk'), t('settings.watchFromPermit'));
        if (!ok) {
          setNote(t('settings.watchFromPermitLater'));
          return;
        }
        read = await readCurrentNetwork(true);
      }
      const name = acceptedSsid(read);
      if (!name) {
        setNote(failNote(read));
        return;
      }
      remember(nextManualSsid(loadWifiPrefs().manualSsid, read));
      if (!modeIsAuto()) {
        setNote(t('settings.watchFromLocked'));
        return;
      }
      if (playingNow()) {
        queueAfterPlayback({ kind: 'wifi' });
        setNote(t('settings.watchFromDefer'));
        return;
      }
      await considerWifi(undefined, true);
      setNote(t('settings.watchFromUsing', { name: name }));
    } finally {
      setBusy(false);
    }
  }

  function saveTyped() {
    const name = manual.trim();
    remember(name);
    if (!name) {
      setNote(t('settings.watchFromNone'));
      return;
    }
    if (!modeIsAuto()) {
      setNote(t('settings.watchFromUsing', { name: normalizeSsid(name) }));
      return;
    }
    if (playingNow()) {
      queueAfterPlayback({ kind: 'wifi' });
      setNote(t('settings.watchFromDefer'));
      return;
    }
    void considerWifi(undefined, true);
    setNote(t('settings.watchFromUsing', { name: normalizeSsid(name) }));
  }

  function chooseMode(next: 'auto' | 'always') {
    const id = activeServerId.peek() || (list[0] ? list[0].id : null);
    setWifiEnabled(true, id);
    setWifiOverride(next === 'always' ? id : null);
    if (next === 'always' && id && selectDecision(playingNow()) === 'apply' && activeServerId.peek() !== id) setActiveServer(id);
  }

  function select(id: string) {
    if (selectDecision(playingNow()) === 'defer') {
      queueAfterPlayback({ kind: 'select', id: id });
      setNote(t('settings.watchFromSwitchLater'));
      return;
    }
    clearAfterPlayback();
    setActiveServer(id);
    if (!auto) setWifiOverride(id);
  }

  async function check(s: SavedServer) {
    setChecks((m) => ({ ...m, [s.id]: 'checking' }));
    const ok = await new TorrServerClient(s).echo().then(() => true, () => false);
    setChecks((m) => ({ ...m, [s.id]: ok ? 'ok' : 'down' }));
  }

  async function remove(s: SavedServer) {
    const ok = await askConfirm(t('settings.watchFromRemoveAsk', { name: serverLabel(s) }), t('settings.watchFromRemove'), {
      destructive: true,
    });
    if (removeDecision(ok) === 'cancel') return;
    if (playingNow() && activeServerId.peek() === s.id) {
      queueAfterPlayback({ kind: 'remove', id: s.id });
      setNote(t('settings.watchFromRemoveLater'));
      return;
    }
    removeServer(s.id);
    forgetPendingServer(s.id);
  }

  async function find() {
    if (playingNow()) {
      setNote(t('settings.watchFromSwitchLater'));
      return;
    }
    setNote(t('connect.searchingLan'));
    const result = await searchLan();
    if (result === 'defer' || playingNow()) {
      setNote(t('settings.watchFromSwitchLater'));
      return;
    }
    if (result === 'none') setNote(t('connect.nothingOnNet'));
    else setNote('');
  }

  const modeLine = auto ? t('settings.watchFromModeAuto') : t('settings.watchFromModeAlways');
  const netLine = ssid || t('settings.watchFromNone');
  const status = current
    ? reachText(reach === 'none' ? 'checking' : reach) + ' · ' + modeLine + ' · ' + netLine
    : t('settings.watchFromNoServer');

  return (
    <div class="m-screen" data-route="watchFrom">
      <div class="m-bar">
        <button type="button" class="m-icon-btn tm" data-code="P35.1" aria-label={t('common.back')} onClick={() => goBack()}>
          <Icon d={BACK} />
        </button>
        <h1 class="m-bar-title">{t('settings.watchFrom')}</h1>
      </div>
      <p class="m-watch-note">{t('settings.watchFromLead')}</p>

      <section class="m-set-group" data-section="now">
        <div class="m-set-label">{t('settings.watchFromNow')}</div>
        <div class="m-set-row">
          <div class="m-set-text">
            <span>{current ? serverLabel(current) : t('settings.watchFromNoServer')}</span>
            <span class="m-muted m-small" data-now-status="">{status}</span>
          </div>
        </div>
      </section>

      <section class="m-set-group" data-section="rule">
        <div class="m-set-label">{t('settings.watchFromRule')}</div>
        <div class="m-watch-choices" role="radiogroup" aria-label={t('settings.watchFromRule')}>
          <button type="button" class={'m-set-row m-set-pick' + (auto ? ' m-track-on' : '')} role="radio" aria-checked={auto} data-code="P35.3" data-mode="auto" onClick={() => chooseMode('auto')}>
            <span class="m-set-text">
              <span>{t('settings.watchFromByNet')}</span>
              <span class="m-muted m-small">{auto ? t('settings.watchFromByNetHint') : ''}</span>
            </span>
          </button>
          <button type="button" class={'m-set-row m-set-pick' + (!auto ? ' m-track-on' : '')} role="radio" aria-checked={!auto} data-code="P35.4" data-mode="always" disabled={list.length === 0} onClick={() => chooseMode('always')}>
            <span class="m-set-text">
              <span>{t('settings.watchFromAlways')}</span>
              <span class="m-muted m-small">{auto ? '' : t('settings.watchFromAlwaysHint')}</span>
            </span>
          </button>
        </div>
        {!auto && (
          <div class="m-watch-choices" role="radiogroup" aria-label={t('settings.watchFromAlways')}>
            {list.map((s) => (
              <button
                key={s.id}
                type="button"
                class={'m-set-row m-set-pick' + (prefs.overrideId === s.id ? ' m-track-on' : '')}
                role="radio"
                aria-checked={prefs.overrideId === s.id}
                data-override={s.id}
                onClick={() => select(s.id)}
              >
                <span>{serverLabel(s)}</span>
              </button>
            ))}
          </div>
        )}
        {auto && (
          <div class="m-watch-choices" role="radiogroup" aria-label={t('settings.watchFromPrimary')}>
            <div class="m-set-label">{t('settings.watchFromPrimary')}</div>
            <p class="m-watch-note">{t('settings.watchFromPrimaryHint')}</p>
            {list.map((s) => (
              <button
                key={s.id}
                type="button"
                class={'m-set-row m-set-pick' + (prefs.primaryId === s.id ? ' m-track-on' : '')}
                role="radio"
                aria-checked={prefs.primaryId === s.id}
                data-primary={s.id}
                onClick={() => setWifiPrimary(s.id)}
              >
                <span>{serverLabel(s)}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section class="m-set-group" data-section="network">
        <div class="m-set-label">{t('settings.watchFromNet')}</div>
        <p class="m-watch-note" data-net-note="" aria-live="polite">{note}</p>
        <button type="button" class="m-btn m-btn-primary" data-code="P35.2" data-action="current" aria-busy={busy} disabled={busy} onClick={() => void useCurrent()}>
          {t('settings.watchFromUse')}
        </button>
        <label class="m-set-text">
          <span>{t('settings.watchFromManual')}</span>
          <input
            class="m-input"
            data-manual=""
            value={manual}
            placeholder={t('settings.watchFromManualPh')}
            autoCapitalize="off"
            autoCorrect="off"
            onInput={(e) => setManual((e.target as HTMLInputElement).value)}
          />
        </label>
        <button type="button" class="m-btn m-btn-secondary" data-code="P35.5" data-action="save-name" onClick={saveTyped}>
          {t('settings.watchFromSaveName')}
        </button>
        {prefs.profiles.length > 0 && <div class="m-set-label">{t('settings.watchFromSaved')}</div>}
        {prefs.profiles.map((p) => (
          <div key={p.id} class="m-set-row" data-profile={p.ssid}>
            <span class="m-set-text">
              <span>{p.ssid}</span>
            </span>
            <button type="button" class="m-btn m-btn-secondary m-btn-sm" data-forget={p.ssid} onClick={() => dropWifiProfile(p.ssid)}>
              {t('settings.watchFromForget')}
            </button>
          </div>
        ))}
      </section>

      <section class="m-set-group" data-section="servers">
        <div class="m-set-label">{t('settings.watchFromServers')}</div>
        {list.map((s) => {
          const st = checks[s.id];
          const line = st === 'ok' ? t('settings.watchFromChecked', { name: serverLabel(s) }) : st === 'down' ? t('settings.watchFromCheckDown', { name: serverLabel(s) }) : st === 'checking' ? t('settings.checking') : '';
          return (
            <div key={s.id} class="m-set-row m-watch-server" data-server={s.id}>
              <div class="m-set-text">
                <span>{serverLabel(s)}{activeServerId.value === s.id ? ' · ' + t('settings.watchFromCurrent') : ''}</span>
                {line && <span class="m-muted m-small" data-check-line={s.id}>{line}</span>}
              </div>
              <div class="m-watch-actions">
                <button type="button" class="m-btn m-btn-secondary m-btn-sm" data-select={s.id} onClick={() => select(s.id)}>{t('settings.watchFromSelect')}</button>
                <button type="button" class="m-btn m-btn-secondary m-btn-sm" data-check={s.id} onClick={() => void check(s)}>{t('settings.watchFromCheck')}</button>
                <button type="button" class="m-btn m-btn-secondary m-btn-sm" data-edit={s.id} onClick={() => navigate({ name: 'serverSettings', url: s.url })}>{t('connect.edit')}</button>
                <button type="button" class="m-btn m-btn-secondary m-btn-sm" data-remove={s.id} onClick={() => void remove(s)}>{t('settings.watchFromRemove')}</button>
              </div>
            </div>
          );
        })}
        <button type="button" class="m-btn m-btn-secondary" data-code="P35.6" data-action="add" onClick={() => navigate({ name: 'connect' })}>
          {t('settings.watchFromAdd')}
        </button>
        <button type="button" class="m-btn m-btn-secondary" data-code="P35.7" data-action="discover" onClick={find}>
          {t('settings.watchFromFind')}
        </button>
      </section>
    </div>
  );
}
