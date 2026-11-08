// What the phone may say about the Wi-Fi it is on. Never invents a name or a list of networks.
// A name is a hint for phone playback only. It does not identify the server and does not touch the TV.
import { native, type WifiCurrentRaw } from '../platform/native';
import { normalizeSsid } from './wifiSelect';

export type { WifiCurrentRaw };

export type WifiReadKind =
  | 'ok'
  | 'unsupported'
  | 'prompt'
  | 'denied'
  | 'blocked'
  | 'location'
  | 'nowifi'
  | 'hidden';

export interface WifiRead {
  kind: WifiReadKind;
  ssid: string | null;
}

type Reader = (ask: boolean) => Promise<WifiRead>;

let reader: Reader | null = null;

/** Tests inject a read. Production uses the native call. */
export function setCurrentNetworkReader(fn: Reader | null): void {
  reader = fn;
}

function permissionKind(raw: string | null | undefined): 'granted' | 'prompt' | 'denied' | 'blocked' {
  if (raw === 'granted' || raw === 'denied' || raw === 'blocked' || raw === 'prompt') return raw;
  return 'prompt';
}

function cleanSsid(raw: string | null | undefined): string | null {
  const ssid = normalizeSsid(raw || '');
  if (!ssid || ssid === '<unknown ssid>' || ssid.indexOf('0x') === 0) return null;
  return ssid;
}

/**
 * Turns one native answer into a state the screen can say out loud.
 * A missing name stays missing. Another network is never filled in.
 */
export function classifyWifiRead(raw: WifiCurrentRaw | null | undefined): WifiRead {
  if (!raw || raw.unsupported) return { kind: 'unsupported', ssid: null };
  const permission = permissionKind(raw.permission);
  if (permission !== 'granted') return { kind: permission, ssid: null };
  const transport = raw.transport || 'unknown';
  if (transport === 'none' || transport === 'other') return { kind: 'nowifi', ssid: null };
  const ssid = cleanSsid(raw.ssid);
  if (ssid) return { kind: 'ok', ssid: ssid };
  if (raw.location === 'off') return { kind: 'location', ssid: null };
  return { kind: 'hidden', ssid: null };
}

/** The name to store. Any other state keeps the typed name. */
export function acceptedSsid(read: WifiRead): string | null {
  return read.kind === 'ok' ? read.ssid : null;
}

export function nextManualSsid(current: string, read: WifiRead): string {
  const next = acceptedSsid(read);
  return next === null ? current : next;
}

/** Playback keeps the current phone server. The TV is not part of this choice. */
export function selectDecision(playing: boolean): 'defer' | 'apply' {
  return playing ? 'defer' : 'apply';
}

export function removeDecision(confirmed: boolean): 'remove' | 'cancel' {
  return confirmed ? 'remove' : 'cancel';
}

/** `ask` is true only after the person agrees to the system permission. */
export async function readCurrentNetwork(ask: boolean): Promise<WifiRead> {
  if (reader) return reader(ask);
  if (!native.available) return { kind: 'unsupported', ssid: null };
  try {
    const raw = ask ? await native.requestWifiName() : await native.wifiCurrent();
    return classifyWifiRead(raw);
  } catch (e) {
    return { kind: 'unsupported', ssid: null };
  }
}
