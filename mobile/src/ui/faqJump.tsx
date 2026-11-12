import { effect, signal } from '@preact/signals';
import { t } from '../../../src/i18n';
import { currentRoute, navigate, type MRoute } from '../nav';

/** The screen a help button just opened. Empty when the question was answered or the screen was left. */
export const faqMark = signal('');

const MARK_ROUTE: { [mark: string]: string } = {
  install: 'install',
  tv: 'tv',
  account: 'account',
  server: 'localServer',
  log: 'log',
};

effect(() => {
  const mark = faqMark.value;
  if (mark && MARK_ROUTE[mark] !== currentRoute.value.name) faqMark.value = '';
});

export function openFromFaq(route: MRoute, mark: string): void {
  navigate(route);
  faqMark.value = mark;
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
