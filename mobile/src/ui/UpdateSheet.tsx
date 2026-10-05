import { useEffect, useRef, useState } from 'preact/hooks';
import { Sheet } from './Sheet';
import { native } from '../platform/native';
import { dismissPrompt, skipVersion } from '../../../src/store/updates';
import { APP_VERSION } from '../../../src/version';
import { apkFor } from '../../../src/lib/updateInfo';
import type { ApkAbi, UpdateInfo } from '../../../src/lib/updateInfo';

export type ApkInstaller = (
  url: string,
  sha256: string,
  onProgress: (percent: number) => void,
  apks?: UpdateInfo['apks'],
) => Promise<void>;
let installer: ApkInstaller | null = null;

/** Replaces the APK installer (tests); null restores the native one. */
export function setApkInstaller(fn: ApkInstaller | null): void {
  installer = fn;
}

export type AbiKeyReader = () => Promise<ApkAbi | null>;
let abiKeyReader: AbiKeyReader | null = null;

/** Replaces the device ABI query (tests); null restores the native one. */
export function setAbiKeyReader(fn: AbiKeyReader | null): void {
  abiKeyReader = fn;
}

export function describeInstallError(e: unknown): string {
  const msg = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  if (/[А-Яа-яЁё]/.test(msg)) return msg;
  return 'Не удалось установить обновление' + (msg ? ': ' + msg : '');
}

function formatMb(bytes: number): string {
  return (bytes / 1048576).toFixed(1).replace('.', ',') + ' МБ';
}

export function UpdateSheet({ info }: { info: UpdateInfo }) {
  const [busy, setBusy] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [pct, setPct] = useState<number | null>(null);
  const [error, setError] = useState('');
  const running = useRef(false);
  const busyRef = useRef(false);
  busyRef.current = busy || launching;
  // with per-ABI APKs in the feed the size is shown once the device's APK is known (undefined = not yet / unknown)
  const [abiKey, setAbiKey] = useState<ApkAbi | null | undefined>(info.apks ? undefined : null);

  useEffect(() => {
    if (!info.apks) return;
    let dead = false;
    (abiKeyReader ?? native.deviceAbiKey.bind(native))().then(
      (k) => { if (!dead) setAbiKey(k); },
      () => {},
    );
    return () => { dead = true; };
  }, [info]);
  const size = !info.apks ? info.ipkSize : abiKey === undefined ? 0 : apkFor(info, abiKey).size;

  useEffect(() => {
    if (!launching) return;
    const t = setTimeout(() => setLaunching(false), 5000);
    return () => clearTimeout(t);
  }, [launching]);

  async function install() {
    if (running.current) return;
    running.current = true;
    setError('');
    setPct(null);
    setBusy(true);
    try {
      await (installer ?? native.downloadAndInstallApk.bind(native))(
        info.ipkUrl,
        info.ipkHash,
        (p) => setPct(typeof p === 'number' && isFinite(p) ? Math.max(0, Math.min(100, Math.round(p))) : null),
        info.apks,
      );
      setLaunching(true);
    } catch (e) {
      setError(describeInstallError(e));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  const locked = busy || launching;
  return (
    <Sheet label="Обновление" onClose={() => !locked && dismissPrompt()} onBack={() => !busyRef.current && dismissPrompt()}>
      <div class="m-sheet-title">Доступна версия {info.version}</div>
      <div class="m-muted m-small">
        Сейчас установлена {APP_VERSION}
        {size > 0 ? ' · ' + formatMb(size) : ''}
      </div>
      {info.notes.length > 0 && (
        <ul class="m-notes m-sheet-scroll">
          {info.notes.slice(0, 8).map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      {busy && (
        <div class="m-field">
          <div>Скачивание…{pct !== null ? ' ' + pct + '%' : ''}</div>
          <span class="m-bar-track">
            <span class="m-bar-fill" style={{ width: (pct ?? 0) + '%' }} />
          </span>
        </div>
      )}
      {launching && <div>Запуск установки…</div>}
      {error && (
        <div class="m-error" role="alert">
          {error}
        </div>
      )}
      <button type="button" class="m-btn m-btn-primary" disabled={locked} onClick={() => void install()}>
        Установить
      </button>
      <div class="m-sheet-row">
        <button type="button" class="m-btn m-btn-secondary" disabled={locked} onClick={dismissPrompt}>
          Позже
        </button>
        <button type="button" class="m-btn m-btn-secondary" disabled={locked} onClick={() => skipVersion(info.version)}>
          Пропустить
        </button>
      </div>
      <div class="m-muted m-small">Android попросит разрешить установку из этого приложения — один раз.</div>
    </Sheet>
  );
}
