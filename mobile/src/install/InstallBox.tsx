// Install assistant: the phone installs OMP itself (mockups AssistSteps — passphrase + «Установить OMP и Homebrew
// Channel», AssistInstall — progress, «Отмена», the «Разрешить отладку?» hint). Form → progress → result or error.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { navigate } from '../nav';
import { log } from '../../../src/lib/log';
import { RELEASES_URL } from '../../../src/lib/updateInfo';
import { abiNote, isArm64, FAQ_ATV_ADB, FAQ_LG_DEVMODE, type InstallPlan, type InstallTarget } from '../../../src/lib/installPlan';
import { monitorNative } from '../monitor/native';
import { tvs } from '../tv/tvStore';
import {
  createProgress,
  errorText,
  hbcErrorText,
  installerNative,
  reminderAt,
  InstallError,
  type InstallResult,
  type ProgressView,
} from './installer';

type State =
  | { kind: 'form' }
  | { kind: 'running'; view: ProgressView }
  | { kind: 'done'; result: InstallResult }
  | { kind: 'error'; code: string };

/** Renders the plan's buttons; `install` starts the phone install, `label` replaces the install button text. */
export type ActionsRenderer = (o: { install: () => void; disabled: boolean; label?: string }) => ComponentChildren;

const START_TEXT = { 'lg-devmode': 'LG, режим разработчика', 'atv-adb': 'Android TV, adb' } as const;

/**
 * The install part of the steps screen. Without `plan.install` it only renders the actions. Leaving the screen
 * during an install cancels it.
 */
export function InstallBox(p: { plan: InstallPlan; onRecheck: () => void; actions: ActionsRenderer }) {
  const target = p.plan.install;
  const [state, setState] = useState<State>({ kind: 'form' });
  const [pass, setPass] = useState('');
  const [hbc, setHbc] = useState(true);
  const [formError, setFormError] = useState('');
  const running = useRef(false);
  const alive = useRef(true);
  const passInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (running.current) void installerNative().cancel();
    };
  }, []);

  if (!target) return <>{p.actions({ install: () => {}, disabled: true })}</>;
  const t: InstallTarget = target;
  const native = installerNative();
  const lg = t.method === 'lg-devmode';
  const withHbc = lg && t.withHbc && hbc;

  async function start() {
    if (running.current) return;
    const code = pass.trim();
    if (lg && !code) {
      setFormError('Введите код (Passphrase) с экрана Developer Mode');
      passInput.current?.focus();
      return;
    }
    setFormError('');
    running.current = true;
    const progress = createProgress(t.method, withHbc);
    setState({ kind: 'running', view: { percent: 0, title: 'Устанавливаю OMP', text: lg ? 'Проверяю код на телевизоре' : 'Подключаюсь к телевизору' } });
    // the code is passed once and not kept in the screen
    setPass('');
    log('info', 'install', 'Установка с телефона: ' + START_TEXT[t.method]);
    try {
      const result = await native.start(lg ? { method: t.method, ip: t.ip, passphrase: code, withHbc } : { method: t.method, ip: t.ip }, (e) => {
        if (alive.current) setState({ kind: 'running', view: progress(e) });
      });
      log('info', 'install', 'OMP установлен с телефона' + (result.hbcError ? ' (без Homebrew Channel)' : ''));
      if (alive.current) setState({ kind: 'done', result });
    } catch (e) {
      const c = e instanceof InstallError ? e.code : 'unknown';
      log(c === 'cancelled' ? 'info' : 'warn', 'install', 'Установка с телефона не удалась: ' + c);
      if (alive.current) setState({ kind: 'error', code: c });
    } finally {
      running.current = false;
    }
  }

  if (state.kind === 'running') {
    const v = state.view;
    return (
      <div class="m-install-run" data-install="running">
        <div class="m-install-progress" role="status">
          <div class="m-install-progress-head">
            <span>{v.title}</span>
            <span class="m-muted">{v.percent}%</span>
          </div>
          <span class="m-bar-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={v.percent}>
            <span class="m-bar-fill" style={{ width: v.percent + '%' }} />
          </span>
          <div class="m-muted m-small">{v.text}</div>
        </div>
        {!lg && <div class="m-muted m-small">Если на ТВ появится «Разрешить отладку?» — нажмите «Разрешить».</div>}
        <button type="button" class="m-btn m-btn-secondary" onClick={() => void native.cancel()}>
          Отмена
        </button>
      </div>
    );
  }

  if (state.kind === 'done') {
    return <Done lg={lg} tv={t.ip} tvName={p.plan.title} result={state.result} onRecheck={() => (setState({ kind: 'form' }), p.onRecheck())} />;
  }

  if (state.kind === 'error') {
    const atvFallback = !lg && ['adb-closed', 'unauthorized', 'auth-timeout', 'unreachable', 'timeout'].indexOf(state.code) >= 0;
    return (
      <div class="m-install-run" data-install="error">
        <div class="m-error" role="alert">
          {errorText(state.code)}
        </div>
        <button
          type="button"
          class="m-btn m-btn-primary"
          onClick={() => {
            setState({ kind: 'form' });
            if (state.code === 'wrong-passphrase' || state.code === 'ssh-auth') setTimeout(() => passInput.current?.focus(), 0);
          }}
        >
          Повторить
        </button>
        {atvFallback && (
          <button type="button" class="m-btn m-btn-secondary" onClick={() => window.open(RELEASES_URL, '_system')}>
            Скачать APK
          </button>
        )}
        <button type="button" class="m-link" onClick={() => navigate({ name: 'faq', q: lg ? FAQ_LG_DEVMODE : FAQ_ATV_ADB })}>
          {lg ? 'Подробная инструкция' : 'Как установить через компьютер'}
        </button>
      </div>
    );
  }

  return (
    <>
      {lg && (
        <div class="m-field m-install-form">
          <label for="install-pass">Код (Passphrase) из приложения Developer Mode</label>
          <input
            id="install-pass"
            ref={passInput}
            class="m-input m-install-pass"
            type="text"
            autocomplete="off"
            autocapitalize="characters"
            spellcheck={false}
            maxLength={16}
            placeholder="A1B2C3"
            value={pass}
            onInput={(e) => setPass((e.target as HTMLInputElement).value)}
          />
          {t.withHbc && (
            <label class="m-send-check">
              <input type="checkbox" checked={hbc} onChange={(e) => setHbc((e.target as HTMLInputElement).checked)} />
              Вместе с Homebrew Channel
            </label>
          )}
          {formError && (
            <div class="m-error" role="alert">
              {formError}
            </div>
          )}
        </div>
      )}
      {!native.available && <p class="m-muted m-small">Установка с телефона работает в приложении OMP для Android.</p>}
      {p.actions({
        install: () => void start(),
        disabled: !native.available,
        label: lg && t.withHbc && !hbc ? 'Установить OMP' : undefined,
      })}
    </>
  );
}

/** «12 ноября» for the reminder note. */
function dayText(at: number): string {
  const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const d = new Date(at);
  return d.getDate() + ' ' + months[d.getMonth()];
}

function Done(p: { lg: boolean; tv: string; tvName: string; result: InstallResult; onRecheck: () => void }) {
  const r = p.result;
  const [remind, setRemind] = useState(false);
  const [remindNote, setRemindNote] = useState('');
  const installedAt = useRef(Date.now()).current;
  const touched = useRef(false);
  // the saved TV's MAC is stable across DHCP changes; without one the reminder is keyed by the address
  const stableId = tvs.value.find((t) => t.ip === p.tv)?.mac;

  // a reminder for this TV may already be scheduled (an earlier install): the box shows it
  useEffect(() => {
    if (!p.lg) return;
    let alive = true;
    void installerNative()
      .reminderState(p.tv, stableId)
      .then((at) => {
        if (!alive || touched.current || at === null) return;
        setRemind(true);
        setRemindNote('Напоминание уже включено: ' + dayText(at) + '. Снимите и снова поставьте отметку, чтобы отсчитать 38 дней от сегодня.');
      });
    return () => {
      alive = false;
    };
  }, []);

  async function toggle(on: boolean) {
    touched.current = true;
    setRemind(on);
    setRemindNote('');
    try {
      if (!on) {
        await installerNative().reminder(p.tv, null, undefined, stableId);
        return;
      }
      const perm = await monitorNative.requestNotifyPermission();
      if (perm !== 'granted') {
        setRemind(false);
        setRemindNote('Уведомления для OMP выключены — напоминание не придёт. Разрешите их в настройках телефона.');
        return;
      }
      await installerNative().reminder(p.tv, reminderAt(installedAt), p.tvName, stableId);
      setRemindNote('Напомню через 38 дней. Чтобы срок совпал, продлите режим сейчас в Developer Mode (кнопка Extend).');
    } catch {
      setRemind(false);
      setRemindNote('Не удалось включить напоминание');
    }
  }

  return (
    <div class="m-install-run" data-install="done">
      <div class="m-install-done" role="status">
        <span class="m-ok">✓</span> {r.version ? 'OMP ' + r.version + ' установлен' : 'OMP установлен'}
      </div>
      <div class="m-muted m-note">
        {p.lg ? 'Откройте OMP на телевизоре: кнопка Home → список приложений → OMP.' : 'Откройте OMP на телевизоре из списка приложений.'}
      </div>
      {r.hbcVersion && <div class="m-note">Homebrew Channel {r.hbcVersion} установлен</div>}
      {r.hbcError && (
        <div class="m-hint-warn" role="note">
          {hbcErrorText(r.hbcError)}
        </div>
      )}
      {!p.lg && r.abi && !isArm64(r.abi) && (
        <div class="m-hint-warn" role="note">
          {abiNote(r.abi)}
        </div>
      )}
      {p.lg && (
        <>
          <div class="m-hint-warn" role="note">
            Режим разработчика действует 1000 часов (около 40 дней). Продлевайте его заранее в приложении Developer Mode, иначе OMP удалится с ТВ.
          </div>
          <div class="m-muted m-small">Выключите Key Server в Developer Mode: пока он включён, ключ может забрать любое устройство в вашей сети.</div>
          <label class="m-send-check">
            <input type="checkbox" checked={remind} data-reminder onChange={(e) => void toggle((e.target as HTMLInputElement).checked)} />
            Напомнить продлить режим разработчика
          </label>
          {remindNote && <div class="m-muted m-small">{remindNote}</div>}
        </>
      )}
      <button type="button" class="m-btn m-btn-secondary" onClick={p.onRecheck}>
        Проверить телевизор снова
      </button>
    </div>
  );
}
