import { navigate } from '../nav';
import { showToast } from '../ui/toast';
import { activeServer } from '../../../src/store/servers';
import { activeTv } from '../tv/tvStore';
import { settings, updateSettings } from '../../../src/store/settings';
import { checkForUpdate, type CheckResult } from '../../../src/store/updates';
import { ANDROID_UPDATE_URL } from '../../../src/lib/updateInfo';
import { APP_VERSION } from '../../../src/version';

type Checker = (o: { manual: boolean; url?: string }) => Promise<CheckResult>;
let checker: Checker | null = null;

/** Replaces the update check (tests); null restores the real one. */
export function setUpdateChecker(fn: Checker | null): void {
  checker = fn;
}

export function runUpdateCheck(o: { manual: boolean; url?: string }): Promise<CheckResult> {
  return (checker ?? checkForUpdate)(o);
}

const PROJECT_URL = 'https://github.com/spacesarmat/omp';

export function Settings() {
  const server = activeServer.value;
  const tv = activeTv.value;
  const on = settings.value.updateCheck;

  async function check() {
    const r = await runUpdateCheck({ manual: true, url: ANDROID_UPDATE_URL }).catch((): CheckResult => 'error');
    if (r === 'error') showToast('Не удалось проверить обновления');
    else if (r === 'latest') showToast('У вас последняя версия');
  }

  return (
    <div class="m-screen" data-route="settings">
      <h1>Настройки</h1>
      <section class="m-set-group">
        <div class="m-set-label">Сервер</div>
        <div class="m-set-row">
          <div class="m-set-text">
            <span>{server ? server.name : 'Не выбран'}</span>
            {server && <span class="m-muted m-small">{server.url}</span>}
          </div>
          <button type="button" class="m-btn m-btn-secondary m-btn-sm" onClick={() => navigate({ name: 'connect' })}>
            Сменить
          </button>
        </div>
      </section>
      <section class="m-set-group">
        <div class="m-set-label">Телевизор</div>
        <div class="m-set-row">
          <div class="m-set-text">
            <span>{tv ? tv.name : 'Не выбран'}</span>
            {tv && <span class="m-muted m-small">{tv.ip}</span>}
          </div>
          <button type="button" class="m-btn m-btn-secondary m-btn-sm" onClick={() => navigate({ name: 'tv' })}>
            Выбрать
          </button>
        </div>
      </section>
      <section class="m-set-group">
        <div class="m-set-label">О приложении</div>
        <div class="m-set-row">
          <span>Версия</span>
          <span class="m-muted">{APP_VERSION}</span>
        </div>
        <button type="button" class="m-btn m-btn-secondary" onClick={() => void check()}>
          Проверить обновления
        </button>
        <div class="m-set-row">
          <span>Проверять обновления при запуске</span>
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label="Проверять обновления при запуске"
            class={'m-switch' + (on ? ' on' : '')}
            onClick={() => updateSettings({ updateCheck: !on })}
          >
            <span class="m-switch-knob" />
          </button>
        </div>
        <button type="button" class="m-btn m-btn-secondary" onClick={() => window.open(PROJECT_URL, '_system')}>
          Страница проекта
        </button>
      </section>
    </div>
  );
}
