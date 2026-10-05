import { useState } from 'preact/hooks';
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

const FILTERS: { id: LogFilter; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'errors', label: 'Ошибки' },
  { id: 'monitor', label: 'Мониторинг' },
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
  confirm: (t) => window.confirm(t),
  phoneName: () => native.phoneName().then((n) => (n && n !== 'Телефон' ? n : null)),
};

export let actions: LogActions = defaults;

/** Replaces side effects (tests); null restores the real ones. */
export function setLogActions(a: Partial<LogActions> | null): void {
  actions = a ? { ...defaults, ...a } : defaults;
}

async function deviceInfo(): Promise<LogInfo> {
  const info = currentLogInfo('Телефон');
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
  showToast(copied ? 'Журнал скопирован' : 'Не удалось скопировать журнал');
}

export async function shareLog(): Promise<void> {
  const info = await deviceInfo();
  try {
    await actions.shareText({ name: 'omp-журнал-' + logDate(Date.now()) + '.txt', text: formatLog(info), title: 'Поделиться журналом' });
  } catch (e) {
    showToast(e && typeof (e as Error).message === 'string' ? (e as Error).message : 'Не удалось поделиться журналом');
  }
}

export function clearWithConfirm(): void {
  if (!actions.confirm('Очистить журнал?')) return;
  clearLog();
  showToast('Журнал очищен');
}

export function Log() {
  void logVersion.value; // re-render on new entries
  const [filter, setFilter] = useState<LogFilter>('all');
  const rows = filterEntries(logEntries(), filter).reverse();

  return (
    <div class="m-screen" data-route="log">
      <div class="m-bar">
        <button type="button" class="m-icon-btn" aria-label="Назад" onClick={() => goBack()}>
          <Icon d="M15 5l-7 7 7 7" />
        </button>
        <h1 class="m-bar-title">Журнал ошибок</h1>
      </div>
      <p class="m-muted m-small">Последние 500 записей, только на этом телефоне. Без паролей, cookie, адресов серверов и названий раздач.</p>
      <button type="button" class="m-btn m-btn-primary" onClick={() => void reportToGithub()}>
        Сообщить об ошибке на GitHub
      </button>
      <p class="m-muted m-small">Откроется новая задача в репозитории OMP с версией и устройством; журнал скопируется — вставьте его в текст задачи.</p>
      <div class="m-log-actions">
        <button type="button" class="m-btn m-btn-secondary" onClick={() => void shareLog()}>
          Поделиться журналом
        </button>
        <button type="button" class="m-btn m-btn-secondary" onClick={clearWithConfirm}>
          Очистить
        </button>
      </div>
      <div class="m-chips" role="tablist">
        {FILTERS.map((f) => (
          <button type="button" role="tab" aria-selected={filter === f.id} class={'m-chip' + (filter === f.id ? ' on' : '')} key={f.id} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <p class="m-muted">Записей нет.</p>
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
