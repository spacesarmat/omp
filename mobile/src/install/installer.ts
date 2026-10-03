// Install assistant: installing OMP from the phone (android/.../install/*). LG in Developer Mode over SSH with the
// Key Server passphrase (optionally Homebrew Channel too), Android TV over adb on port 5555. The plugin downloads the
// release from GitHub, checks it and reports phases; this module turns them into one progress bar, Russian texts and
// error messages with the next step. The passphrase is passed through once and never stored or logged.
import type { PluginListenerHandle } from '@capacitor/core';
import { rawPlugin, ONLY_ANDROID } from '../platform/native';

export type InstallMethod = 'lg-devmode' | 'atv-adb';
export type InstallPhase = 'download' | 'verify' | 'connect' | 'upload' | 'install';
export type InstallItem = 'omp' | 'hbc';

export interface InstallRequest {
  method: InstallMethod;
  ip: string;
  /** LG: the code from the Developer Mode app (Key Server). */
  passphrase?: string;
  /** LG: install Homebrew Channel after OMP. */
  withHbc?: boolean;
}

export interface InstallEvent {
  phase: InstallPhase;
  item: InstallItem;
  /** 0..100 within the phase; absent when unknown. */
  percent?: number;
  version?: string;
}

export interface InstallResult {
  version: string;
  hbcVersion?: string;
  /** Why Homebrew Channel was not installed (OMP is installed anyway). */
  hbcError?: string;
  sdkInt?: number;
  abi?: string;
}

/** A failed install: `code` from the plugin (InstallCodes in Kotlin). */
export class InstallError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

/** The plugin methods used here (registered by mobile/src/platform/native.ts). */
export interface InstallerPlugin {
  installStart(o: { method: string; ip: string; passphrase?: string; withHbc?: boolean }): Promise<Record<string, unknown>>;
  installCancel(): Promise<unknown>;
  devModeReminder(o: { tv: string; name?: string; at: number | null }): Promise<unknown>;
  devModeReminderState(o: { tv: string }): Promise<{ at?: unknown }>;
  addListener(event: 'installProgress', cb: (e: Record<string, unknown>) => void): Promise<PluginListenerHandle>;
}

export interface InstallerNative {
  available: boolean;
  start(req: InstallRequest, onEvent: (e: InstallEvent) => void): Promise<InstallResult>;
  cancel(): Promise<void>;
  /** Schedules the Developer Mode reminder for one TV (its IP) at `at` (unix ms); null cancels it. */
  reminder(tv: string, at: number | null, name?: string): Promise<void>;
  /** When the reminder for that TV is due (unix ms); null when none is scheduled or unknown. */
  reminderState(tv: string): Promise<number | null>;
}

const PHASES: InstallPhase[] = ['download', 'verify', 'connect', 'upload', 'install'];

function event(e: Record<string, unknown> | null | undefined): InstallEvent | null {
  if (!e || PHASES.indexOf(e.phase as InstallPhase) < 0) return null;
  const out: InstallEvent = { phase: e.phase as InstallPhase, item: e.item === 'hbc' ? 'hbc' : 'omp' };
  if (typeof e.percent === 'number' && isFinite(e.percent)) out.percent = Math.max(0, Math.min(100, Math.round(e.percent)));
  if (typeof e.version === 'string' && e.version) out.version = e.version;
  return out;
}

function result(r: Record<string, unknown> | null | undefined): InstallResult {
  const o = r || {};
  const out: InstallResult = { version: typeof o.version === 'string' ? o.version : '' };
  if (typeof o.hbcVersion === 'string' && o.hbcVersion) out.hbcVersion = o.hbcVersion;
  if (typeof o.hbcError === 'string' && o.hbcError) out.hbcError = o.hbcError;
  if (typeof o.sdkInt === 'number') out.sdkInt = o.sdkInt;
  if (typeof o.abi === 'string' && o.abi) out.abi = o.abi;
  return out;
}

function codeOf(e: unknown): string {
  const c = e && typeof e === 'object' ? (e as { code?: unknown; message?: unknown }) : null;
  if (c && typeof c.code === 'string' && c.code) return c.code;
  if (c && typeof c.message === 'string' && /^[a-z-]{3,24}$/.test(c.message)) return c.message;
  return 'unknown';
}

export function createInstallerNative(plugin: InstallerPlugin | null): InstallerNative {
  // «Отмена» while the listener is being added: the native install has not started yet, so it must not start at all
  let cancelRequested = false;
  return {
    available: !!plugin,
    async start(req, onEvent) {
      if (!plugin) throw new Error(ONLY_ANDROID);
      cancelRequested = false;
      // awaited so that no early event is missed
      const handle = await plugin.addListener('installProgress', (e) => {
        const ev = event(e);
        if (ev) onEvent(ev);
      });
      if (cancelRequested) {
        void handle.remove();
        throw new InstallError('cancelled');
      }
      try {
        const o: { method: string; ip: string; passphrase?: string; withHbc?: boolean } = { method: req.method, ip: req.ip };
        if (req.passphrase !== undefined) o.passphrase = req.passphrase;
        if (req.withHbc !== undefined) o.withHbc = req.withHbc;
        return result(await plugin.installStart(o));
      } catch (e) {
        throw new InstallError(codeOf(e));
      } finally {
        void handle.remove();
      }
    },
    cancel() {
      cancelRequested = true;
      return plugin ? plugin.installCancel().then(() => undefined, () => undefined) : Promise.resolve();
    },
    reminder(tv, at, name) {
      if (!plugin) return Promise.reject(new Error(ONLY_ANDROID));
      const o: { tv: string; name?: string; at: number | null } = { tv, at };
      if (name) o.name = name;
      return plugin.devModeReminder(o).then(() => undefined);
    },
    reminderState(tv) {
      if (!plugin) return Promise.resolve(null);
      return plugin.devModeReminderState({ tv }).then(
        (r) => (typeof r?.at === 'number' && isFinite(r.at) && r.at > 0 ? r.at : null),
        () => null,
      );
    },
  };
}

let impl: InstallerNative = createInstallerNative(rawPlugin() as InstallerPlugin | null);

/** Replaces the native installer (tests); null restores the real plugin. */
export function setInstallerNative(n: InstallerNative | null): void {
  impl = n ?? createInstallerNative(rawPlugin() as InstallerPlugin | null);
}

export function installerNative(): InstallerNative {
  return impl;
}

// ---- progress ----

interface Stage {
  phase: InstallPhase;
  item: InstallItem;
  weight: number;
  /** connect before (key check / adb authorization) or after the download (SSH). */
  late?: boolean;
}

function stages(method: InstallMethod, withHbc: boolean): Stage[] {
  if (method === 'atv-adb') {
    return [
      { phase: 'connect', item: 'omp', weight: 5 },
      { phase: 'download', item: 'omp', weight: 45 },
      { phase: 'verify', item: 'omp', weight: 3 },
      { phase: 'upload', item: 'omp', weight: 37 },
      { phase: 'install', item: 'omp', weight: 10 },
    ];
  }
  const list: Stage[] = [
    { phase: 'connect', item: 'omp', weight: 4 },
    { phase: 'download', item: 'omp', weight: 20 },
    { phase: 'verify', item: 'omp', weight: 2 },
  ];
  if (withHbc) list.push({ phase: 'download', item: 'hbc', weight: 8 }, { phase: 'verify', item: 'hbc', weight: 1 });
  list.push({ phase: 'connect', item: 'omp', weight: 3, late: true }, { phase: 'upload', item: 'omp', weight: 25 }, { phase: 'install', item: 'omp', weight: 15 });
  if (withHbc) list.push({ phase: 'upload', item: 'hbc', weight: 12 }, { phase: 'install', item: 'hbc', weight: 10 });
  return list;
}

export interface ProgressView {
  /** 0..100 over the whole install, never going back. */
  percent: number;
  title: string;
  text: string;
}

/** Folds the plugin events into one progress bar and a line of text (mockup AssistInstall). */
export function createProgress(method: InstallMethod, withHbc: boolean): (e: InstallEvent) => ProgressView {
  const list = stages(method, withHbc);
  const total = list.reduce((s, x) => s + x.weight, 0);
  let downloaded = false;
  let best = 0;
  let version = '';
  return (e) => {
    if (e.phase === 'download') downloaded = true;
    if (e.item === 'omp' && e.version) version = e.version;
    const late = e.phase === 'connect' && downloaded;
    let i = list.findIndex((s) => s.phase === e.phase && s.item === e.item && !!s.late === late);
    if (i < 0) i = list.findIndex((s) => s.phase === e.phase);
    if (i >= 0) {
      const before = list.slice(0, i).reduce((s, x) => s + x.weight, 0);
      const within = (list[i].weight * (e.percent ?? 0)) / 100;
      best = Math.max(best, Math.round(((before + within) / total) * 100));
    }
    return { percent: Math.min(best, 100), title: version ? 'Устанавливаю OMP ' + version : 'Устанавливаю OMP', text: phaseText(method, e, late) };
  };
}

function phaseText(method: InstallMethod, e: InstallEvent, late: boolean): string {
  const hbc = e.item === 'hbc';
  switch (e.phase) {
    case 'connect':
      if (late) return 'Скачано с GitHub, проверено · подключаюсь к телевизору';
      return method === 'lg-devmode' ? 'Проверяю код на телевизоре' : 'Подключаюсь к телевизору';
    case 'download':
      return (hbc ? 'Скачиваю Homebrew Channel с GitHub' : 'Скачиваю OMP с GitHub') + (e.percent !== undefined ? ' · ' + e.percent + '%' : '');
    case 'verify':
      return 'Скачано с GitHub · проверяю файл';
    case 'upload':
      return hbc ? 'Homebrew Channel · передаю на телевизор' : 'Скачано с GitHub, проверено · передаю на телевизор';
    case 'install':
      return hbc ? 'Телевизор устанавливает Homebrew Channel' : 'Телевизор устанавливает OMP';
  }
}

// ---- errors ----

const ERRORS: { [code: string]: string } = {
  network: 'Не удалось скачать OMP с GitHub. Проверьте интернет на телефоне и повторите.',
  release: 'Не удалось получить с GitHub сведения о последней версии. Повторите позже.',
  checksum: 'Скачанный файл не прошёл проверку контрольной суммы. Повторите установку.',
  'too-big': 'Файл релиза больше допустимого — установка остановлена. Повторите позже.',
  'phone-space': 'На телефоне не хватает места для скачивания. Освободите место и повторите.',
  'key-server': 'Телевизор не отдал ключ. Откройте на ТВ Developer Mode, включите Key Server и повторите.',
  'wrong-passphrase': 'Код не подошёл. Введите код (Passphrase) с экрана Developer Mode ещё раз — буквы и цифры как на экране.',
  'ssh-closed':
    'Телевизор не принимает подключение (порт 9922). Включите Dev Mode Status в приложении Developer Mode. Если срок режима разработчика истёк, войдите в приложение и включите режим снова.',
  'ssh-auth': 'Телевизор не принял ключ. В Developer Mode выключите и снова включите Key Server и введите новый код.',
  'low-space': 'На телевизоре не хватает места. Удалите ненужные приложения и повторите.',
  'install-failed': 'Телевизор отказался устанавливать пакет. Повторите; если не получится — установите по инструкции.',
  signature: 'На приставке стоит OMP с другой подписью. Удалите его в настройках приставки и повторите.',
  abi: 'Эта приставка не подходит для OMP (другая архитектура процессора).',
  'old-android': 'Версия Android на приставке слишком старая для OMP.',
  'adb-closed':
    'Приставка не отвечает на порту 5555. Включите «Отладка по сети» в разделе «Для разработчиков» и повторите. Если на Android 11 и новее есть только «Беспроводная отладка» с кодом, установка с телефона пока не работает — скачайте APK и установите по инструкции.',
  unauthorized: 'Приставка отклонила подключение телефона. Нажмите «Повторить» и на телевизоре выберите «Разрешить» (можно отметить «Всегда разрешать»).',
  'auth-timeout': 'Телевизор не дождался ответа на «Разрешить отладку?». Нажмите «Повторить» и на телевизоре выберите «Разрешить».',
  unreachable: 'Телевизор не отвечает — проверьте IP и что он включён и в той же сети, затем повторите.',
  timeout: 'Телевизор перестал отвечать. Проверьте, что он включён и в той же сети, и повторите.',
  connection: 'Связь с телевизором прервалась. Проверьте сеть и повторите.',
  cancelled: 'Установка отменена.',
  busy: 'Установка уже идёт.',
};

/** Russian text with the next step for an error code. */
export function errorText(code: string): string {
  return ERRORS[code] || 'Не удалось установить OMP. Повторите попытку.';
}

/** Homebrew Channel was skipped: why, briefly. */
export function hbcErrorText(code: string): string {
  if (code === 'checksum') return 'Homebrew Channel не установлен: файл не прошёл проверку. Его можно поставить позже.';
  if (code === 'network' || code === 'release') return 'Homebrew Channel не установлен: не удалось скачать его с GitHub. Его можно поставить позже.';
  if (code === 'low-space') return 'Homebrew Channel не установлен: на телевизоре не хватает места.';
  return 'Homebrew Channel не установлен. Его можно поставить позже.';
}

// ---- Developer Mode reminder ----

const HOUR = 3600 * 1000;
/** Developer Mode lasts 1000 hours; the reminder comes 3 days before the end. */
export const DEVMODE_HOURS = 1000;
export const REMINDER_BEFORE_HOURS = 72;

export function reminderAt(installedAt: number): number {
  return installedAt + (DEVMODE_HOURS - REMINDER_BEFORE_HOURS) * HOUR;
}
