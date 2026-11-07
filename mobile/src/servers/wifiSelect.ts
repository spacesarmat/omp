// Phone-only choice of a TorrServer for the current Wi-Fi. The SSID is a hint, not proof.
// A saved profile is health-checked on its own host. A password never leaves that host.
// The first new find asks before it is remembered. Playback is never interrupted.
import { normalizeServerUrl } from '../../../src/api/torrserver';

export interface WifiHint {
  /** True when the platform read a network name. False: use a typed name, never a guessed one. */
  available: boolean;
  ssid: string | null;
}

export interface WifiProfile {
  id: string;
  /** Lowercased SSID hint. */
  ssid: string;
  serverId: string;
  /** Host the user confirmed after a health check. */
  host: string;
}

export interface WifiPrefs {
  enabled: boolean;
  overrideId: string | null;
  /** Used only when the platform cannot read an SSID. */
  manualSsid: string;
  /** The server to fall back to. Not the TV and not the phone link. */
  primaryId: string | null;
  profiles: WifiProfile[];
}

export interface KnownServer {
  id: string;
  url: string;
  name?: string;
  user?: string;
  password?: string;
}

export interface FoundHost {
  url: string;
  name?: string;
}

export type WifiPlan =
  | { kind: 'defer'; reason: 'playback' }
  | { kind: 'skip'; reason: 'disabled' | 'no-hint' }
  | { kind: 'use'; serverId: string; reason: 'override' | 'profile' | 'primary' }
  | { kind: 'confirm'; ssid: string; hosts: FoundHost[] }
  | { kind: 'choose'; ssid: string; hosts: FoundHost[] }
  | { kind: 'fallback'; serverId: string | null; reason: 'unhealthy' | 'none' };

export function emptyWifiPrefs(): WifiPrefs {
  return { enabled: true, overrideId: null, manualSsid: '', primaryId: null, profiles: [] };
}

export function normalizeSsid(raw: string): string {
  return (raw || '').replace(/^"|"$/g, '').trim().toLowerCase();
}

export function hostOf(url: string): string {
  return normalizeServerUrl(url).replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase();
}

export function dedupeHosts(list: FoundHost[]): FoundHost[] {
  const out: FoundHost[] = [];
  const seen: { [k: string]: boolean } = {};
  for (let i = 0; i < list.length; i++) {
    let url = '';
    try {
      url = normalizeServerUrl(list[i].url);
    } catch (e) {
      continue;
    }
    const key = hostOf(url);
    if (!key || seen[key]) continue;
    seen[key] = true;
    out.push({ url: url, name: list[i].name });
  }
  return out;
}

/** Credentials stay on the saved server's own host. A discovered twin gets none. */
export function credentialsFor(server: KnownServer, targetUrl: string): { user?: string; password?: string } {
  if (hostOf(server.url) !== hostOf(targetUrl)) return {};
  return { user: server.user, password: server.password };
}

export function serverForHost(saved: KnownServer[], url: string): KnownServer | null {
  const host = hostOf(url);
  for (let i = 0; i < saved.length; i++) if (hostOf(saved[i].url) === host) return saved[i];
  return null;
}

/** One binding per SSID hint. Replaces the previous one. */
export function rememberProfile(prefs: WifiPrefs, ssid: string, serverId: string, host: string): WifiPrefs {
  const key = normalizeSsid(ssid);
  const rest = prefs.profiles.filter((p) => p.ssid !== key);
  const profile: WifiProfile = { id: key + ':' + serverId, ssid: key, serverId: serverId, host: hostOf(host) };
  return { ...prefs, profiles: rest.concat([profile]) };
}

export function forgetProfile(prefs: WifiPrefs, ssid: string): WifiPrefs {
  const key = normalizeSsid(ssid);
  return { ...prefs, profiles: prefs.profiles.filter((p) => p.ssid !== key) };
}

const dismissed = new Set<string>();

export function dismissWifiPrompt(ssid: string, host: string): void {
  dismissed.add(normalizeSsid(ssid) + '|' + hostOf(host));
}

export function resetWifiDismiss(): void {
  dismissed.clear();
}

function freshHosts(list: FoundHost[], ssid: string): FoundHost[] {
  return dedupeHosts(list).filter((h) => !dismissed.has(normalizeSsid(ssid) + '|' + hostOf(h.url)));
}

/**
 * What to do for this network. Does not switch anything.
 * `profileHealthy === null` means the caller has not checked yet: the plan says `use` only when the check passed.
 */
export function planWifi(p: {
  prefs: WifiPrefs;
  hint: WifiHint;
  playback: boolean;
  saved: KnownServer[];
  profileHealthy: boolean | null;
  discovered: FoundHost[];
  primaryId: string | null;
}): WifiPlan {
  if (p.playback) return { kind: 'defer', reason: 'playback' };
  if (!p.prefs.enabled) return { kind: 'skip', reason: 'disabled' };
  if (p.prefs.overrideId && p.saved.some((s) => s.id === p.prefs.overrideId)) {
    return { kind: 'use', serverId: p.prefs.overrideId, reason: 'override' };
  }
  const ssid = p.hint.available ? normalizeSsid(p.hint.ssid || '') : normalizeSsid(p.prefs.manualSsid);
  if (!ssid) return { kind: 'skip', reason: 'no-hint' };
  const profile = p.prefs.profiles.filter((x) => x.ssid === ssid)[0];
  const known = !!(profile && p.saved.some((s) => s.id === profile.serverId));
  const found = freshHosts(p.discovered, ssid);
  if (known && profile) {
    if (p.profileHealthy === true) return { kind: 'use', serverId: profile.serverId, reason: 'profile' };
    const others = found.filter((h) => hostOf(h.url) !== profile.host);
    if (others.length > 1) return { kind: 'choose', ssid: ssid, hosts: others };
    if (others.length === 1) return { kind: 'confirm', ssid: ssid, hosts: others };
    return fallback(p, profile.serverId);
  }
  if (found.length > 1) return { kind: 'choose', ssid: ssid, hosts: found };
  if (found.length === 1) return { kind: 'confirm', ssid: ssid, hosts: found };
  return fallback(p, null);
}

function fallback(p: { saved: KnownServer[]; primaryId: string | null }, avoid: string | null): WifiPlan {
  if (p.primaryId && p.primaryId !== avoid && p.saved.some((s) => s.id === p.primaryId)) {
    return { kind: 'fallback', serverId: p.primaryId, reason: avoid ? 'unhealthy' : 'none' };
  }
  return { kind: 'fallback', serverId: null, reason: avoid ? 'unhealthy' : 'none' };
}
