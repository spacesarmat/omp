// Install assistant (phone): device facts -> the steps for that model. Pure: no I/O, no platform imports.
import { compareVersions } from './version';
import { t } from '../i18n';

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

export { FAQ_LG_DEVMODE, FAQ_LG_HBC, FAQ_LG_ROOT, FAQ_LG_VERSION, FAQ_ATV_ADB, FAQ_ATV_BOXES, FAQ_SAMSUNG } from './faqLinks';
import { FAQ_LG_DEVMODE, FAQ_LG_VERSION, FAQ_LG_HBC, FAQ_ATV_ADB, FAQ_ATV_BOXES, FAQ_SAMSUNG } from './faqLinks';

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
    if (v) return { label: t('install.plan.byModelYear', { label: v.label }), rank: v.rank };
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
   * TCP ADB_PORT, null = unknown. The phone installer uses ADB_PORT in all cases (pairing by code is not supported).
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
  if (needsUpdate(installed, latest)) return t('install.plan.versionNewer', { installed, latest: latest || '' });
  return latest ? t('install.plan.versionLatest', { installed }) : t('install.plan.version', { installed });
}

const devmodeTimerNote = () => t('install.plan.timerNote');

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
      subtitle: join([model, label, t('install.plan.needsPairing')]),
      steps: [
        {
          id: 'pair',
          title: t('install.plan.pairTitle'),
          text: t('install.plan.pairText'),
          state: 'current',
        },
      ],
      actions: [
        { id: 'pair', label: f.error ? t('install.plan.pairAgain') : t('install.plan.pair'), primary: true },
        { id: 'faq', label: t('install.plan.pairFaq'), faq: FAQ_LG_DEVMODE },
      ],
      notes,
    };
  }

  if (webos && webos.rank < MIN_WEBOS_RANK) {
    return {
      ...base,
      kind: 'lg-unsupported',
      subtitle: join([model, label, t('install.plan.unsupported')]),
      steps: [],
      actions: [{ id: 'faq', label: t('install.plan.whichTvs'), faq: FAQ_LG_VERSION }],
      notes: [t('install.plan.tooOld', { label: webos.label })],
    };
  }

  const notes: string[] = [];
  if (!webos) notes.push(t('install.plan.noWebos'));
  const hbc = has(f.apps, LG_HBC_APP_ID);
  const devApp = has(f.apps, LG_DEVMODE_APP_ID);
  const ports = f.openPorts;
  const ssh = !!ports && ports.indexOf(LG_SSH_PORT) >= 0;
  const keyServer = !!ports && ports.indexOf(LG_KEY_SERVER_PORT) >= 0;

  if (typeof f.ompVersion === 'string') {
    // '' = OMP is in the app list without a version
    const installed = f.ompVersion;
    const old = !!installed && needsUpdate(installed, f.latest);
    if (devApp && !hbc) notes.push(devmodeTimerNote());
    return {
      ...base,
      kind: 'lg-update',
      subtitle: join([model, label, installed ? 'OMP ' + installed : t('install.plan.ompInstalled')]),
      steps: [
        { id: 'omp', title: t('install.plan.ompInstalled'), text: installed ? versionText(installed, f.latest) : t('install.plan.versionUnknown'), state: 'done' },
      ],
      actions: old ? [{ id: 'update-on-tv', label: t('install.plan.updateOnTv'), primary: true }] : [],
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
      subtitle: join([model, label, t('install.plan.hbcSubtitle')]),
      steps: [
        { id: 'hbc', title: 'Homebrew Channel', text: t('install.plan.hbcInstalled'), state: 'done' },
        {
          id: 'repo',
          title: t('install.plan.repoTitle'),
          text: t('install.plan.repoText'),
          state: 'current',
        },
        { id: 'install', title: t('install.plan.installTitle'), text: t('install.plan.hbcInstallText'), state: 'todo' },
      ],
      actions: [
        { id: 'open-hbc', label: t('install.plan.openHbc'), primary: true },
        ...(ssh ? [{ id: 'install' as const, label: t('install.plan.installFromPhone') }] : []),
        { id: 'faq', label: t('install.plan.hbcMore'), faq: FAQ_LG_HBC },
      ],
      notes,
      install: ssh ? { method: 'lg-devmode', ip: f.ip, withHbc: false } : undefined,
    };
  }

  const steps = withProgress([
    {
      id: 'account',
      title: t('install.plan.accountTitle'),
      text: t('install.plan.accountText'),
      done: devApp || ssh || keyServer,
    },
    {
      id: 'app',
      title: t('install.plan.appTitle'),
      text: devApp ? t('install.plan.appTextHave') : t('install.plan.appTextNeed'),
      done: devApp || ssh || keyServer,
    },
    {
      id: 'status',
      title: 'Dev Mode Status',
      text: ssh ? t('install.plan.statusOn') : t('install.plan.statusOff'),
      done: ssh || keyServer,
    },
    {
      id: 'keyserver',
      title: 'Key Server',
      text: keyServer ? t('install.plan.keyServerOn') : t('install.plan.keyServerOff'),
      done: keyServer,
    },
    { id: 'install', title: t('install.plan.installTitle'), text: t('install.plan.installBothText'), done: false },
    { id: 'timer', title: t('install.plan.timerTitle'), text: devmodeTimerNote(), done: false },
  ]);
  // the timer is a reminder, never the current step
  const timer = steps[steps.length - 1];
  if (timer.state === 'current') timer.state = 'todo';
  // without the app list OMP or Homebrew Channel may already be there: no install until a recheck sees the list
  const appsKnown = f.apps !== undefined;
  if (!appsKnown) {
    notes.push(t('install.plan.noAppList'));
  }
  return {
    ...base,
    kind: 'lg-devmode',
    subtitle: join([model, label, t('install.plan.devmodeSubtitle')]),
    steps,
    actions: [
      ...(appsKnown ? [{ id: 'install' as const, label: t('install.plan.installBoth'), primary: true }] : []),
      { id: 'recheck', label: t('install.plan.recheck'), primary: !appsKnown },
      { id: 'link', label: t('install.plan.rootLink'), url: ROOT_CHECK_URL },
      { id: 'faq', label: t('install.plan.devmodeFaq'), faq: FAQ_LG_DEVMODE },
    ],
    notes,
    install: appsKnown ? { method: 'lg-devmode', ip: f.ip, withHbc: true } : undefined,
  };
}

/** The embedded TorrServer note for a box with this ABI (unknown, arm64 or another). */
export function abiNote(abi: string | undefined): string {
  if (!abi) {
    return t('install.plan.abiUnknown');
  }
  return isArm64(abi) ? t('install.plan.abiArm64') : t('install.plan.abiOther', { abi });
}

/** Cast reports «Chromecast» both for the old dongles and for Chromecast with Google TV (4K). */
const plainChromecastNote = () => t('install.plan.chromecastNote');

/** Found over cast: TVs with only a built-in Chromecast advertise the same service. */
const castOnlyNote = () => t('install.plan.castOnlyNote');

function atvPlan(f: AtvFacts): InstallPlan {
  const model = f.model || 'Android TV';
  const android = androidLabel(f.sdkInt);
  const arch = f.abi ? (isArm64(f.abi) ? 'arm64' : f.abi) : null;

  if (f.cast === 'chromecast' && !f.ompVersion) {
    return {
      kind: 'atv-unsupported',
      title: f.name,
      subtitle: join([model, t('install.plan.unsupported')]),
      steps: [],
      actions: [{ id: 'faq', label: t('install.plan.atvBoxes'), faq: FAQ_ATV_BOXES }],
      notes: [t('install.plan.chromecastUnsupported')],
    };
  }

  if (typeof f.ompVersion === 'string' && f.ompVersion) {
    const installed = f.ompVersion;
    const old = needsUpdate(installed, f.latest);
    return {
      kind: 'atv-installed',
      title: f.name,
      subtitle: join([model, android, 'OMP ' + installed]),
      steps: [{ id: 'omp', title: t('install.plan.ompInstalled'), text: versionText(installed, f.latest), state: 'done' }],
      actions: old ? [{ id: 'update-on-tv', label: t('install.plan.updateOnTv'), primary: true }] : [],
      notes: f.abi && !isArm64(f.abi) ? [abiNote(f.abi)] : [],
      installed,
      latest: f.latest,
      needsUpdate: old,
    };
  }

  const wireless = typeof f.sdkInt === 'number' ? f.sdkInt >= WIRELESS_DEBUG_SDK : null;
  // the phone installs over adb on port 5555; Android 11+ pairing by code («Беспроводная отладка») is not supported
  const debug =
    wireless === true
      ? { title: t('install.plan.debugTitle'), text: t('install.plan.debugWireless') }
      : wireless === false
        ? { title: t('install.plan.debugTitle'), text: t('install.plan.debugPlain') }
        : { title: t('install.plan.debugTitle'), text: t('install.plan.debugUnknown') };
  return {
    kind: 'atv-adb',
    title: f.name,
    subtitle: join([model, android, arch === 'arm64' ? t('install.plan.arm64Subtitle') : arch]),
    steps: withProgress([
      {
        id: 'devopts',
        title: t('install.plan.devOptsTitle'),
        text: t('install.plan.devOptsText'),
        done: false,
      },
      { id: 'debug', title: debug.title, text: debug.text, done: false },
      {
        id: 'install',
        title: t('install.plan.installTitle'),
        text: t('install.plan.adbInstallText'),
        done: false,
      },
    ]),
    actions: [
      { id: 'install', label: t('install.plan.installOmp'), primary: true },
      { id: 'faq', label: t('install.plan.adbFaq'), faq: FAQ_ATV_ADB },
    ],
    notes: (f.cast === 'tv' ? [castOnlyNote()] : [])
      .concat(/^chromecast$/i.test((f.model || '').trim()) ? [plainChromecastNote()] : [])
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
    subtitle: join([f.model || 'Samsung', t('install.plan.unsupported')]),
    steps: [],
    actions: [{ id: 'faq', label: t('install.plan.more'), faq: FAQ_SAMSUNG }],
    notes: [t('install.plan.samsungUnsupported')],
  };
}
