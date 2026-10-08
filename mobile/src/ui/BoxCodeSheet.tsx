import { useEffect, useRef, useState } from 'preact/hooks';
import { Sheet } from './Sheet';
import { errorMessage } from '../../../src/api/http';
import { t } from '../../../src/i18n';

const LEN = 6;

/** The 6-character pairing code the Google TV remote service shows on the TV: digits and A–F. */
export function cleanBoxCode(text: string): string {
  return text
    .toUpperCase()
    .replace(/[^0-9A-F]/g, '')
    .slice(0, LEN);
}

/** Bottom sheet for the box pairing code («Управлять приставкой» over Google TV Remote). */
export function BoxCodeSheet({ onSubmit, onCancel }: { onSubmit: (code: string) => Promise<void>; onCancel: () => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const title = t('remote.box.codeTitle');

  useEffect(() => field.current?.focus(), []);

  async function submit(e: Event) {
    e.preventDefault();
    if (code.length !== LEN || busy) return;
    setBusy(true);
    setError('');
    try {
      await onSubmit(code);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Sheet onClose={onCancel} label={title}>
      <form class="m-field m-code-form" onSubmit={submit} data-box-code>
        <div class="m-sheet-title">{title}</div>
        <p class="m-muted m-note">{t('remote.box.codeNote')}</p>
        <input
          ref={field}
          class="m-input m-box-code"
          type="text"
          autoComplete="one-time-code"
          autoCapitalize="characters"
          spellcheck={false}
          maxLength={LEN}
          aria-label={t('remote.box.codeLabel')}
          value={code}
          onInput={(e) => {
            const input = e.target as HTMLInputElement;
            const next = cleanBoxCode(input.value);
            input.value = next;
            setCode(next);
            setError('');
          }}
        />
        {error && (
          <div class="m-error" role="alert">
            {error}
          </div>
        )}
        <button type="submit" class="m-btn m-btn-primary" disabled={code.length !== LEN || busy}>
          {t('remote.box.connect')}
        </button>
        <button type="button" class="m-btn m-btn-text" onClick={onCancel}>
          {t('common.cancel')}
        </button>
      </form>
    </Sheet>
  );
}
