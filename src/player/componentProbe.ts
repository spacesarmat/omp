import { client } from '../store/servers';
import { playerVersionOrNull, torrServerVersion, type PlayerAbi, type TorrReading } from '../lib/componentVersions';
import { nativePlugin } from '../platform/androidNative';

/** Installed external 2160 Player. null when it is missing or the version cannot be read. */
export function readTvPlayerVersion(): Promise<string | null> {
  const p = nativePlugin();
  if (!p || typeof p.player2160 !== 'function') return Promise.resolve(null);
  return Promise.resolve()
    .then(() => p.player2160!())
    .then(
      (r) => playerVersionOrNull(r && (r as { version?: unknown }).version),
      () => null,
    );
}

/** The TorrServer OMP is connected to. No embedded server on this UI. */
export function readTvTorr(): Promise<TorrReading | null> {
  const c = client.peek();
  if (!c) return Promise.resolve(null);
  return c.echo().then(
    (body) => {
      const version = torrServerVersion(body);
      return version ? { version, source: 'remote' as const } : null;
    },
    () => null,
  );
}

export function readTvAbi(): Promise<PlayerAbi | null> {
  const p = nativePlugin() as { deviceAbiKey?: () => Promise<{ key?: unknown }> } | null;
  if (!p || typeof p.deviceAbiKey !== 'function') return Promise.resolve(null);
  return Promise.resolve()
    .then(() => p.deviceAbiKey!())
    .then(
      (r) => (r && (r.key === 'arm64' || r.key === 'armv7') ? r.key : null),
      () => null,
    );
}
