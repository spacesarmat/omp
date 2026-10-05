import { useEffect, useRef, useState } from 'preact/hooks';
import { setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { FocusGroup, Button, TextInput } from './components';
import { useKeys } from './keys';
import { errorMessage } from '../api/http';
import type { Source, SourceContext } from '../sources/types';
import {
  BROWSER_BUSY,
  BROWSER_CAPTCHA,
  BROWSER_FAILED,
  BROWSER_LOGIN,
  BROWSER_STORE_FAILED,
  canLoginOnPhone,
  hasBrowserLogin,
  isCaptchaError,
  LOGIN_ON_PHONE,
} from '../sources/browserLogin';

export const TV_LOGIN_HINT =
  'Проще с телефона: OMP → Пульт → «Клавиатура» вводит текст в это поле, или OMP → Настройки → Источники поиска → «Передать на телевизор».';
export const TV_LOGIN_NOTE = 'Логин и пароль хранятся только на этом телевизоре в зашифрованном виде.';

/**
 * Android TV «Вход на rutracker»: login and password by the remote (or the phone keyboard), the source keeps them
 * in the Keystore storage only. The password lives in a ref for the time of the dialog and is emptied after «Войти».
 * «Войти через браузер» opens the site's login page under the remote (native dialog), «Войти на телефоне» asks the paired
 * phone to sign in in its browser and send the session (Task 8's relay); onDone(true) after either.
 */
export function TrackerLoginDialog(p: { source: Source; ctx: () => SourceContext; onClose: () => void; onDone: (browser?: boolean) => void }) {
  const [username, setUsername] = useState('');
  const pass = useRef('');
  const [, setTick] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [captcha, setCaptcha] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    setFocus('login-user');
    return () => {
      alive.current = false;
      pass.current = '';
    };
  }, []);

  const close = () => {
    if (busy) return;
    pass.current = '';
    p.onClose();
  };

  // above the screen, below DialogHost: Back closes the dialog, other keys move inside it
  useKeys((a) => {
    if (a === 'back') {
      close();
      return true;
    }
    return 'spatial';
  }, 50);

  const submit = () => {
    if (busy || !p.source.login) return;
    const u = username.trim();
    const pw = pass.current;
    if (!u || !pw) {
      setError('Введите логин и пароль');
      return;
    }
    setError('');
    setCaptcha(false);
    setBusy(true);
    let run: Promise<void>;
    try {
      run = p.source.login(u, pw, p.ctx());
    } catch (e) {
      run = Promise.reject(e);
    }
    run.then(
      () => {
        pass.current = '';
        if (!alive.current) return;
        setBusy(false);
        p.onDone();
      },
      (e) => {
        pass.current = '';
        if (!alive.current) return;
        setBusy(false);
        setError(errorMessage(e));
        setCaptcha(isCaptchaError(e));
      },
    );
  };

  const browser = !!p.source.browserLogin && hasBrowserLogin();
  const viaBrowser = (askPhone: boolean) => {
    if (busy || !p.source.browserLogin) return;
    setError('');
    setBusy(true);
    let run: Promise<{ result: string }>;
    try {
      run = p.source.browserLogin(p.ctx(), askPhone ? { askPhone: true } : undefined);
    } catch (e) {
      run = Promise.reject(e);
    }
    run.then(
      (r) => {
        pass.current = '';
        if (!alive.current) return;
        setBusy(false);
        if (r.result === 'ok') p.onDone(true);
        else if (r.result === 'busy') setError(BROWSER_BUSY);
        else if (r.result === 'failed') setError(BROWSER_FAILED);
        else if (r.result === 'store_failed') setError(BROWSER_STORE_FAILED);
        else setFocus(askPhone ? 'login-phone' : 'login-browser');
      },
      () => {
        if (!alive.current) return;
        setBusy(false);
        setError(BROWSER_STORE_FAILED);
      },
    );
  };

  const title = 'Вход на ' + p.source.name;
  return (
    <div class="dialog-backdrop">
      <FocusGroup focusKey="LOGIN-DIALOG" className="dialog login-dialog" boundary>
        <div class="dialog-title">{title}</div>
        <div class="login-label">Логин</div>
        <TextInput focusKey="login-user" value={username} onChange={setUsername} />
        <div class="login-label">Пароль</div>
        <TextInput
          focusKey="login-pass"
          type="password"
          value={pass.current}
          onChange={(v) => {
            pass.current = v;
            setTick((n) => n + 1);
          }}
          onSubmit={submit}
        />
        <div class="login-hint">{TV_LOGIN_HINT}</div>
        <div class="login-note">{TV_LOGIN_NOTE}</div>
        {error && <div class="banner-error login-error">{error}</div>}
        {browser && captcha && <div class="login-hint login-captcha">{BROWSER_CAPTCHA}</div>}
        {browser && (
          <div class="login-actions login-browser">
            <Button focusKey="login-browser" className={captcha ? 'primary' : ''} label={BROWSER_LOGIN} onPress={() => viaBrowser(false)} />
            {canLoginOnPhone() && <Button focusKey="login-phone" label={LOGIN_ON_PHONE} onPress={() => viaBrowser(true)} />}
          </div>
        )}
        <div class="login-actions">
          <Button focusKey="login-cancel" label="Отмена" onPress={close} />
          <Button focusKey="login-ok" className="primary" label={busy ? 'Вхожу…' : 'Войти'} onPress={submit} />
        </div>
      </FocusGroup>
    </div>
  );
}
