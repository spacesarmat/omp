// Runs the Wi-Fi plan once. Never writes the TV link and never talks to the TV.
// A scan is one call the caller supplies. Cancelling drops the result. Playback freezes the choice.
import { signal } from '@preact/signals';
import { loadJson, saveJson, isObject } from '../../../src/store/storage';
import { removeServer, servers, setActiveServer } from '../../../src/store/servers';
import { nowPlaying } from '../tv/playerLink';
import {
  dedupeHosts,
  dismissWifiPrompt,
  emptyWifiPrefs,
  forgetProfile,
  hostOf,
  normalizeSsid,
  planWifi,
  rememberProfile,
  serverForHost,
  type FoundHost,
  type KnownServer,
  type WifiHint,
  type WifiPlan,
  type WifiPrefs,
  type WifiProfile,
} from './wifiSelect';

const KEY = 'tsp.wifiServers';

function cleanProfile(v: unknown): WifiProfile | null {
  if (!isObject(v) || typeof v.ssid !== 'string' || typeof v.serverId !== 'string' || typeof v.host !== 'string') return null;
  const ssid = normalizeSsid(v.ssid);
  if (!ssid) return null;
  return { id: typeof v.id === 'string' ? v.id : ssid + ':' + v.serverId, ssid: ssid, serverId: v.serverId, host: v.host };
}

export function loadWifiPrefs(): WifiPrefs {
  const raw = loadJson<unknown>(KEY, null, isObject);
  if (!isObject(raw)) return emptyWifiPrefs();
  const profiles = Array.isArray(raw.profiles) ? raw.profiles.map(cleanProfile).filter((p): p is WifiProfile => !!p) : [];
  return {
    enabled: raw.enabled !== false,
    overrideId: typeof raw.overrideId === 'string' ? raw.overrideId : null,
    manualSsid: typeof raw.manualSsid === 'string' ? raw.manualSsid : '',
    primaryId: typeof raw.primaryId === 'string' ? raw.primaryId : null,
    profiles: profiles,
  };
}

export const wifiPrefsVersion = signal(0);

export function saveWifiPrefs(p: WifiPrefs): void {
  saveJson(KEY, p);
  wifiPrefsVersion.value++;
}

export interface WifiRunDeps {
  hint: () => Promise<WifiHint>;
  prefs: () => WifiPrefs;
  save: (p: WifiPrefs) => void;
  saved: () => KnownServer[];
  playback: () => boolean;
  echo: (server: KnownServer) => Promise<boolean>;
  discover: (cancel: () => boolean) => Promise<FoundHost[]>;
  /** Phone TorrServer only. Must not touch the TV or the TV link. */
  apply: (id: string) => void;
}

let bound: WifiRunDeps | null = null;
let gen = 0;
let lastScanSsid = '';

export const wifiPrompt = signal<WifiPlan | null>(null);

export function bindWifiRuntime(d: WifiRunDeps): void {
  bound = d;
}

export function cancelWifiRun(): void {
  gen++;
}

export function resetWifiScan(): void {
  lastScanSsid = '';
}

function live(mine: number, d: WifiRunDeps): boolean {
  return mine === gen && !d.playback();
}

function useServer(d: WifiRunDeps, id: string): void {
  if (d.playback()) return;
  d.apply(id);
}

/**
 * Saved profile first (health check on that host), else one discovery, else the primary server.
 * Confirm and choose do not switch. A cancelled or mid-playback run does not switch either.
 */
export async function considerWifi(over?: Partial<WifiRunDeps>, force = false): Promise<WifiPlan> {
  const d = { ...(bound || {}), ...(over || {}) } as WifiRunDeps;
  const mine = ++gen;
  const dead = () => !live(mine, d);
  if (!d.playback || !d.saved || !d.hint || !d.prefs || !d.echo || !d.discover || !d.apply) {
    return { kind: 'skip', reason: 'disabled' };
  }
  if (d.playback()) return { kind: 'defer', reason: 'playback' };
  const prefs = d.prefs();
  const hint = await d.hint().catch(() => ({ available: false, ssid: null }));
  if (dead()) return { kind: 'defer', reason: 'playback' };
  const saved = d.saved();
  const ssid = hint.available ? normalizeSsid(hint.ssid || '') : normalizeSsid(prefs.manualSsid);
  const profile = prefs.profiles.filter((x) => x.ssid === ssid)[0];
  const profileServer = profile ? saved.filter((s) => s.id === profile.serverId)[0] : undefined;
  let healthy: boolean | null = null;
  if (profileServer && prefs.enabled && !prefs.overrideId) {
    healthy = await d.echo(profileServer).catch(() => false);
    if (dead()) return { kind: 'defer', reason: 'playback' };
  }
  let discovered: FoundHost[] = [];
  const needScan = prefs.enabled && !prefs.overrideId && ssid && healthy !== true && (force || ssid !== lastScanSsid);
  if (needScan) {
    const found = await d.discover(dead).catch(() => null);
    if (dead()) return { kind: 'defer', reason: 'playback' };
    if (found) {
      lastScanSsid = ssid;
      discovered = found;
    }
  }
  const plan = planWifi({
    prefs: prefs,
    hint: hint,
    playback: d.playback(),
    saved: saved,
    profileHealthy: healthy,
    discovered: discovered,
    primaryId: prefs.primaryId,
  });
  if (plan.kind === 'use' || (plan.kind === 'fallback' && plan.serverId)) {
    useServer(d, plan.kind === 'use' ? plan.serverId : plan.serverId!);
  }
  if (plan.kind === 'confirm' || plan.kind === 'choose') {
    wifiPrompt.value = plan;
  } else {
    const pending = wifiPrompt.value;
    if (pending && (pending.kind === 'confirm' || pending.kind === 'choose') && (!prefs.enabled || !!prefs.overrideId || pending.ssid !== ssid)) wifiPrompt.value = null;
  }
  return plan;
}

function playingNow(): boolean {
  if (bound) return bound.playback();
  const n = nowPlaying.peek();
  return !!(n && n.hash);
}

function applyServer(id: string): void {
  if (playingNow()) return;
  if (bound) bound.apply(id);
  else setActiveServer(id);
}

/** The user accepted one host. A new host is saved with no borrowed password. */
export function acceptWifiHost(plan: Extract<WifiPlan, { kind: 'confirm' | 'choose' }>, url: string, addBare: (url: string, name?: string) => KnownServer): WifiPrefs | null {
  const d = bound;
  const prefs = d ? d.prefs() : loadWifiPrefs();
  const saved = d ? d.saved() : [];
  const known = serverForHost(saved, url);
  const server = known || addBare(url, plan.hosts.filter((h) => hostOf(h.url) === hostOf(url))[0]?.name);
  // An explicit search does not invent a network binding and does not copy another server's password.
  if (plan.search) {
    const next = prefs.overrideId ? { ...prefs, overrideId: server.id } : prefs;
    if (next !== prefs) {
      if (d) d.save(next);
      else saveWifiPrefs(next);
    }
    if (playingNow()) queueAfterPlayback({ kind: 'select', id: server.id });
    else applyServer(server.id);
    wifiPrompt.value = null;
    return next;
  }
  const next = rememberProfile(prefs, plan.ssid, server.id, url);
  if (d) {
    d.save(next);
    if (!d.playback()) d.apply(server.id);
  } else saveWifiPrefs(next);
  wifiPrompt.value = null;
  return next;
}

export function laterWifi(plan: Extract<WifiPlan, { kind: 'confirm' | 'choose' }>): void {
  plan.hosts.forEach((h) => dismissWifiPrompt(plan.ssid, h.url));
  wifiPrompt.value = null;
}

export function setWifiEnabled(on: boolean, primaryId: string | null): WifiPrefs {
  if (!on) {
    cancelWifiRun();
    wifiPrompt.value = null;
  }
  const cur = loadWifiPrefs();
  const next = { ...cur, enabled: on, primaryId: cur.primaryId || primaryId };
  saveWifiPrefs(next);
  return next;
}

export function ensureWifiPrimary(id: string | null): WifiPrefs {
  const cur = loadWifiPrefs();
  if (!id || cur.primaryId) return cur;
  const next = { ...cur, primaryId: id };
  saveWifiPrefs(next);
  return next;
}

export function setWifiManual(ssid: string): WifiPrefs {
  wifiPrompt.value = null;
  const next = { ...loadWifiPrefs(), manualSsid: ssid };
  saveWifiPrefs(next);
  return next;
}

export function setWifiPrimary(id: string | null): WifiPrefs {
  const next = { ...loadWifiPrefs(), primaryId: id };
  saveWifiPrefs(next);
  return next;
}

export function setWifiOverride(id: string | null): WifiPrefs {
  wifiPrompt.value = null;
  const next = { ...loadWifiPrefs(), overrideId: id };
  saveWifiPrefs(next);
  return next;
}

export function dropWifiProfile(ssid: string): WifiPrefs {
  const next = forgetProfile(loadWifiPrefs(), ssid);
  saveWifiPrefs(next);
  return next;
}

export type AfterPlayback =
  | { kind: 'select'; id: string }
  | { kind: 'remove'; id: string }
  | { kind: 'wifi' };

export interface PlaybackWait {
  removeId: string | null;
  choice: { kind: 'select'; id: string } | { kind: 'wifi' } | null;
}

let pendingRemoveId: string | null = null;
let pendingChoice: PlaybackWait['choice'] = null;
let watchingPlayback = false;
let lanSearch: ((cancel: () => boolean) => Promise<FoundHost[]>) | null = null;

/** Tests replace the one-shot LAN search. Production uses the bound discover. */
export function setLanSearch(fn: ((cancel: () => boolean) => Promise<FoundHost[]>) | null): void {
  lanSearch = fn;
}

export function queueAfterPlayback(job: AfterPlayback): void {
  if (job.kind === 'remove') {
    pendingRemoveId = job.id;
    if (pendingChoice && pendingChoice.kind === 'select' && pendingChoice.id === job.id) pendingChoice = null;
    return;
  }
  if (job.kind === 'select') {
    pendingChoice = { kind: 'select', id: job.id };
    if (pendingRemoveId === job.id) pendingRemoveId = null;
    return;
  }
  pendingChoice = { kind: 'wifi' };
}

export function clearAfterPlayback(): void {
  pendingRemoveId = null;
  pendingChoice = null;
}

/** Drops a queued select or removal of this server. A queued network check stays. */
export function forgetPendingServer(id: string): void {
  if (pendingRemoveId === id) pendingRemoveId = null;
  if (pendingChoice && pendingChoice.kind === 'select' && pendingChoice.id === id) pendingChoice = null;
}

export function pendingAfterPlayback(): PlaybackWait | null {
  if (!pendingRemoveId && !pendingChoice) return null;
  return { removeId: pendingRemoveId, choice: pendingChoice };
}

/**
 * Applies what was saved during playback. Removal is kept apart from the latest
 * server choice. The rule in force now decides whether that choice is locked.
 * Does nothing while playback is still going.
 */
export function applyAfterPlayback(): void {
  if (playingNow()) return;
  const removeId = pendingRemoveId;
  const choice = pendingChoice;
  pendingRemoveId = null;
  pendingChoice = null;
  if (!removeId && !choice) return;
  if (removeId && servers.peek().some((s) => s.id === removeId)) removeServer(removeId);
  if (!choice) return;
  if (choice.kind === 'wifi') {
    void considerWifi(undefined, true);
    return;
  }
  if (!servers.peek().some((s) => s.id === choice.id)) return;
  const lock = !!loadWifiPrefs().overrideId;
  setActiveServer(choice.id);
  if (lock) setWifiOverride(choice.id);
}

export function watchPlaybackEnd(): void {
  if (watchingPlayback) return;
  watchingPlayback = true;
  nowPlaying.subscribe((n) => {
    if (n && n.hash) return;
    applyAfterPlayback();
  });
}

/**
 * One search, even with no network name and even when a server is locked.
 * Does not scan again on its own. A password is not part of this result.
 */
export async function searchLan(): Promise<'defer' | 'none' | 'ask'> {
  if (playingNow()) return 'defer';
  const discover = lanSearch || (bound && bound.discover);
  if (!discover) return 'none';
  let found: FoundHost[] = [];
  try {
    found = await discover(() => playingNow());
  } catch (e) {
    return 'none';
  }
  if (playingNow()) return 'defer';
  const hosts = dedupeHosts(found);
  if (!hosts.length) return 'none';
  wifiPrompt.value = hosts.length > 1
    ? { kind: 'choose', ssid: '', hosts: hosts, search: true }
    : { kind: 'confirm', ssid: '', hosts: hosts, search: true };
  return 'ask';
}
