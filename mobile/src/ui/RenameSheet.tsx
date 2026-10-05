import { useState } from 'preact/hooks';
import { Sheet } from './Sheet';
import { t } from '../../../src/i18n';

/** Bottom sheet for renaming a saved TV or server; empty input means "restore the default". */
export function RenameSheet({
  title,
  value,
  onSave,
  onCancel,
}: {
  title: string;
  value: string;
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(value);
  function submit(e: Event) {
    e.preventDefault();
    onSave(text.trim());
  }
  return (
    <Sheet onClose={onCancel} label={title}>
      <form class="m-field" onSubmit={submit}>
        <label class="m-sheet-title" for="rename-input">
          {title}
        </label>
        <input
          id="rename-input"
          class="m-input"
          type="text"
          maxLength={40}
          autoFocus
          value={text}
          onInput={(e) => setText((e.target as HTMLInputElement).value)}
        />
        <div class="m-sheet-row">
          <button type="button" class="m-btn m-btn-secondary" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button type="submit" class="m-btn m-btn-primary">
            {t('common.save')}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
