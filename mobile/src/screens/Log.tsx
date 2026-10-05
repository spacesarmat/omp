import { useState } from 'preact/hooks';
import { t } from '../../../src/i18n';
import { ru } from '../../../src/i18n/ru';
import { Clipboard } from '@capacitor/clipboard';
import { Icon } from '../ui/Icon';
import { showToast } from '../ui/toast';
import { goBack } from '../nav';
import { native } from '../platform/native';
import {
  areaLabel,
  levelLabel,
  clearLog,
  currentLogInfo,
  formatLog,
  githubIssueUrl,
  logDate,
  logEntries,
  logTime,
  logVersion,
  type LogEntry,
  type LogInfo,
} from '../../../src/lib/log';

export type LogFilter = 'all' | 'errors' | 'monitor';

const filters = (): { id: LogFilter; label: string }[] => [
  { id: 'all', label: t('common.all') },
  { id: 'errors', label: t('log.filterErrors') },
  { id: 'monitor', label: t('monitor.title') },
];

export function filterEntries(list: LogEntry[], f: LogFilter): LogEntry[] {
  return list.filter((e) => (f === 'errors' ? e.l === 'error' : f === 'monitor' ? e.a === 'monitor' : true));
}

export interface LogActions {
  copyText: (text: string) => Promise<void>;
  openUrl: (url: string) => void;
  shareText: (o: { name: string; text: string; title?: string }) => Promise<void>;
  confirm: (text: string) => boolean;
  /** Phone model; null when unknown. */
  phoneName: () => Promise<string | null>;
}

const defaults: LogActions = {
  copyText: (text) => Clipboard.write({ string: text }),
  openUrl: (url) => {
    window.open(url, '_system');
  },
  shareText: (o) => native.shareText(o),
  confirm: (text) => window.confirm(text),
  phoneName: () => native.phoneName().then((n) => (n && n !== ru.history.phone && n !== t('history.phone') ? n : null)),
};

export let actions: LogActions = defaults;

/** Replaces side effects (tests); null restores the real ones. */
export function setLogActions(a: Partial<LogActions> | null): void {
  actions = a ? { ...defaults, ...a } : defaults;
}

async function deviceInfo(): Promise<LogInfo> {
  const info = currentLogInfo(t('history.phone'));
  const model = await actions.phoneName().catch(() => null);
  if (model) info.model = model;
  return info;
}

/** «Сообщить об ошибке на GitHub»: the whole log goes to the clipboard, the new issue opens with the short version. */
export async function reportToGithub(): Promise<void> {
  const info = await deviceInfo();
  let copied = true;
  try {
    await actions.copyText(formatLog(info));
  } catch {
    copied = false;
  }
  actions.openUrl(githubIssueUrl(info, copied));
  showToast(copied ? t('log.toastCopied') : t('log.toastNotCopied'));
}

export async function shareLog(): Promise<void> {
  const info = await deviceInfo();
  try {
    await actions.shareText({ name: t('log.fileName', { date: logDate(Date.now()) }), text: formatLog(info), title: t('log.share') });
  } catch (e) {
    showToast(e && typeof (e as Error).message === 'string' ? (e as Error).message : t('log.shareFailed'));
  }
}

export function clearWithConfirm(): void {
  if (!actions.confirm(t('tvSettings.clearLogAsk'))) return;
  clearLog();
  showToast(t('log.cleared'));
}

export function Log() {
  void logVersion.value; // re-render on new entries
  const [filter, setFilter] = useState<LogFilter>('all');
  const rows = filterEntries(logEntries(), filter).reverse();

  return (
    <div class="m-screen" data-route="log">
      <div class="m-bar">
        <button type="button" class="m-icon-btn" aria-label={t('common.back')} onClick={() => goBack()}>
          <Icon d="M15 5l-7 7 7 7" />
        </button>
        <h1 class="m-bar-title">{t('log.screenTitle')}</h1>
      </div>
      <p class="m-muted m-small">{t('log.keepNote')}</p>
      <button type="button" class="m-btn m-btn-primary" onClick={() => void reportToGithub()}>
        {t('log.report')}
      </button>
      <p class="m-muted m-small">{t('log.reportNote')}</p>
      <div class="m-log-actions">
        <button type="button" class="m-btn m-btn-secondary" onClick={() => void shareLog()}>
          {t('log.share')}
        </button>
        <button type="button" class="m-btn m-btn-secondary" onClick={clearWithConfirm}>
          {t('tvSettings.clear')}
        </button>
      </div>
      <div class="m-chips" role="tablist">
        {filters().map((f) => (
          <button type="button" role="tab" aria-selected={filter === f.id} class={'m-chip' + (filter === f.id ? ' on' : '')} key={f.id} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <p class="m-muted">{t('log.empty')}</p>
      ) : (
        <div class="m-log-list">
          {rows.map((e, i) => (
            <div class={'m-log-row ' + e.l} key={e.t + ':' + i}>
              <div class="m-log-meta">
                <span class="m-log-level">{levelLabel(e.l)}</span> {logTime(e.t)} · {areaLabel(e.a)}
              </div>
              <div class="m-log-text">{e.x}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
