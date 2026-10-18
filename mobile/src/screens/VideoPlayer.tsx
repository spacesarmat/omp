// «Настройки» → «Плеер для видео»: three options as a list (the segment did not fit on a phone).
import { useEffect, useState } from 'preact/hooks';
import { t } from '../../../src/i18n';
import { Icon } from '../ui/Icon';
import { goBack } from '../nav';
import { settings, updateSettings, type PhonePlayer } from '../../../src/store/settings';
import { native } from '../platform/native';
import { monitorNative } from '../monitor/native';
import { P2160_RELEASES_URL } from '../../../src/player/player2160';
const BACK = 'M15 5l-7 7 7 7';
const CHECK = 'M5 12l5 5l9-10';

function Switch(p: { on: boolean; label: string; onToggle: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={p.on} aria-label={p.label} class={'m-switch' + (p.on ? ' on' : '')} onClick={p.onToggle}>
      <span class="m-switch-knob" />
    </button>
  );
}

/** Label of the current phone player choice (for the Settings pick row). */
export function phonePlayerName(v: PhonePlayer): string {
  if (v === 'p2160') return t('player.p2160AppPhone');
  if (v === 'chooser') return t('player.builtinPlayerPhone');
  return t('player.embeddedPlayerPhone');
}

/**
 * «Звук в фоне» for the built-in (embedded 2160) player. Turning it on asks for notifications (Android 13+): without
 * them the sound still plays in the background, only the controls in the shade are missing.
 */
function BackgroundAudioRow() {
  const on = settings.value.backgroundAudio;
  const [denied, setDenied] = useState(false);
  useEffect(() => {
    if (!on || !monitorNative.available) return;
    let alive = true;
    monitorNative.notifyPermission().then((p) => alive && setDenied(p === 'denied'));
    return () => {
      alive = false;
    };
  }, [on]);
  const toggle = () => {
    updateSettings({ backgroundAudio: !on, backgroundAudioTouched: true });
    if (on || !monitorNative.available) return;
    void monitorNative.notifyPermission().then((before) =>
      before === 'granted' ? setDenied(false) : monitorNative.requestNotifyPermission().then((now) => setDenied(now === 'denied')),
    );
  };
  return (
    <div class="m-set-row" data-row="background-audio">
      <div class="m-set-text" style="flex-grow: 1">
        <span>{t('player.backgroundAudio')}</span>
        <span class="m-muted m-small">{t('player.backgroundAudioHint')}</span>
        {on && denied && <span class="m-muted m-small" data-row="background-audio-denied">{t('player.backgroundAudioNoNotify')}</span>}
      </div>
      <Switch on={on} label={t('player.backgroundAudio')} onToggle={toggle} />
    </div>
  );
}

const OPTIONS: { id: PhonePlayer; label: () => string }[] = [
  { id: 'embedded', label: () => t('player.embeddedPlayerPhone') },
  { id: 'p2160', label: () => t('player.p2160AppPhone') },
  { id: 'chooser', label: () => t('player.builtinPlayerPhone') },
];

/** «Плеер для видео»: list of three choices; background audio under «Встроенный». */
export function VideoPlayer() {
  const cur = settings.value.phonePlayer;
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
    <div class="m-screen" data-route="video-player">
      <div class="m-bar">
        <button type="button" class="m-icon-btn" aria-label={t('common.back')} onClick={() => goBack()}>
          <Icon d={BACK} />
        </button>
        <h1 class="m-bar-title">{t('player.videoPlayer')}</h1>
      </div>
      <section class="m-set-group" data-row="video-player">
        <div class="m-sub-pick" role="radiogroup" aria-label={t('player.videoPlayer')}>
          {OPTIONS.map((o) => {
            const disabled = o.id === 'p2160' && missing;
            return (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={cur === o.id}
                aria-pressed={cur === o.id}
                disabled={disabled}
                class="m-opt"
                onClick={() => !disabled && updateSettings({ phonePlayer: o.id })}
              >
                <span class="m-opt-name m-grow">{o.label()}</span>
                {cur === o.id && <Icon d={CHECK} size={20} />}
              </button>
            );
          })}
        </div>
        {missing && (
          <button type="button" class="m-link" data-row="p2160-missing" onClick={() => window.open(P2160_RELEASES_URL, '_system')}>
            {t('player.p2160Missing')}
          </button>
        )}
        <p class="m-muted m-small">{t('player.p2160NotePhone')}</p>
        {cur === 'embedded' && <BackgroundAudioRow />}
      </section>
    </div>
  );
}
