// The name of the TV the app runs on, under the logo in the TV top bar. Android TV: the native tvName (the device
// name the user set, else the maker and model: «Dune HD …»); LG webOS: the TV's name from the system settings
// («deviceName»), else «LG webOS TV». Loaded once per app run; '' while unknown (no line then).
import { signal } from '@preact/signals';
import { nativePlugin } from './androidNative';
import { hasLuna, lunaCall } from './luna';

export const WEBOS_FALLBACK_NAME = 'LG webOS TV';
const NAME_MAX = 60;

/** The device name; '' while unknown or outside a TV (browser, phone). */
export const deviceName = signal('');

let started = false;

function clean(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX) : '';
}

/** Starts the lookup (once; later calls do nothing). Resolves when it ended; never rejects. */
export function loadDeviceName(): Promise<void> {
  if (started) return Promise.resolve();
  started = true;
  const plugin = nativePlugin();
  if (plugin) {
    return plugin.tvName().then(
      (r) => { deviceName.value = clean(r && r.name); },
      () => undefined,
    );
  }
  if (!hasLuna()) return Promise.resolve();
  return lunaCall<{ settings?: { deviceName?: unknown } }>(
    'luna://com.webos.settingsservice/getSystemSettings',
    { category: 'network', keys: ['deviceName'] },
    3000,
  ).then(
    (r) => { deviceName.value = clean(r && r.settings && r.settings.deviceName) || WEBOS_FALLBACK_NAME; },
    () => { deviceName.value = WEBOS_FALLBACK_NAME; },
  );
}

/** Tests: forget the name and look it up again on the next loadDeviceName. */
export function resetDeviceName(): void {
  started = false;
  deviceName.value = '';
}
