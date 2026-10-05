import { registrationOf } from '../../../src/sources/registration';
import { t } from '../../../src/i18n';
import type { Source } from '../../../src/sources/types';

export interface NoAccountActions {
  openUrl(url: string): void;
}

const defaults: NoAccountActions = {
  openUrl: (url) => {
    window.open(url, '_system');
  },
};

let actions: NoAccountActions = defaults;

/** Replaces the link opener (tests); no argument restores the real one. */
export function setNoAccountActions(a?: Partial<NoAccountActions>): void {
  actions = { ...defaults, ...a };
}

/** «Нет аккаунта? Зарегистрироваться на {site}»: opens the site's registration page in the system browser. */
export function NoAccount({ source }: { source: Source }) {
  const url = registrationOf(source);
  if (!url) return null;
  return (
    <div>
      <button type="button" class="m-link" data-no-account="1" onClick={() => actions.openUrl(url)}>
        {t('sources.login.noAccount', { site: source.name })}
      </button>
    </div>
  );
}
