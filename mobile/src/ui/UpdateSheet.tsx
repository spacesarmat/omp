import { useState } from 'preact/hooks';
import { Sheet } from './Sheet';
import { native } from '../platform/native';
import { dismissPrompt, skipVersion } from '../../../src/store/updates';
import { APP_VERSION } from '../../../src/version';
import type { UpdateInfo } from '../../../src/lib/updateInfo';

export type ApkInstaller = (url: string, sha256: string, onProgress: (percent: number) => void) => Promise<void>;
let installer: ApkInstaller | null = null;

/** Replaces the APK installer (tests); null restores the native one. */
export function setApkInstaller(fn: ApkInstaller | null): void {
  installer = fn;
}

function formatMb(bytes: number): string {
  return (bytes / 1048576).toFixed(1).replace('.', ',') + ' МБ';
}

export function UpdateSheet({ info }: { info: UpdateInfo }) {
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const busy = progress !== null;

  async function install() {
    if (busy) return;
    setError('');
    setProgress(0);
    try {
      await (installer ?? native.downloadAndInstallApk.bind(native))(info.ipkUrl, info.ipkHash, (p) => setProgress(Math.round(p)));
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'Не удалось установить обновление');
    } finally {
      setProgress(null);
    }
  }

  return (
    <Sheet label="Обновление" onClose={() => !busy && dismissPrompt()}>
      <div class="m-sheet-title">Доступна версия {info.version}</div>
      <div class="m-muted m-small">
        Сейчас установлена {APP_VERSION}
        {info.ipkSize > 0 ? ' · ' + formatMb(info.ipkSize) : ''}
      </div>
      {info.notes.length > 0 && (
        <ul class="m-notes">
          {info.notes.slice(0, 8).map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      {busy && (
        <div class="m-field">
          <div>Скачивание… {progress}%</div>
          <span class="m-bar-track">
            <span class="m-bar-fill" style={{ width: progress + '%' }} />
          </span>
        </div>
      )}
      {error && (
        <div class="m-error" role="alert">
          {error}
        </div>
      )}
      <button type="button" class="m-btn m-btn-primary" disabled={busy} onClick={() => void install()}>
        Установить
      </button>
      <div class="m-sheet-row">
        <button type="button" class="m-btn m-btn-secondary" disabled={busy} onClick={dismissPrompt}>
          Позже
        </button>
        <button type="button" class="m-btn m-btn-secondary" disabled={busy} onClick={() => skipVersion(info.version)}>
          Пропустить
        </button>
      </div>
      <div class="m-muted m-small">Android попросит разрешить установку из этого приложения — один раз.</div>
    </Sheet>
  );
}
