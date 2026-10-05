import { useEffect, useState } from 'preact/hooks';
import { t } from '../../../src/i18n';
import { Icon } from '../ui/Icon';
import { Sheet } from '../ui/Sheet';
import { goBack } from '../nav';
import { monitorNative, type NotifyPermission } from '../monitor/native';
import { applySchedule, askNotifyOnce, lastCheck, monitorVersion, useMonitorStatus } from '../monitor/ui';
import { hoursText, nextLine, summaryLines } from '../monitor/text';
import { MONITOR_HOURS, loadMonitorSettings, saveMonitorSettings, type MonitorSettings } from '../../../src/monitor/settings';

const BACK = 'M15 5l-7 7 7 7';
const CHECK = 'M5 12l5 5l9-10';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function Switch(p: { on: boolean; label: string; onToggle: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={p.on} aria-label={p.label} class={'m-switch' + (p.on ? ' on' : '')} onClick={p.onToggle}>
      <span class="m-switch-knob" />
    </button>
  );
}

/** «Настройки» → «Мониторинг»: background checks, how often, Wi-Fi only, new episodes, better quality, the last check. */
export function Monitor() {
  const [s, setS] = useState<MonitorSettings>(loadMonitorSettings);
  const [hoursOpen, setHoursOpen] = useState(false);
  const [perm, setPerm] = useState<NotifyPermission | null>(null);
  const status = useMonitorStatus();
  const v = monitorVersion.value;

  useEffect(() => {
    let alive = true;
    if (monitorNative.available) void monitorNative.notifyPermission().then((p) => alive && setPerm(p));
    return () => {
      alive = false;
    };
  }, [v]);

  const change = (patch: Partial<MonitorSettings>) => {
    const next = saveMonitorSettings(patch);
    setS(next);
    if (patch.enabled !== undefined || patch.hours !== undefined || patch.wifiOnly !== undefined) void applySchedule(next);
    // the hint below follows what the user answered
    if (patch.enabled === true) void askNotifyOnce().then(refreshPerm, () => {});
  };

  const allow = () => {
    void monitorNative.requestNotifyPermission().then(setPerm);
  };
  function refreshPerm(): void {
    if (monitorNative.available) void monitorNative.notifyPermission().then(setPerm);
  }

  const last = lastCheck(status);
  const now = Date.now();
  const next = status && status.nextRun ? status.nextRun : null;

  return (
    <div class="m-screen" data-route="monitor">
      <div class="m-bar">
        <button type="button" class="m-icon-btn" aria-label={t('common.back')} onClick={() => goBack()}>
          <Icon d={BACK} />
        </button>
        <h1 class="m-bar-title">{t('monitor.title')}</h1>
      </div>
      <div class="m-set-card">
        <div class="m-set-row">
          <div class="m-set-text" style="flex-grow: 1">
            <span>{t('monitor.settings.background')}</span>
            <span class="m-muted m-small">{t('monitor.settings.backgroundSub')}</span>
          </div>
          <Switch on={s.enabled} label={t('monitor.settings.background')} onToggle={() => change({ enabled: !s.enabled })} />
        </div>
        <div class="m-set-sep" />
        <button type="button" class="m-set-row m-set-pick" aria-haspopup="dialog" disabled={!s.enabled} onClick={() => setHoursOpen(true)}>
          <span>{t('monitor.settings.howOften')}</span>
          <span class="m-muted">{hoursText(s.hours)} ›</span>
        </button>
        <div class="m-set-sep" />
        <div class="m-set-row">
          <span style="flex-grow: 1">{t('monitor.settings.wifiOnly')}</span>
          <Switch on={s.wifiOnly} label={t('monitor.settings.wifiOnly')} onToggle={() => change({ wifiOnly: !s.wifiOnly })} />
        </div>
        <div class="m-set-sep" />
        <div class="m-set-row">
          <div class="m-set-text" style="flex-grow: 1">
            <span>{t('monitor.settings.episodes')}</span>
            <span class="m-muted m-small">{t('monitor.settings.episodesSub')}</span>
          </div>
          <Switch on={s.episodes} label={t('monitor.settings.episodes')} onToggle={() => change({ episodes: !s.episodes })} />
        </div>
        <div class="m-set-sep" />
        <div class="m-set-row">
          <div class="m-set-text" style="flex-grow: 1">
            <span>{t('monitor.settings.better')}</span>
            <span class="m-muted m-small">{t('monitor.settings.betterSub')}</span>
          </div>
          <Switch on={s.better} label={t('monitor.settings.better')} onToggle={() => change({ better: !s.better })} />
        </div>
      </div>
      <div class="m-set-card m-monitor-last" data-last-check>
        {last ? (
          summaryLines(last, now).map((l, i) => (
            <div key={i} class={i === 0 ? 'm-monitor-last-head' : 'm-muted m-small'}>
              {l}
            </div>
          ))
        ) : (
          <div class="m-muted m-small">
            {status && status.lastError ? t('monitor.settings.failed', { error: status.lastError }) : t('monitor.settings.never')}
          </div>
        )}
        {nextLine(next, s.enabled, now) && <div class="m-muted m-small">{cap(nextLine(next, s.enabled, now))}</div>}
      </div>
      {perm && perm !== 'granted' && (
        <div class="m-hint-warn" role="status">
          {t('monitor.settings.notifyOff')}
          {perm === 'prompt' && (
            <div>
              <button type="button" class="m-btn m-btn-secondary m-btn-sm" onClick={allow}>
                {t('monitor.settings.allowNotify')}
              </button>
            </div>
          )}
        </div>
      )}
      <div class="m-hint-warn">{t('monitor.settings.batteryNote')}</div>
      {hoursOpen && (
        <Sheet label={t('monitor.settings.howOften')} onClose={() => setHoursOpen(false)}>
          <div class="m-sheet-title">{t('monitor.settings.howOften')}</div>
          <div class="m-sub-pick" role="radiogroup" aria-label={t('monitor.settings.howOften')}>
            {MONITOR_HOURS.map((h) => (
              <button
                key={h}
                type="button"
                role="radio"
                aria-checked={s.hours === h}
                class="m-opt"
                onClick={() => {
                  change({ hours: h });
                  setHoursOpen(false);
                }}
              >
                <span class="m-opt-name m-grow">{hoursText(h)}</span>
                {s.hours === h && <Icon d={CHECK} size={20} />}
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </div>
  );
}
