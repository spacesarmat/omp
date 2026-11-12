import { signal } from '@preact/signals';
import { t } from '../../../src/i18n';
import { navigate, type Route } from '../nav';

/** The screen a help button just opened. Empty when the question was answered. */
export const faqMark = signal('');

export function openFromFaq(route: Route, mark: string): void {
  faqMark.value = mark;
  navigate(route);
}

/** «Получилось?» on the screen a help button opened. One tap clears it. */
export function FaqDone({ mark }: { mark: string }) {
  if (faqMark.value !== mark) return null;
  return (
    <button type="button" class="m-btn m-btn-secondary" data-faq-done={mark} onClick={() => (faqMark.value = '')}>
      {t('faq.didIt')}
    </button>
  );
}
