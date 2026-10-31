// Opens the Android share sheet (ACTION_SEND text/plain). A missing plugin copies the text.
import { t } from '../../../src/i18n';
import { native } from '../platform/native';
import { showToast } from '../ui/toast';

export interface SharePayload {
  text: string;
  subject?: string;
}

type Sender = (o: SharePayload) => Promise<'sheet' | 'copied'>;

let sender: Sender | null = null;

/** Tests replace the sheet. Null restores the real one. */
export function setShareSender(fn: Sender | null): void {
  sender = fn;
}

function refused(text: string): boolean {
  return /magnet:/i.test(text) || /xt=urn:btih/i.test(text);
}

function cancelled(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as { name?: string }).name === 'AbortError';
}

/** Shares `text`. A magnet is refused. A closed sheet is quiet. Anything else toasts. */
export async function sendShare(o: SharePayload): Promise<void> {
  if (!o.text || refused(o.text)) {
    showToast(t('share.failed'));
    return;
  }
  try {
    const mode = sender ? await sender(o) : await native.shareMessage(o);
    if (mode === 'copied') showToast(t('share.copied'));
  } catch (e) {
    if (cancelled(e)) return;
    showToast(t('share.failed'));
  }
}
