import { useRef, useState } from 'preact/hooks';
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

const INCLUDED = [
  'Серверы TorrServer и их имена',
  'Телевизоры и пары с ними',
  'Подписки и настройки мониторинга',
  'Источники поиска (вкл./выкл.)',
  'Настройки приложения и тачпада',
  'Категории и вид каталога',
  'Избранные плейлисты и выбор дорожек',
];
const EXCLUDED = ['Пароли трекеров и cookie — их нужно ввести заново', 'История и «Пропуск» — они на TorrServer'];

let saving = false;

export async function saveBackup(): Promise<void> {
  if (saving) return;
  saving = true;
  try {
    const now = actions.now();
    await actions.shareText({ name: backupFileName(now), text: serializeBackup(collectBackup(now)), title: 'Поделиться копией' });
  } catch (e) {
    log('error', 'app', 'Не удалось поделиться копией настроек');
    showToast(e && typeof (e as Error).message === 'string' ? (e as Error).message : 'Не удалось сохранить копию');
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
      log('warn', 'app', 'Не удалось прочитать файл копии настроек');
      setError('Не удалось прочитать файл');
      return;
    }
    const r = parseBackup(text);
    if (!r.ok) {
      log('warn', 'app', 'Файл копии настроек отклонён');
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
      log('error', 'app', 'Не удалось восстановить настройки из копии');
      setError('Не удалось записать настройки на телефон');
      setReview(null);
      return;
    }
    showToast('Копия восстановлена');
    actions.reload();
  }

  const summary = review ? summarizeBackup(review) : null;

  return (
    <div class="m-screen" data-route="backup">
      <div class="m-bar">
        <button type="button" class="m-icon-btn" aria-label="Назад" onClick={() => (review ? setReview(null) : goBack())}>
          <Icon d="M15 5l-7 7 7 7" />
        </button>
        <h1 class="m-bar-title">Резервная копия</h1>
      </div>
      {review && summary ? (
        <div class="m-backup-review">
          <h2 class="m-section">Что в файле</h2>
          <ul class="m-backup-list">
            {summaryLines(summary).map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          <p class="m-muted m-small">
            Копия от {review.at.slice(0, 10) || 'неизвестной даты'}
            {review.omp ? ', OMP ' + review.omp : ''}.
          </p>
          <p class="m-note m-backup-warn">{backupWarning(summary)}</p>
          <p class="m-muted m-small">Восстановление заменит эти данные на телефоне. Остальное не изменится.</p>
          <button type="button" class="m-btn m-btn-primary" onClick={confirmRestore}>
            Заменить данные на телефоне
          </button>
          <button type="button" class="m-btn m-btn-secondary" onClick={() => setReview(null)}>
            Отмена
          </button>
        </div>
      ) : (
        <>
          <h2 class="m-section">Что сохраняется</h2>
          <ul class="m-backup-list">
            {INCLUDED.map((t) => (
              <li class="yes" key={t}>
                {t}
              </li>
            ))}
            {EXCLUDED.map((t) => (
              <li class="no" key={t}>
                {t}
              </li>
            ))}
          </ul>
          <button type="button" class="m-btn m-btn-primary" onClick={() => void saveBackup()}>
            Сохранить копию…
          </button>
          <p class="m-muted m-small">Файл {backupFileName(actions.now())} — отправьте его себе в Телеграм, на диск или в папку телефона.</p>
          <p class="m-note m-backup-warn">{backupWarning()}</p>
          <button type="button" class="m-btn m-btn-secondary" onClick={() => input.current && input.current.click()}>
            Восстановить из файла…
          </button>
          <input ref={input} type="file" accept="application/json,.json,text/plain,.txt" hidden aria-label="Файл копии" onChange={(e) => void onPick(e)} />
          <p class="m-muted m-small">Восстановление заменит серверы, телевизоры, подписки и настройки на этом телефоне. Перед заменой покажу, что в файле.</p>
          {error ? <p class="m-error" role="alert">{error}</p> : null}
        </>
      )}
    </div>
  );
}
