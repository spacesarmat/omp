import { useEffect, useRef, useState } from 'preact/hooks';
import { Sheet } from './Sheet';
import { errorMessage } from '../../../src/api/http';
import { t } from '../../../src/i18n';
import { compareVersions } from '../../../src/lib/version';

/** First Android TV build that shows a 6-digit pairing code. Older builds still show 4. */
export const CODE_LEN_6 = '0.20.1-beta.11';

/** 4 or 6 from a discovered OMP version; 0 when the version is unknown (either length is accepted). */
export function pairingCodeLength(version: string | undefined): 0 | 4 | 6 {
  const v = (version || '').trim();
  if (!v) return 0;
  return compareVersions(v, CODE_LEN_6) >= 0 ? 6 : 4;
}

function codeReady(digits: string[], mode: 0 | 4 | 6): boolean {
  if (mode === 4) return digits.every((d) => d !== '');
  if (mode === 6) return digits.every((d) => d !== '');
  const head = digits.slice(0, 4).every((d) => d !== '');
  const tail = digits.slice(4).every((d) => d !== '');
  const tailEmpty = digits.slice(4).every((d) => d === '');
  return (head && tailEmpty) || (head && tail);
}

/** Bottom sheet for the pairing code shown by OMP on an Android TV (4 digits on an older build, 6 on a current one). */
export function CodeSheet({
  tvName,
  version,
  onSubmit,
  onCancel,
}: {
  tvName: string;
  /** OMP version from discovery. Empty: the sheet accepts a 4-digit or a 6-digit code. */
  version?: string;
  onSubmit: (code: string) => Promise<void>;
  onCancel: () => void;
}) {
  const mode = pairingCodeLength(version);
  const len = mode === 4 ? 4 : 6;
  const [digits, setDigits] = useState<string[]>(() => Array.from({ length: len }, () => ''));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const cells = useRef<(HTMLInputElement | null)[]>([]);
  const title = t('remote.code.title', { name: tvName });
  const complete = codeReady(digits, mode);

  const focus = (i: number) => cells.current[Math.max(0, Math.min(len - 1, i))]?.focus();

  useEffect(() => focus(0), []);

  /** Puts `text` (digits only) into the cells from `at`; a pasted or autofilled code spreads over the rest. */
  function fill(at: number, text: string, input?: HTMLInputElement) {
    let raw = text.replace(/\D/g, '');
    // typing over a filled cell: keep the new digit only
    if (input && raw.length === 2 && digits[at]) raw = raw[0] === digits[at] ? raw[1] : raw[0];
    const got = raw.slice(0, len - at);
    const next = digits.slice();
    if (!got) {
      next[at] = '';
      if (input) input.value = '';
    } else {
      for (let k = 0; k < got.length; k++) next[at + k] = got[k];
      focus(at + got.length);
    }
    setDigits(next);
    setError('');
  }

  async function submit(e: Event) {
    e.preventDefault();
    if (!complete || busy) return;
    setBusy(true);
    setError('');
    try {
      await onSubmit(digits.join('').replace(/\D/g, ''));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Sheet onClose={onCancel} label={title}>
      <form class="m-field m-code-form" onSubmit={submit}>
        <div class="m-sheet-title">{title}</div>
        <p class="m-muted m-note">{t('remote.code.note')}</p>
        <div class="m-code" role="group" aria-label={t('remote.code.group')}>
          {digits.map((d, i) => (
            <input
              key={i}
              ref={(n) => {
                cells.current[i] = n;
              }}
              class="m-code-cell"
              type="text"
              inputMode="numeric"
              size={1}
              autoComplete="one-time-code"
              aria-label={t('remote.code.digit', { n: i + 1 })}
              value={d}
              onInput={(e) => {
                const input = e.target as HTMLInputElement;
                fill(i, input.value, input);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Backspace' && !digits[i] && i > 0) {
                  e.preventDefault();
                  const next = digits.slice();
                  next[i - 1] = '';
                  setDigits(next);
                  focus(i - 1);
                }
              }}
              onPaste={(e) => {
                const text = e.clipboardData?.getData('text') || '';
                if (!/\d/.test(text)) return;
                e.preventDefault();
                fill(i, text);
              }}
            />
          ))}
        </div>
        {error && (
          <div class="m-error" role="alert">
            {error}
          </div>
        )}
        <button type="submit" class="m-btn m-btn-primary" disabled={!complete || busy}>
          {t('remote.code.connect')}
        </button>
        <button type="button" class="m-btn m-btn-text" onClick={onCancel}>
          {t('common.cancel')}
        </button>
      </form>
    </Sheet>
  );
}
