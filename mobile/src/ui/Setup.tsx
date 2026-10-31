import { useEffect, useState } from 'preact/hooks';
import { t, type LanguageSetting } from '../../../src/i18n';
import { LANGUAGE_NAMES } from '../../../src/i18n/languageNames';
import { addressErrorText, checkServerAddress } from '../../../src/api/serverAddress';
import { scanLan } from '../screens/Connect';
import type { FoundServer } from '../../../src/api/discovery';
import { errorMessage } from '../../../src/api/http';
import { settings, updateSettings } from '../../../src/store/settings';
import { activeServer } from '../../../src/store/servers';
import {
  beginSetupSession,
  completeSetup,
  setupHandoff,
  setupNotice,
  setupStep,
} from '../../../src/onboarding/gate';
import { connectServer, type ConnectResult } from '../connect/connectServer';
import { scanPairQr } from '../platform/qr';
import { localName, localServer, LOCAL_URL, startLocal } from '../server/localServer';
import { afterConnectRoute, currentRoute, navigate, resetTo } from '../nav';
import { useBackHandler } from './backStack';

type Attempt = 'phone' | 'qr' | 'network';

const LANGS: LanguageSetting[] = ['system', 'ru', 'en'];

function languageName(v: LanguageSetting): string {
  return v === 'ru' || v === 'en' ? LANGUAGE_NAMES[v] : t('settings.language.system');
}

function finish(): void {
  const goLibrary = !!activeServer.peek() && currentRoute.peek().name === 'connect';
  completeSetup();
  if (goLibrary) resetTo(afterConnectRoute());
}

/**
 * First launch when nothing is saved yet: where TorrServer is, whether it answers, then two prefs.
 * Connect, scan and the on-phone installer are the screens and functions the app already has.
 */
export function Setup() {
  const step = setupStep.value;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [addr, setAddr] = useState('');
  const [found, setFound] = useState<FoundServer[]>([]);
  const [scanning, setScanning] = useState(false);
  const [attempt, setAttempt] = useState<Attempt>('network');
  const [outcome, setOutcome] = useState<ConnectResult | null>(null);
  const audioOn = settings.value.backgroundAudio;
  const lang = settings.value.language;

  useEffect(() => {
    beginSetupSession();
  }, []);

  function show(r: ConnectResult): void {
    setOutcome(r);
    setupStep.value = 'result';
    setBusy(false);
  }

  async function onPhone(): Promise<void> {
    setAttempt('phone');
    const info = localServer.value;
    const canStart = info.supported && (info.running || info.binary === 'ready' || info.binary === 'outdated');
    if (!canStart) {
      setupHandoff.value = true;
      navigate({ name: 'localServer' });
      return;
    }
    setBusy(true);
    if (!info.running) await startLocal();
    if (localServer.value.error || !localServer.value.running) {
      show({ ok: false, error: localServer.value.error || t('errors.network'), network: true });
      return;
    }
    show(await connectServer({ name: localName(), url: LOCAL_URL }));
  }

  async function onQr(): Promise<void> {
    setAttempt('qr');
    setBusy(true);
    try {
      const data = await scanPairQr();
      if (!data) {
        setBusy(false);
        return;
      }
      const name = data.name || data.url.replace(/^https?:\/\//, '');
      show(await connectServer({ name, url: data.url, user: data.user, password: data.password }));
    } catch (e) {
      show({ ok: false, error: errorMessage(e), network: false });
    }
  }

  async function connectAddr(raw: string): Promise<void> {
    setAttempt('network');
    const checked = checkServerAddress(raw);
    if (!checked.ok) {
      setError(addressErrorText(checked.bad));
      return;
    }
    setError('');
    setBusy(true);
    // as typed: without a scheme connectServer tries http and https
    show(await connectServer({ url: raw }));
  }

  async function find(): Promise<void> {
    setScanning(true);
    setFound([]);
    setError('');
    try {
      const list = await scanLan(() => false, undefined, (s) => {
        setFound((prev) => (prev.some((x) => x.url === s.url) ? prev : prev.concat(s)));
      });
      setFound(list);
    } catch {
      setFound([]);
    }
    setScanning(false);
  }

  function retry(): void {
    setOutcome(null);
    if (attempt === 'network') setupStep.value = 'network';
    else if (attempt === 'phone') void onPhone();
    else void onQr();
  }

  function back(): void {
    if (busy) return;
    if (step === 'network' || step === 'result') {
      setOutcome(null);
      setError('');
      setupStep.value = step === 'result' && attempt === 'network' ? 'network' : 'where';
      return;
    }
    finish();
  }

  useBackHandler(back);

  const stepNo = step === 'prefs' ? 3 : step === 'result' ? 2 : 1;
  const failed = outcome && !outcome.ok ? outcome : null;
  const noticed = setupNotice.value;
  const ok = outcome && outcome.ok ? outcome : noticed ? { server: { name: noticed.name }, version: noticed.version } : null;

  return (
    <div class="m-onb m-setup" role="dialog" aria-modal="true" aria-label={t('setup.whereTitle')} data-onboarding="setup" data-setup={step} data-code="PD44">
      <div class="m-onb-step">{t('setup.step', { n: stepNo, total: 3 })}</div>
      {step === 'where' && (
        <div class="m-onb-main">
          <h1>{t('setup.whereTitle')}</h1>
          <p class="m-onb-text">{t('setup.whereBody')}</p>
          <button type="button" class="m-setup-choice" data-setup-choice="phone" disabled={busy} onClick={() => void onPhone()}>
            <span>{t('setup.phone')}</span>
            <span class="m-muted m-small">{t('setup.phoneHint')}</span>
          </button>
          <button type="button" class="m-setup-choice" data-setup-choice="home" disabled={busy} onClick={() => (setupStep.value = 'network')}>
            <span>{t('setup.home')}</span>
            <span class="m-muted m-small">{t('setup.homeHint')}</span>
          </button>
          <button type="button" class="m-setup-choice" data-setup-choice="qr" disabled={busy} onClick={() => void onQr()}>
            <span>{t('setup.qr')}</span>
            <span class="m-muted m-small">{t('setup.qrHint')}</span>
          </button>
        </div>
      )}
      {step === 'network' && (
        <div class="m-onb-main">
          <h1>{t('setup.networkTitle')}</h1>
          <p class="m-onb-text">{t('setup.networkBody')}</p>
          <input
            class="m-input"
            data-setup-address=""
            placeholder="192.168.1.10:8090, https://host:8443"
            value={addr}
            onInput={(e) => setAddr((e.target as HTMLInputElement).value)}
          />
          {error && (
            <p class="m-error" role="alert">
              {error}
            </p>
          )}
          <button type="button" class="m-btn m-btn-primary" data-action="connect" disabled={busy} onClick={() => void connectAddr(addr)}>
            {t('setup.connect')}
          </button>
          <button type="button" class="m-btn m-btn-secondary" data-action="find" disabled={busy || scanning} onClick={() => void find()}>
            {scanning ? t('connect.searchingShort') : t('connect.scan')}
          </button>
          {found.map((f) => (
            <button key={f.url} type="button" class="m-setup-choice" data-setup-found={f.url} disabled={busy} onClick={() => void connectAddr(f.url)}>
              <span>{f.url.replace(/^https?:\/\//, '')}</span>
              <span class="m-muted m-small">{f.version}</span>
            </button>
          ))}
        </div>
      )}
      {step === 'result' && failed && (
        <div class="m-onb-main">
          <h1>{t('setup.failTitle')}</h1>
          <p class="m-onb-text" data-result="fail" role="alert">
            {failed.error}
          </p>
          <button type="button" class="m-btn m-btn-primary" data-action="retry" onClick={retry}>
            {t('setup.retry')}
          </button>
        </div>
      )}
      {step === 'result' && ok && (
        <div class="m-onb-main">
          <h1>{t('setup.successTitle')}</h1>
          <p class="m-onb-text" data-result="ok">
            {t('setup.successBody', { name: ok.server.name, version: ok.version ? ' · ' + ok.version : '' })}
          </p>
          <button type="button" class="m-btn m-btn-primary" data-action="next" onClick={() => (setupStep.value = 'prefs')}>
            {t('setup.next')}
          </button>
        </div>
      )}
      {step === 'prefs' && (
        <div class="m-onb-main">
          <h1>{t('setup.prefsTitle')}</h1>
          <p class="m-onb-text">{t('setup.prefsBody')}</p>
          <div class="m-set-label">{t('setup.language')}</div>
          <div class="m-setup-langs" role="radiogroup" aria-label={t('setup.language')}>
            {LANGS.map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={lang === v}
                class={'m-btn m-btn-secondary m-btn-sm' + (lang === v ? ' on' : '')}
                data-setup-lang={v}
                onClick={() => updateSettings({ language: v })}
              >
                {languageName(v)}
              </button>
            ))}
          </div>
          <div class="m-set-row" data-row="setup-audio">
            <div class="m-set-text" style="flex-grow: 1">
              <span>{t('player.backgroundAudio')}</span>
              <span class="m-muted m-small">{t('setup.audioHint')}</span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={audioOn}
              aria-label={t('player.backgroundAudio')}
              class={'m-switch' + (audioOn ? ' on' : '')}
              data-setup-audio=""
              onClick={() => updateSettings({ backgroundAudio: !audioOn, backgroundAudioTouched: true })}
            >
              <span class="m-switch-knob" />
            </button>
          </div>
        </div>
      )}
      <div class="m-onb-actions">
        <button type="button" class="m-btn m-btn-secondary" data-action="skip" onClick={finish}>
          {t('setup.skip')}
        </button>
        {step === 'prefs' && (
          <button type="button" class="m-btn m-btn-primary" data-action="done" onClick={finish}>
            {t('setup.done')}
          </button>
        )}
      </div>
    </div>
  );
}
