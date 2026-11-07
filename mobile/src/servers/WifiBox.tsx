// Phone TorrServer for this Wi-Fi. Does not change the TV or the phone link.
import { useEffect, useState } from 'preact/hooks';
import { t } from '../../../src/i18n';
import { activeServerId, addServer, serverLabel, servers } from '../../../src/store/servers';
import { Sheet } from '../ui/Sheet';
import {
  acceptWifiHost,
  considerWifi,
  dropWifiProfile,
  laterWifi,
  loadWifiPrefs,
  setWifiEnabled,
  setWifiManual,
  setWifiOverride,
  wifiPrefsVersion,
  wifiPrompt,
} from './wifiRun';
import type { WifiPlan } from './wifiSelect';

export function WifiPrompt() {
  const prompt = wifiPrompt.value;
  return prompt && (prompt.kind === 'confirm' || prompt.kind === 'choose') ? <WifiAsk plan={prompt} /> : null;
}

export function WifiBox() {
  const [prefs, setPrefs] = useState(loadWifiPrefs);
  const [manual, setManual] = useState(prefs.manualSsid);
  const list = servers.value;
  const refresh = () => setPrefs(loadWifiPrefs());
  const enabled = prefs.enabled;
  useEffect(() => setPrefs(loadWifiPrefs()), [wifiPrefsVersion.value]);

  const toggle = () => {
    const next = setWifiEnabled(!enabled, activeServerId.value);
    refresh();
    if (next.enabled) void considerWifi();
  };

  return (
    <section class="m-wifi" data-wifi-servers="">
      <div class="m-set-row">
        <span class="m-grow">
          <span class="m-set-label">{t('connect.wifiTitle')}</span>
          <span class="m-muted m-small m-wifi-hint">{t('connect.wifiHint')}</span>
        </span>
        <button type="button" role="switch" aria-checked={enabled} aria-label={t('connect.wifiOn')} class={'m-switch' + (enabled ? ' on' : '')} onClick={toggle}>
          <span class="m-switch-knob" />
        </button>
      </div>
      <label class="m-wifi-manual">
        <span class="m-muted m-small">{t('connect.wifiManual')}</span>
        <input
          class="m-input"
          type="text"
          autoCapitalize="off"
          autoCorrect="off"
          placeholder={t('connect.wifiManualPh')}
          aria-label={t('connect.wifiManual')}
          value={manual}
          onInput={(e) => setManual((e.target as HTMLInputElement).value)}
          onBlur={() => {
            setWifiManual(manual);
            refresh();
          }}
        />
        <span class="m-muted m-small">{t('connect.wifiUnavailable')}</span>
      </label>
      <div class="m-chips" role="group" aria-label={t('connect.wifiOverride')}>
        <button
          type="button"
          class={'m-chip' + (!prefs.overrideId ? ' on' : '')}
          aria-pressed={!prefs.overrideId}
          onClick={() => {
            setWifiOverride(null);
            refresh();
          }}
        >
          {t('connect.wifiAuto')}
        </button>
        {list.map((s) => (
          <button
            key={s.id}
            type="button"
            class={'m-chip' + (prefs.overrideId === s.id ? ' on' : '')}
            aria-pressed={prefs.overrideId === s.id}
            onClick={() => {
              setWifiOverride(s.id);
              refresh();
              void considerWifi();
            }}
          >
            {serverLabel(s)}
          </button>
        ))}
      </div>
      {prefs.profiles.map((p) => (
        <div key={p.id} class="m-wifi-profile">
          <span class="m-grow">{t('connect.wifiSaved', { ssid: p.ssid })}</span>
          <button
            type="button"
            class="m-btn m-btn-secondary m-btn-sm"
            onClick={() => {
              dropWifiProfile(p.ssid);
              refresh();
            }}
          >
            {t('connect.wifiForget')}
          </button>
        </div>
      ))}
      <button type="button" class="m-btn m-btn-secondary m-btn-sm" onClick={() => void considerWifi(undefined, true)}>
        {t('connect.wifiCheck')}
      </button>
    </section>
  );
}

function WifiAsk({ plan, onDone = () => undefined }: { plan: Extract<WifiPlan, { kind: 'confirm' | 'choose' }>; onDone?: () => void }) {
  const title = plan.kind === 'choose' ? t('connect.wifiChoose', { ssid: plan.ssid }) : t('connect.wifiConfirm', { name: plan.hosts[0].name || plan.hosts[0].url, ssid: plan.ssid });
  return (
    <Sheet label={title} onClose={() => laterWifi(plan)}>
      <div class="m-wifi-ask" role="menu">
        <p>{title}</p>
        {plan.hosts.map((h) => (
          <button
            key={h.url}
            type="button"
            class="m-btn m-btn-primary"
            onClick={() => {
              acceptWifiHost(plan, h.url, (url, name) => addServer({ url: url, name: name }));
              onDone();
            }}
          >
            {t('connect.wifiUse') + ': ' + (h.name || h.url)}
          </button>
        ))}
        <button type="button" class="m-btn m-btn-secondary" onClick={() => laterWifi(plan)}>
          {t('connect.wifiLater')}
        </button>
      </div>
    </Sheet>
  );
}
