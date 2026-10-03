// Install assistant (phone): device facts -> the steps for that model. Pure: no I/O, no platform imports.
import { compareVersions } from './version';

/** App ids the phone looks for in the LG app list (ssap listApps). */
export const LG_OMP_APP_ID = 'com.spacesarmat.torrplayer';
export const LG_HBC_APP_ID = 'org.webosbrew.hbchannel';
export const LG_DEVMODE_APP_ID = 'com.palmdts.devmode';

/** Developer Mode ports on an LG TV: SSH (open while Dev Mode Status is on) and Key Server. */
export const LG_SSH_PORT = 9922;
export const LG_KEY_SERVER_PORT = 9991;
/** adb over the network on Android TV (Android 10 and older; 11+ pairs on a port shown on the TV). */
export const ADB_PORT = 5555;

/** The same rooting check the FAQ links to. */
export const ROOT_CHECK_URL = 'https://cani.rootmy.tv';
export const LG_DEV_ACCOUNT_URL = 'https://webostv.developer.lge.com';

/** FAQ questions the assistant links to (must match mobile/src/faq.ts exactly). */
export const FAQ_LG_DEVMODE = 'Как установить OMP на LG без root (Developer Mode)?';
export const FAQ_LG_HBC = 'Как установить OMP на LG через Homebrew Channel (с root)?';
export const FAQ_LG_ROOT = 'Нужен ли root для установки OMP на LG?';
export const FAQ_LG_VERSION = 'Подойдёт ли мой телевизор LG и как узнать версию webOS?';
export const FAQ_ATV_ADB = 'Как установить OMP на Android TV через adb?';
export const FAQ_ATV_BOXES = 'На каких приставках работает OMP и встроенный TorrServer?';
export const FAQ_SAMSUNG = 'Есть ли OMP для Samsung (Tizen)?';

// ---- webOS version ----

export interface WebOsVersion {
  /** «webOS 4.5», «webOS 22». */
  label: string;
  /** Ordered: 2, 3, 3.5, 4, 4.5, 5, 6, then the year names 22, 23, 24, 25… */
  rank: number;
}

/** First webOS OMP runs on. */
export const MIN_WEBOS_RANK = 4;

/** Model year (two digits) -> webOS that LG shipped that year; 2022+ use the year names. */
const YEAR_WEBOS: { [year: number]: string } = {
  14: '1.0',
  15: '2.0',
  16: '3.0',
  17: '3.5',
  18: '4.0',
  19: '4.5',
  20: '5.0',
  21: '6.0',
};

/** webOS 22, 23, 24, 25… report platform major 7, 8, 9, 10… in product_name. */
const MAJOR_YEAR_BASE = 15;

function fromYear(year: number): WebOsVersion | null {
  const v = YEAR_WEBOS[year];
  if (v) return { label: 'webOS ' + v, rank: parseFloat(v) };
  if (year >= 22 && year < 60) return { label: 'webOS ' + year, rank: year };
  return null;
}

/** «4.5» -> webOS 4.5; «7.0» … «21.x» (platform majors of 2022+) -> webOS 22 …; «23» (year name) -> webOS 23. */
function fromProductNumber(s: string): WebOsVersion | null {
  const n = parseFloat(s);
  if (!isFinite(n) || n <= 0) return null;
  const major = Math.floor(n);
  if (major >= 7 && major < 22) return fromYear(major + MAJOR_YEAR_BASE);
  if (major >= 22 && major < 60) return fromYear(major);
  return { label: 'webOS ' + s, rank: n };
}

/** Model year from an LG retail model: OLED55C1… -> 21, OLED65CX… -> 20, 43UM7300… -> 19. Null when unknown. */
export function lgModelYear(model: string | undefined): number | null {
  const m = (model || '').trim().toUpperCase();
  const oled = /^OLED\d{2}[A-Z]([0-9X])/.exec(m);
  if (oled) {
    const c = oled[1];
    if (c === 'X') return 20;
    const d = parseInt(c, 10);
    if (d >= 6) return 10 + d;
    if (d >= 1) return 20 + d;
    return null;
  }
  const lcd = /^\d{2}(U[HJKMNPQRT])\d/.exec(m);
  if (lcd) {
    const years: { [k: string]: number } = { UH: 16, UJ: 17, UK: 18, UM: 19, UN: 20, UP: 21, UQ: 22, UR: 23, UT: 24 };
    return years[lcd[1]] || null;
  }
  return null;
}

/**
 * webOS version from what the TV reports, most reliable first: getCurrentSWInformation `product_name` («webOSTV 4.5»,
 * «webOSTV 7.0» = webOS 22; reflects webOS Re:New upgrades), its firmware code `model_name` (HE_DTV_W21O_… -> 2021 ->
 * 6.0), and as a last resort the year of the retail model (OLED55C1 -> 2021; marked «по году модели»: needs no
 * extra permission, so it works on TVs paired without the signed manifest). Null when nothing is recognised.
 */
export function parseWebOs(src: { productName?: string; swModel?: string; model?: string }): WebOsVersion | null {
  const product = /webos\s*(?:tv)?\s*(\d+(?:\.\d+)?)/i.exec(src.productName || '');
  if (product) {
    const v = fromProductNumber(product[1]);
    if (v) return v;
  }
  const code = /(?:^|_)W(\d{2})[A-Z]/.exec(src.swModel || '');
  if (code) {
    const v = fromYear(parseInt(code[1], 10));
    if (v) return v;
  }
  const year = lgModelYear(src.model);
  if (year !== null) {
    const v = fromYear(year);
    if (v) return { label: v.label + ' (по году модели)', rank: v.rank };
  }
  return null;
}

// ---- Android version ----

const ANDROID_BY_SDK: { [sdk: number]: string } = {
  26: '8',
  27: '8.1',
  28: '9',
  29: '10',
  30: '11',
  31: '12',
  32: '12L',
  33: '13',
  34: '14',
  35: '15',
  36: '16',
};

/** «Android 12» for API 31; null when unknown. */
export function androidLabel(sdkInt: number | undefined): string | null {
  if (typeof sdkInt !== 'number' || !isFinite(sdkInt) || sdkInt <= 0) return null;
  const name = ANDROID_BY_SDK[sdkInt];
  if (name) return 'Android ' + name;
  return sdkInt > 36 ? 'Android (API ' + sdkInt + ')' : null;
}

/** Android 11 (API 30) brought «Беспроводная отладка» with pairing by code. */
export const WIRELESS_DEBUG_SDK = 30;

/** True for 64-bit ARM (the embedded TorrServer is built only for arm64). */
export function isArm64(abi: string | undefined): boolean {
  return !!abi && /^arm64|aarch64/i.test(abi.trim());
}

// ---- device facts ----

export interface LgFacts {
  kind: 'lg';
  name: string;
  ip: string;
  /** SSDP / getSystemInfo model, e.g. «OLED55C1RLA». */
  model?: string;
  /** getCurrentSWInformation `product_name`, e.g. «webOSTV 6.0». */
  productName?: string;
  /** getCurrentSWInformation `model_name`, e.g. «HE_DTV_W21O_AFABATAA». */
  swModel?: string;
  /** The phone is paired over SSAP: the app list below is real. False = only discovery data. */
  paired: boolean;
  /** Installed app ids (listApps); undefined when the list is unavailable. */
  apps?: string[];
  /** OMP on the TV: version; null = not installed; undefined = unknown. */
  ompVersion?: string | null;
  /** Developer Mode ports that answered (LG_SSH_PORT, LG_KEY_SERVER_PORT); undefined = not checked. */
  openPorts?: number[];
  /** Newest OMP for webOS from the update feed; null/undefined when unavailable. */
  latest?: string | null;
  /** Why pairing failed (shown on the pairing step). */
  error?: string;
}

export interface AtvFacts {
  kind: 'atv';
  name: string;
  ip: string;
  /** Model from the cast TXT record `md` (e.g. «Chromecast HD», «BRAVIA 4K VH2»). */
  model?: string;
  /** 'chromecast' = a Chromecast without Google TV (cannot install apps). */
  cast?: 'tv' | 'chromecast';
  /** OMP on the box: version; null = not installed; undefined = unknown. */
  ompVersion?: string | null;
  /** Android API level (learned over adb by the installer); undefined = unknown. */
  sdkInt?: number;
  /** Primary ABI, e.g. «arm64-v8a» (learned over adb); undefined = unknown. */
  abi?: string;
  /** Newest OMP APK from the update feed. */
  latest?: string | null;
}

export interface SamsungFacts {
  kind: 'samsung';
  name: string;
  ip: string;
  model?: string;
}

export type DeviceFacts = LgFacts | AtvFacts | SamsungFacts;

// ---- plan ----

export type PlanKind =
  | 'lg-pair'
  | 'lg-unsupported'
  | 'lg-update'
  | 'lg-hbc'
  | 'lg-devmode'
  | 'atv-installed'
  | 'atv-adb'
  | 'atv-unsupported'
  | 'samsung-unsupported';

export type StepState = 'done' | 'current' | 'todo';

export interface PlanStep {
  id: string;
  title: string;
  text: string;
  state: StepState;
}

/**
 * pair — connect over SSAP (LG); update-on-tv — open the OMP update screen on the TV; open-hbc — open Homebrew
 * Channel on the TV with the OMP repository; install — install from the phone (Task 7 installers); recheck — collect
 * the facts again; faq — open a FAQ question; link — open an external page.
 */
export type ActionId = 'pair' | 'update-on-tv' | 'open-hbc' | 'install' | 'recheck' | 'faq' | 'link';

export interface PlanAction {
  id: ActionId;
  label: string;
  primary?: boolean;
  /** 'link': the page. */
  url?: string;
  /** 'faq': the question to open. */
  faq?: string;
}

/** What the phone installer needs (Task 7). */
export type InstallTarget =
  /** Key Server (LG_KEY_SERVER_PORT) gives the SSH key for the passphrase; SSH LG_SSH_PORT as prisoner; ipk install. */
  | { method: 'lg-devmode'; ip: string; withHbc: boolean }
  /**
   * adb over the network: `wireless` true = Android 11+ pairing by code and port (shown on the TV), false = plain
   * TCP ADB_PORT, null = unknown (try ADB_PORT, offer pairing).
   */
  | { method: 'atv-adb'; ip: string; wireless: boolean | null };

export interface InstallPlan {
  kind: PlanKind;
  title: string;
  /** «OLED55C1 · webOS 6.0 · без root — ставим через режим разработчика». */
  subtitle: string;
  steps: PlanStep[];
  actions: PlanAction[];
  notes: string[];
  /** OMP found on the device. */
  installed?: string;
  latest?: string | null;
  needsUpdate?: boolean;
  /** Present when the phone can install OMP on this device itself. */
  install?: InstallTarget;
  webos?: WebOsVersion | null;
}

function has(list: string[] | undefined, id: string): boolean {
  return !!list && list.indexOf(id) >= 0;
}

/** Marks the first step that is not done as current; the rest stay todo. */
function withProgress(steps: Array<{ id: string; title: string; text: string; done: boolean }>): PlanStep[] {
  let current = false;
  return steps.map((s) => {
    let state: StepState = 'todo';
    if (s.done) state = 'done';
    else if (!current) {
      state = 'current';
      current = true;
    }
    return { id: s.id, title: s.title, text: s.text, state };
  });
}

function join(parts: Array<string | null | undefined>): string {
  return parts.filter((p) => !!p).join(' · ');
}

function needsUpdate(installed: string, latest: string | null | undefined): boolean {
  return !!latest && compareVersions(latest, installed) > 0;
}

function versionText(installed: string, latest: string | null | undefined): string {
  if (needsUpdate(installed, latest)) return 'Версия ' + installed + ' — есть ' + latest;
  return 'Версия ' + installed + (latest ? ' — последняя версия' : '');
}

const DEVMODE_TIMER_NOTE =
  'Режим разработчика действует 1000 часов (около 40 дней). Продлевайте его заранее в приложении Developer Mode, иначе OMP удалится с ТВ.';

function lgPlan(f: LgFacts): InstallPlan {
  const webos = parseWebOs(f);
  const base = { title: f.name, webos };
  const model = f.model || null;
  const label = webos ? webos.label : null;

  if (!f.paired) {
    const notes: string[] = [];
    if (f.error) notes.push(f.error);
    return {
      ...base,
      kind: 'lg-pair',
      subtitle: join([model, label, 'нужно подключение к ТВ']),
      steps: [
        {
          id: 'pair',
          title: 'Подключение к телевизору',
          text: 'Телефон узнает модель, версию webOS и установленные приложения. На экране ТВ нажмите «Разрешить».',
          state: 'current',
        },
      ],
      actions: [
        { id: 'pair', label: f.error ? 'Подключиться снова' : 'Подключиться', primary: true },
        { id: 'faq', label: 'Как установить без подключения', faq: FAQ_LG_DEVMODE },
      ],
      notes,
    };
  }

  if (webos && webos.rank < MIN_WEBOS_RANK) {
    return {
      ...base,
      kind: 'lg-unsupported',
      subtitle: join([model, label, 'не поддерживается']),
      steps: [],
      actions: [{ id: 'faq', label: 'Какие телевизоры подходят', faq: FAQ_LG_VERSION }],
      notes: ['OMP нужен webOS 4.0 или новее — это примерно телевизоры 2018 года и новее. На ' + webos.label + ' OMP не работает.'],
    };
  }

  const notes: string[] = [];
  if (!webos) notes.push('Не удалось узнать версию webOS. OMP нужен webOS 4.0 или новее.');
  const hbc = has(f.apps, LG_HBC_APP_ID);
  const devApp = has(f.apps, LG_DEVMODE_APP_ID);
  const ports = f.openPorts;
  const ssh = !!ports && ports.indexOf(LG_SSH_PORT) >= 0;
  const keyServer = !!ports && ports.indexOf(LG_KEY_SERVER_PORT) >= 0;

  if (typeof f.ompVersion === 'string') {
    // '' = OMP is in the app list without a version
    const installed = f.ompVersion;
    const old = !!installed && needsUpdate(installed, f.latest);
    if (devApp && !hbc) notes.push(DEVMODE_TIMER_NOTE);
    return {
      ...base,
      kind: 'lg-update',
      subtitle: join([model, label, installed ? 'OMP ' + installed : 'OMP установлен']),
      steps: [
        { id: 'omp', title: 'OMP установлен', text: installed ? versionText(installed, f.latest) : 'Версия неизвестна', state: 'done' },
      ],
      actions: old ? [{ id: 'update-on-tv', label: 'Обновить на ТВ', primary: true }] : [],
      notes,
      installed: installed || undefined,
      latest: f.latest,
      needsUpdate: old,
    };
  }

  if (hbc) {
    return {
      ...base,
      kind: 'lg-hbc',
      subtitle: join([model, label, 'есть Homebrew Channel']),
      steps: [
        { id: 'hbc', title: 'Homebrew Channel', text: 'Установлен на телевизоре', state: 'done' },
        {
          id: 'repo',
          title: 'Репозиторий OMP',
          text: 'Кнопка ниже откроет Homebrew Channel на ТВ и предложит добавить репозиторий OMP — подтвердите пультом.',
          state: 'current',
        },
        { id: 'install', title: 'Установка', text: 'В Homebrew Channel найдите OMP и нажмите «Install».', state: 'todo' },
      ],
      actions: [
        { id: 'open-hbc', label: 'Открыть Homebrew Channel на ТВ', primary: true },
        ...(ssh ? [{ id: 'install' as const, label: 'Установить OMP с телефона' }] : []),
        { id: 'faq', label: 'Подробнее о Homebrew Channel', faq: FAQ_LG_HBC },
      ],
      notes,
      install: ssh ? { method: 'lg-devmode', ip: f.ip, withHbc: false } : undefined,
    };
  }

  const steps = withProgress([
    {
      id: 'account',
      title: 'Аккаунт разработчика LG',
      text: 'webostv.developer.lge.com — регистрация и подтверждение почты. Один аккаунт работает на одном ТВ одновременно.',
      done: devApp || ssh || keyServer,
    },
    {
      id: 'app',
      title: 'Приложение Developer Mode',
      text: devApp
        ? 'Установлено на ТВ. Войдите в нём в аккаунт разработчика.'
        : 'Установите его на ТВ из LG Content Store и войдите в аккаунт разработчика.',
      done: devApp || ssh || keyServer,
    },
    {
      id: 'status',
      title: 'Dev Mode Status',
      text: ssh ? 'Включён' : 'Включите Dev Mode Status в приложении Developer Mode — ТВ перезагрузится.',
      done: ssh || keyServer,
    },
    {
      id: 'keyserver',
      title: 'Key Server',
      text: keyServer
        ? 'Включён. Телефону понадобится код (Passphrase) с экрана Developer Mode.'
        : 'Снова откройте Developer Mode и включите Key Server. Телефону понадобится код (Passphrase) с его экрана.',
      done: keyServer,
    },
    { id: 'install', title: 'Установка', text: 'Телефон поставит Homebrew Channel и OMP сам.', done: false },
    { id: 'timer', title: 'Таймер 1000 часов', text: DEVMODE_TIMER_NOTE, done: false },
  ]);
  // the timer is a reminder, never the current step
  const timer = steps[steps.length - 1];
  if (timer.state === 'current') timer.state = 'todo';
  // without the app list OMP or Homebrew Channel may already be there: no install until a recheck sees the list
  const appsKnown = f.apps !== undefined;
  if (!appsKnown) {
    notes.push('Не удалось получить список приложений с телевизора — OMP или Homebrew Channel могут быть уже установлены. Нажмите «Проверить снова».');
  }
  return {
    ...base,
    kind: 'lg-devmode',
    subtitle: join([model, label, 'без root — ставим через режим разработчика']),
    steps,
    actions: [
      ...(appsKnown ? [{ id: 'install' as const, label: 'Установить OMP и Homebrew Channel', primary: true }] : []),
      { id: 'recheck', label: 'Проверить снова', primary: !appsKnown },
      { id: 'link', label: 'Можно ли получить root на этой модели', url: ROOT_CHECK_URL },
      { id: 'faq', label: 'Подробная инструкция', faq: FAQ_LG_DEVMODE },
    ],
    notes,
    install: appsKnown ? { method: 'lg-devmode', ip: f.ip, withHbc: true } : undefined,
  };
}

function abiNote(abi: string | undefined): string {
  if (!abi) {
    return 'Встроенный TorrServer работает только на 64-битных приставках (arm64). На других OMP работает с TorrServer на другом устройстве в сети.';
  }
  return isArm64(abi)
    ? 'arm64 — встроенный TorrServer будет работать.'
    : 'Приставка не 64-битная (' + abi + ') — встроенный TorrServer на ней не запустится. OMP будет работать с TorrServer на другом устройстве в сети.';
}

/** Cast reports «Chromecast» both for the old dongles and for Chromecast with Google TV (4K). */
const PLAIN_CHROMECAST_NOTE =
  'Если это Chromecast без Google TV (до 2020 года) — приложения на него не ставятся. Подойдёт Chromecast с Google TV.';

/** Found over cast: TVs with only a built-in Chromecast advertise the same service. */
const CAST_ONLY_NOTE =
  'Установка по adb работает только на Android TV и Google TV. На телевизорах, где есть только встроенный Chromecast (Chromecast built-in), установить OMP нельзя.';

function atvPlan(f: AtvFacts): InstallPlan {
  const model = f.model || 'Android TV';
  const android = androidLabel(f.sdkInt);
  const arch = f.abi ? (isArm64(f.abi) ? 'arm64' : f.abi) : null;

  if (f.cast === 'chromecast' && !f.ompVersion) {
    return {
      kind: 'atv-unsupported',
      title: f.name,
      subtitle: join([model, 'не поддерживается']),
      steps: [],
      actions: [{ id: 'faq', label: 'На каких приставках работает OMP', faq: FAQ_ATV_BOXES }],
      notes: ['Это Chromecast без Google TV: на него нельзя установить приложения. Нужна приставка или телевизор с Android TV / Google TV.'],
    };
  }

  if (typeof f.ompVersion === 'string' && f.ompVersion) {
    const installed = f.ompVersion;
    const old = needsUpdate(installed, f.latest);
    return {
      kind: 'atv-installed',
      title: f.name,
      subtitle: join([model, android, 'OMP ' + installed]),
      steps: [{ id: 'omp', title: 'OMP установлен', text: versionText(installed, f.latest), state: 'done' }],
      actions: old ? [{ id: 'update-on-tv', label: 'Обновить на ТВ', primary: true }] : [],
      notes: f.abi && !isArm64(f.abi) ? [abiNote(f.abi)] : [],
      installed,
      latest: f.latest,
      needsUpdate: old,
    };
  }

  const wireless = typeof f.sdkInt === 'number' ? f.sdkInt >= WIRELESS_DEBUG_SDK : null;
  const debug =
    wireless === true
      ? {
          title: 'Беспроводная отладка',
          text: 'Настройки → Система → Для разработчиков → «Беспроводная отладка» → «Подключить по коду».',
        }
      : wireless === false
        ? {
            title: 'Отладка по сети',
            text: 'Настройки → Система → Для разработчиков → включите «Отладка по сети» (на некоторых приставках — «Отладка по USB»).',
          }
        : {
            title: 'Отладка по сети',
            text: 'Настройки → Система → Для разработчиков → включите «Отладка по сети» (на некоторых приставках — «Отладка по USB»). На Android 11 и новее — «Беспроводная отладка» → «Подключить по коду».',
          };
  return {
    kind: 'atv-adb',
    title: f.name,
    subtitle: join([model, android, arch === 'arm64' ? 'arm64 — встроенный TorrServer будет работать' : arch]),
    steps: withProgress([
      {
        id: 'devopts',
        title: 'Режим разработчика',
        text: 'Настройки → Система → Об устройстве → 7 раз нажмите «Сборка» (названия пунктов зависят от прошивки).',
        done: false,
      },
      { id: 'debug', title: debug.title, text: debug.text, done: false },
      {
        id: 'install',
        title: 'Установка',
        text: 'Телефон скачает OMP с GitHub и поставит его. Если на ТВ появится «Разрешить отладку?» — нажмите «Разрешить».',
        done: false,
      },
    ]),
    actions: [
      { id: 'install', label: 'Установить OMP', primary: true },
      { id: 'faq', label: 'Как установить через компьютер', faq: FAQ_ATV_ADB },
    ],
    notes: (f.cast === 'tv' ? [CAST_ONLY_NOTE] : [])
      .concat(/^chromecast$/i.test((f.model || '').trim()) ? [PLAIN_CHROMECAST_NOTE] : [])
      .concat(arch === 'arm64' ? [] : [abiNote(f.abi)]),
    install: { method: 'atv-adb', ip: f.ip, wireless },
  };
}

/** The steps for one device. */
export function installPlan(f: DeviceFacts): InstallPlan {
  if (f.kind === 'lg') return lgPlan(f);
  if (f.kind === 'atv') return atvPlan(f);
  return {
    kind: 'samsung-unsupported',
    title: f.name,
    subtitle: join([f.model || 'Samsung', 'не поддерживается']),
    steps: [],
    actions: [{ id: 'faq', label: 'Подробнее', faq: FAQ_SAMSUNG }],
    notes: ['Samsung (Tizen) пока не поддерживается. Поддержка запланирована в одном из будущих выпусков.'],
  };
}
