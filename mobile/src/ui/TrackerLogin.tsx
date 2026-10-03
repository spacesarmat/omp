import { useEffect, useRef, useState } from 'preact/hooks';
import { Sheet } from './Sheet';
import { Icon } from './Icon';
import { errorMessage } from '../../../src/api/http';
import type { Source, SourceContext } from '../../../src/sources/types';

const LOCK = 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3';

/**
 * «Вход на rutracker». The password is never kept in component state: it is read from the field at «Войти»,
 * handed to the source (which stores it in the Android Keystore only) and the field is emptied right away.
 */
export function TrackerLogin({ source, ctx, onClose, onDone }: { source: Source; ctx: () => SourceContext; onClose: () => void; onDone: () => void }) {
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
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

  const close = () => {
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
        <div class="m-marks-actions">
          <button type="button" class="m-btn m-btn-secondary" onClick={close}>
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
