// Install assistant: the phone installs OMP itself (mockups AssistSteps — passphrase + «Установить OMP и Homebrew
// Channel», AssistInstall — progress, «Отмена», the «Разрешить отладку?» hint). Form → progress → result or error.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { navigate } from '../nav';
import { log } from '../../../src/lib/log';
import { RELEASES_URL } from '../../../src/lib/updateInfo';
import { abiNote, isArm64, FAQ_ATV_ADB, FAQ_LG_DEVMODE, type InstallPlan, type InstallTarget } from '../../../src/lib/installPlan';
import { monitorNative } from '../monitor/native';
import { t as tr } from '../../../src/i18n';
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

const START_TEXT = { 'lg-devmode': 'install.run.startLg', 'atv-adb': 'install.run.startAtv' } as const;

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
      setFormError(tr('install.run.passRequired'));
      passInput.current?.focus();
      return;
    }
    setFormError('');
    running.current = true;
    const progress = createProgress(t.method, withHbc);
    setState({ kind: 'running', view: { percent: 0, title: tr('install.run.title'), text: lg ? tr('install.run.checkCode') : tr('install.run.connecting') } });
    // the code is passed once and not kept in the screen
    setPass('');
    log('info', 'install', tr('install.run.logStart', { what: tr(START_TEXT[t.method]) }));
    try {
      const result = await native.start(lg ? { method: t.method, ip: t.ip, passphrase: code, withHbc } : { method: t.method, ip: t.ip }, (e) => {
        if (alive.current) setState({ kind: 'running', view: progress(e) });
      });
      log('info', 'install', tr(result.hbcError ? 'install.run.logDoneNoHbc' : 'install.run.logDone'));
      if (alive.current) setState({ kind: 'done', result });
    } catch (e) {
      const c = e instanceof InstallError ? e.code : 'unknown';
      log(c === 'cancelled' ? 'info' : 'warn', 'install', tr('install.run.logFailed', { code: c }));
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
        {!lg && <div class="m-muted m-small">{tr('install.run.allowHint')}</div>}
        <button type="button" class="m-btn m-btn-secondary" onClick={() => void native.cancel()}>
          {tr('common.cancel')}
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
          {tr('common.retry')}
        </button>
        {atvFallback && (
          <button type="button" class="m-btn m-btn-secondary" onClick={() => window.open(RELEASES_URL, '_system')}>
            {tr('install.run.apk')}
          </button>
        )}
        <button type="button" class="m-link" onClick={() => navigate({ name: 'faq', q: lg ? FAQ_LG_DEVMODE : FAQ_ATV_ADB })}>
          {lg ? tr('install.plan.devmodeFaq') : tr('install.plan.adbFaq')}
        </button>
      </div>
    );
  }

  return (
    <>
      {lg && (
        <div class="m-field m-install-form">
          <label for="install-pass">{tr('install.run.passLabel')}</label>
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
              {tr('install.run.withHbc')}
            </label>
          )}
          {formError && (
            <div class="m-error" role="alert">
              {formError}
            </div>
          )}
        </div>
      )}
      {!native.available && <p class="m-muted m-small">{tr('install.run.needsApp')}</p>}
      {p.actions({
        install: () => void start(),
        disabled: !native.available,
        label: lg && t.withHbc && !hbc ? tr('install.plan.installOmp') : undefined,
      })}
    </>
  );
}

/** «12 ноября» / «November 12» for the reminder note. */
function dayText(at: number): string {
  const d = new Date(at);
  return tr('date.day', { d: d.getDate(), month: tr('date.monthsFull').split(' ')[d.getMonth()] });
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
        setRemindNote(tr('install.run.remindExists', { day: dayText(at) }));
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
        setRemindNote(tr('install.run.remindNoPerm'));
        return;
      }
      await installerNative().reminder(p.tv, reminderAt(installedAt), p.tvName, stableId);
      setRemindNote(tr('install.run.remindSet'));
    } catch {
      setRemind(false);
      setRemindNote(tr('install.run.remindFailed'));
    }
  }

  return (
    <div class="m-install-run" data-install="done">
      <div class="m-install-done" role="status">
        <span class="m-ok">✓</span> {r.version ? tr('install.run.doneOmpVersion', { version: r.version }) : tr('install.run.doneOmp')}
      </div>
      <div class="m-muted m-note">
        {p.lg ? tr('install.run.openLg') : tr('install.run.openAtv')}
      </div>
      {r.hbcVersion && <div class="m-note">{tr('install.run.hbcDone', { version: r.hbcVersion })}</div>}
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
            {tr('install.plan.timerNote')}
          </div>
          <div class="m-muted m-small">{tr('install.run.keyServerOff')}</div>
          <label class="m-send-check">
            <input type="checkbox" checked={remind} data-reminder onChange={(e) => void toggle((e.target as HTMLInputElement).checked)} />
            {tr('install.run.remindLabel')}
          </label>
          {remindNote && <div class="m-muted m-small">{remindNote}</div>}
        </>
      )}
      <button type="button" class="m-btn m-btn-secondary" onClick={p.onRecheck}>
        {tr('install.run.recheck')}
      </button>
    </div>
  );
}
