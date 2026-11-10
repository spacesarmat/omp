import { native } from '../platform/native';
import { activeServer } from '../../../src/store/servers';
import { TorrServerClient } from '../../../src/api/torrserver';
import { playerVersionOrNull, torrServerVersion, type PlayerAbi, type TorrReading } from '../../../src/lib/componentVersions';
import { isEmbeddedServerUrl } from './localServer';

export function readPhonePlayerVersion(): Promise<string | null> {
  return native.player2160Version().then(
    (v) => playerVersionOrNull(v),
    () => null,
  );
}

export function readPhoneAbi(): Promise<PlayerAbi | null> {
  return native.deviceAbiKey().then(
    (k) => (k === 'arm64' || k === 'armv7' ? k : null),
    () => null,
  );
}

/**
 * The user's TorrServer: the connected server when it is not the embedded one, otherwise the embedded binary.
 * An unreadable version is null (the launch check stays quiet). An outdated embedded binary with no version
 * is also null: the pin sheet already offers that download.
 */
export function readPhoneTorr(): Promise<TorrReading | null> {
  const active = activeServer.peek();
  const remote = !!(active && !isEmbeddedServerUrl(active.url));
  const echo = active
    ? new TorrServerClient(active).echo().then(
        (body) => torrServerVersion(body),
        () => null,
      )
    : Promise.resolve(null);
  const local = native.localServerInfo().catch(() => null);
  return Promise.all([echo, local]).then(([version, info]) => {
    if (remote && version) return { version, source: 'remote' as const };
    if (!info || !info.supported) return version ? { version, source: 'remote' as const } : null;
    const pin = info.pinVersion && torrServerVersion(info.pinVersion) ? info.pinVersion : undefined;
    const running = info.version && torrServerVersion(info.version) ? torrServerVersion(info.version)! : null;
    const seen = version || running;
    if (info.binary === 'outdated') {
      if (!seen) return null;
      return { version: seen, source: 'embedded', pin, embeddedOutdated: true, mobileData: !!info.mobileData };
    }
    if (seen) return { version: seen, source: 'embedded', pin, mobileData: !!info.mobileData };
    if (info.binary === 'ready' && pin) return { version: pin, source: 'embedded', pin, mobileData: !!info.mobileData };
    return null;
  });
}
