import { useRef, useState } from 'preact/hooks';
import { t } from '../../../src/i18n';
import { Icon } from '../ui/Icon';
import { showToast } from '../ui/toast';
import { goBack } from '../nav';
import { native } from '../platform/native';
import { log } from '../../../src/lib/log';
import {
  BACKUP_MAX_BYTES,
  ERR_TOO_BIG,
  applyBackup,
  backupFileName,
  backupWarning,
  collectBackup,
  parseBackup,
  serializeBackup,
  summarizeBackup,
  summaryLines,
  type BackupFile,
} from '../lib/backup';

export interface BackupActions {
  shareText: (o: { name: string; text: string; title?: string }) => Promise<void>;
  /** Text of the chosen file. */
  readFile: (f: File) => Promise<string>;
  reload: () => void;
  now: () => number;
}

const defaults: BackupActions = {
  shareText: (o) => native.shareText(o),
  readFile: (f) =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error('read'));
      r.readAsText(f);
    }),
  reload: () => location.reload(),
  now: () => Date.now(),
};

export let actions: BackupActions = defaults;

/** Replaces side effects (tests); null restores the real ones. */
export function setBackupActions(a: Partial<BackupActions> | null): void {
  actions = a ? { ...defaults, ...a } : defaults;
}

const included = () => [
  t('backup.inc.servers'),
  t('backup.inc.tvs'),
  t('backup.inc.subs'),
  t('backup.inc.sources'),
  t('backup.inc.settings'),
  t('backup.inc.catalog'),
  t('backup.inc.playlists'),
];
const excluded = () => [t('backup.exc.passwords'), t('backup.exc.history')];

let saving = false;

export async function saveBackup(): Promise<void> {
  if (saving) return;
  saving = true;
  try {
    const now = actions.now();
    await actions.shareText({ name: backupFileName(now), text: serializeBackup(collectBackup(now)), title: t('backup.shareTitle') });
  } catch (e) {
    log('error', 'app', t('backup.logShareFailed'));
    showToast(e && typeof (e as Error).message === 'string' ? (e as Error).message : t('backup.saveFailed'));
  } finally {
    saving = false;
  }
}

export function Backup() {
  const input = useRef<HTMLInputElement>(null);
  const [review, setReview] = useState<BackupFile | null>(null);
  const [error, setError] = useState('');

  async function onPick(e: Event) {
    const el = e.target as HTMLInputElement;
    const file = el.files && el.files[0];
    el.value = ''; // the same file can be chosen again
    if (!file) return;
    setError('');
    if (file.size > BACKUP_MAX_BYTES) {
      setError(ERR_TOO_BIG);
      return;
    }
    let text: string;
    try {
      text = await actions.readFile(file);
    } catch (err) {
      log('warn', 'app', t('backup.logReadFailed'));
      setError(t('backup.readFailed'));
      return;
    }
    const r = parseBackup(text);
    if (!r.ok) {
      log('warn', 'app', t('backup.logRejected'));
      setError(r.error);
      return;
    }
    setReview(r.backup);
  }

  function confirmRestore() {
    if (!review) return;
    try {
      applyBackup(review);
    } catch (err) {
      log('error', 'app', t('backup.logRestoreFailed'));
      setError(t('backup.writeFailed'));
      setReview(null);
      return;
    }
    showToast(t('backup.restored'));
    actions.reload();
  }

  const summary = review ? summarizeBackup(review) : null;

  return (
    <div class="m-screen" data-route="backup">
      <div class="m-bar">
        <button type="button" class="m-icon-btn" aria-label={t('common.back')} onClick={() => (review ? setReview(null) : goBack())}>
          <Icon d="M15 5l-7 7 7 7" />
        </button>
        <h1 class="m-bar-title">{t('backup.title')}</h1>
      </div>
      {review && summary ? (
        <div class="m-backup-review">
          <h2 class="m-section">{t('backup.whatInFile')}</h2>
          <ul class="m-backup-list">
            {summaryLines(summary).map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          <p class="m-muted m-small">
            {t('backup.copyFrom', { date: review.at.slice(0, 10) || t('backup.unknownDate') })}
            {review.omp ? t('backup.copyOmp', { version: review.omp }) : ''}.
          </p>
          <p class="m-note m-backup-warn">{backupWarning(summary)}</p>
          <p class="m-muted m-small">{t('backup.restoreNote')}</p>
          <button type="button" class="m-btn m-btn-primary" onClick={confirmRestore}>
            {t('backup.replace')}
          </button>
          <button type="button" class="m-btn m-btn-secondary" onClick={() => setReview(null)}>
            {t('common.cancel')}
          </button>
        </div>
      ) : (
        <>
          <h2 class="m-section">{t('backup.whatSaved')}</h2>
          <ul class="m-backup-list">
            {included().map((x) => (
              <li class="yes" key={x}>
                {x}
              </li>
            ))}
            {excluded().map((x) => (
              <li class="no" key={x}>
                {x}
              </li>
            ))}
          </ul>
          <button type="button" class="m-btn m-btn-primary" onClick={() => void saveBackup()}>
            {t('backup.save')}
          </button>
          <p class="m-muted m-small">{t('backup.fileNote', { name: backupFileName(actions.now()) })}</p>
          <p class="m-note m-backup-warn">{backupWarning()}</p>
          <button type="button" class="m-btn m-btn-secondary" onClick={() => input.current && input.current.click()}>
            {t('backup.restoreFile')}
          </button>
          <input ref={input} type="file" accept="application/json,.json,text/plain,.txt" hidden aria-label={t('backup.fileLabel')} onChange={(e) => void onPick(e)} />
          <p class="m-muted m-small">{t('backup.restoreWarn')}</p>
          {error ? <p class="m-error" role="alert">{error}</p> : null}
        </>
      )}
    </div>
  );
}
