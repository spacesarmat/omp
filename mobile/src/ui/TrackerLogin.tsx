import { useEffect, useRef, useState } from 'preact/hooks';
import { Sheet } from './Sheet';
import { Icon } from './Icon';
import { navigate } from '../nav';
import { errorMessage } from '../../../src/api/http';
import { isCloudflare, jackettHint } from '../../../src/sources/view';
import type { Source, SourceContext } from '../../../src/sources/types';
import { browserSuggestion } from '../../../src/sources/browserLogin';
import { BrowserLoginButton } from './BrowserLoginButton';

const LOCK = 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3';

/**
 * «Вход на rutracker». The password is never kept in component state: it is read from the field at «Войти»,
 * handed to the source (which stores it in the Android Keystore only) and the field is emptied right away. Under the
 * form: «Войти через браузер» (suggested first when the site asked for a captcha or Cloudflare stopped the form); onDone(true) after a browser login.
 */
export function TrackerLogin({
  source,
  ctx,
  onClose,
  onDone,
}: {
  source: Source;
  ctx: () => SourceContext;
  onClose: () => void;
  onDone: (browser?: boolean) => void;
}) {
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [suggest, setSuggest] = useState('');
  const [busy, setBusy] = useState(false);
  const pass = useRef<HTMLInputElement>(null);
  const alive = useRef(true);

  const clearPassword = () => {
    if (pass.current) pass.current.value = '';
  };

  useEffect(
    () => () => {
      alive.current = false;
      clearPassword();
    },
    [],
  );

  // no closing while the request runs: its answer decides what the sources screen shows
  const close = () => {
    if (busy) return;
    clearPassword();
    onClose();
  };

  const submit = (e?: Event) => {
    if (e) e.preventDefault();
    if (busy || !source.login) return;
    const u = username.trim();
    const p = pass.current ? pass.current.value : '';
    if (!u || !p) {
      setError('Введите логин и пароль');
      return;
    }
    setError('');
    setSuggest('');
    setBusy(true);
    source.login(u, p, ctx()).then(
      () => {
        clearPassword();
        if (!alive.current) return;
        setBusy(false);
        onDone();
      },
      (err) => {
        clearPassword();
        if (!alive.current) return;
        setBusy(false);
        setError(errorMessage(err));
        setSuggest(browserSuggestion(err));
      },
    );
  };

  const title = 'Вход на ' + source.name;
  return (
    <Sheet label={title} onClose={close}>
      <form class="m-field-group" onSubmit={submit}>
        <div class="m-sheet-title">{title}</div>
        <div class="m-field">
          <label for="m-login-user">Логин</label>
          <input
            id="m-login-user"
            name="username"
            class="m-input"
            type="text"
            autocomplete="username"
            autocapitalize="off"
            placeholder={'ваш логин на ' + source.name}
            value={username}
            onInput={(e) => setUsername((e.target as HTMLInputElement).value)}
          />
        </div>
        <div class="m-field">
          <label for="m-login-pass">Пароль</label>
          <input id="m-login-pass" name="password" class="m-input" type="password" autocomplete="current-password" ref={pass} />
        </div>
        <div class="m-lock-note">
          <Icon d={LOCK} size={18} />
          <span>{'Логин и пароль хранятся только на этом телефоне в зашифрованном виде и отправляются только на ' + source.name + '.'}</span>
        </div>
        {error && (
          <div class="m-error" role="alert">
            {error}
          </div>
        )}
        {isCloudflare(error) && (
          <div class="m-hint-warn" data-hint="jackett">
            {jackettHint()}
            <div>
              <button
                type="button"
                class="m-link"
                onClick={() => {
                  close();
                  navigate({ name: 'faq' });
                }}
              >
                Вопросы и ответы
              </button>
            </div>
          </div>
        )}
        <BrowserLoginButton
          source={source}
          ctx={ctx}
          suggest={suggest}
          disabled={busy}
          onDone={() => {
            clearPassword();
            onDone(true);
          }}
        />
        <div class="m-marks-actions">
          <button type="button" class="m-btn m-btn-secondary" disabled={busy} onClick={close}>
            Отмена
          </button>
          <button type="submit" class="m-btn m-btn-primary" disabled={busy}>
            {busy ? 'Вхожу…' : 'Войти'}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
