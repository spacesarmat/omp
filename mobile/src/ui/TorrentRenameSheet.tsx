import { useEffect, useState } from 'preact/hooks';
import { Sheet } from './Sheet';
import { checkTitle, TITLE_MAX } from '../../../src/lib/renameTorrent';

/** «Переименовать»: a text field with the current title; `onSave` writes it and resolves, errors are shown here. */
export function TorrentRenameSheet({ initial, onSave, onClose }: { initial: string; onSave: (title: string) => Promise<unknown>; onClose: () => void }) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [alive] = useState({ v: true });
  useEffect(
    () => () => {
      alive.v = false;
    },
    [],
  );

  const save = () => {
    const v = checkTitle(value);
    if (!v.ok) {
      setError(v.error);
      return;
    }
    setError('');
    setBusy(true);
    onSave(v.title).then(
      () => onClose(),
      (e) => {
        if (!alive.v) return;
        setBusy(false);
        setError(e && e.message ? String(e.message) : 'Не удалось сохранить');
      },
    );
  };

  return (
    <Sheet label="Переименовать" onClose={onClose}>
      <div class="m-sheet-title">Переименовать</div>
      <div class="m-field">
        <label for="rename-title">Название</label>
        <input
          id="rename-title"
          class="m-input"
          type="text"
          maxLength={TITLE_MAX + 50}
          autoCapitalize="sentences"
          value={value}
          onInput={(e) => setValue((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => e.key === 'Enter' && !busy && save()}
        />
        {error && (
          <div class="m-error" role="alert">
            {error}
          </div>
        )}
      </div>
      <div class="m-sheet-row">
        <button type="button" class="m-btn m-btn-secondary" onClick={onClose}>
          Отмена
        </button>
        <button type="button" class="m-btn m-btn-primary" disabled={busy} onClick={save}>
          Сохранить
        </button>
      </div>
    </Sheet>
  );
}
