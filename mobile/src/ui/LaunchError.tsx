import { isNoOmp, openInstallGuide } from '../watch';
import { t } from '../../../src/i18n';

/** A TV-launch error line; «OMP is not installed on the TV» also offers the install guide. */
export function LaunchError({ message, class: cls = 'm-error' }: { message: string; class?: string }) {
  return (
    <div class={cls} role="status">
      {message}
      {isNoOmp(message) && (
        <div>
          <button type="button" class="m-btn m-btn-secondary m-btn-sm" onClick={openInstallGuide}>
            {t('remote.installGuide')}
          </button>
        </div>
      )}
    </div>
  );
}
