import { useEffect, useState } from 'preact/hooks';
import { setFocus, doesFocusableExist } from '@noriginmedia/norigin-spatial-navigation';
import { FocusGroup, Focusable, Button } from '../ui/components';
import { restoreFocus } from '../ui/focus';
import { confirmDialog } from '../ui/dialog';
import { toast } from '../ui/toast';
import { TrackerLoginDialog } from '../ui/TrackerLoginDialog';
import { errorMessage } from '../api/http';
import { log } from '../lib/log';
import { builtinSources, torrServerSources } from '../sources/registry';
import { clearHealth, getHealth, isSourceOn, onHealthChange, setHealth, setSourceOn } from '../sources/store';
import { forgetTransferredLogin, lastTransfer, onTransferApplied, transferWhen } from '../sources/transfer';
import { tvSourceContext } from '../sources/tvContext';
import { healthText, type HealthLine } from '../sources/view';
import type { Source } from '../sources/types';

/** Names of the TorrServer sources (as on the phone). */
const TS_LABELS: { [id: string]: string } = {
  'ts-rutor': 'rutor (поиск TorrServer)',
  'ts-torznab': 'Jackett / Prowlarr (Torznab)',
};

export const PHONE_HOW =
  'На телефоне: OMP → Настройки → Источники поиска → «Передать на телевизор». Вход на rutracker тоже можно передать — пароль не вводится пультом.';

function label(s: Source): string {
  return TS_LABELS[s.id] || s.name;
}

function Switch(p: { on: boolean }) {
  return (
    <span class={'src-switch' + (p.on ? ' on' : '')}>
      <span class="src-switch-knob" />
    </span>
  );
}

function Note(p: { note: HealthLine | null }) {
  if (!p.note) return null;
  return <span class={'src-note src-note-' + p.note.tone}>{p.note.text}</span>;
}

function TransferNote() {
  const t = lastTransfer();
  if (!t) return <div class="src-last muted">Передач с телефона ещё не было</div>;
  const w = transferWhen(t.at);
  return <div class="src-last">{'Последняя передача: ' + w.day + ' ' + w.time + ' · «' + t.phone + '»'}</div>;
}

/** Android TV «Источники поиска»: switches of every source, rutracker «Войти» / «Выйти», how to send from the phone. */
export function SourcesScreen() {
  const [, setTick] = useState(0);
  const rerender = () => setTick((n) => n + 1);
  const [logged, setLogged] = useState<{ [id: string]: boolean }>({});
  const [loginFor, setLoginFor] = useState<Source | null>(null);
  const ts = torrServerSources();
  const builtins = builtinSources();

  const checkLogins = (alive: () => boolean) => {
    builtins
      .filter((s) => s.needsLogin && s.loggedIn)
      .forEach((s) => {
        s.loggedIn!(tvSourceContext()).then(
          (v) => {
            if (alive()) setLogged((m) => ({ ...m, [s.id]: v }));
          },
          () => {
            if (alive()) setLogged((m) => ({ ...m, [s.id]: false }));
          },
        );
      });
  };

  useEffect(() => {
    let alive = true;
    const isAlive = () => alive;
    restoreFocus('src-first');
    const offHealth = onHealthChange(() => { if (alive) rerender(); });
    // a transfer from the phone may arrive while the screen is open
    const offTransfer = onTransferApplied(() => {
      if (!alive) return;
      rerender();
      checkLogins(isAlive);
    });
    checkLogins(isAlive);
    return () => {
      alive = false;
      offHealth();
      offTransfer();
    };
  }, []);

  const toggle = (s: Source) => {
    setSourceOn(s.id, !isSourceOn(s));
    rerender();
  };

  const loggedIn = (s: Source) => !!logged[s.id];

  const noteOf = (s: Source): HealthLine | null => {
    if (s.needsLogin && s.login) {
      if (!loggedIn(s)) return { text: 'нужен вход', tone: 'muted' };
      const h = getHealth(s.id);
      if (!h) {
        const t = lastTransfer();
        return { text: t && t.rutracker ? 'вход передан с телефона' : 'вход выполнен', tone: 'ok' };
      }
      return healthText(h);
    }
    if (!isSourceOn(s)) return { text: 'выключен', tone: 'muted' };
    return healthText(getHealth(s.id));
  };

  const focusLogin = (s: Source) => {
    const k = 'src-login-' + s.id;
    if (doesFocusableExist(k)) setFocus(k);
  };

  const logout = (s: Source) => {
    if (!s.logout) return;
    confirmDialog('Выйти из ' + s.name + '? Логин и пароль будут удалены с телевизора.', 'Выйти').then((ok) => {
      if (!ok || !s.logout) return;
      s.logout(tvSourceContext()).then(
        () => {
          setLogged((m) => ({ ...m, [s.id]: false }));
          setHealth(s.id, { state: 'login', at: Date.now() });
          forgetTransferredLogin();
          toast('Вы вышли из ' + s.name);
        },
        (e) => {
          log('warn', 'search', 'Выход из источника не удался');
          toast(errorMessage(e), 'error');
        },
      );
    });
  };

  const loginDone = (s: Source) => {
    setLoginFor(null);
    setLogged((m) => ({ ...m, [s.id]: true }));
    // signed in: the source takes part in the search; its real state comes with the next search
    setSourceOn(s.id, true);
    clearHealth(s.id);
    toast('Вход выполнен');
    setTimeout(() => focusLogin(s), 0);
  };

  return (
    <FocusGroup focusKey="SOURCES" className="screen sources">
      <div class="src-layout">
        <div class="src-side">
          <h1>Источники поиска</h1>
          <div class="src-intro">Где искать на экране «Поиск». Включённые сайты опрашиваются все сразу.</div>
          <div class="src-phone">
            <div class="src-phone-title">С телефона</div>
            <div class="src-phone-text">{PHONE_HOW}</div>
            <TransferNote />
          </div>
        </div>
        <div class="src-list">
          <div class="src-group">Через TorrServer</div>
          {ts.map((s, i) => (
            <Focusable key={s.id} focusKey={i === 0 ? 'src-first' : 'src-' + s.id} className="src-row" onPress={() => toggle(s)}>
              <span class="src-name">
                {label(s)}
                <Note note={healthText(getHealth(s.id))} />
              </span>
              <Switch on={isSourceOn(s)} />
            </Focusable>
          ))}
          {builtins.length > 0 && <div class="src-group">Встроенные</div>}
          {builtins.map((s) => {
            const on = isSourceOn(s);
            const login = !!(s.needsLogin && s.login);
            return (
              <div class="src-line" key={s.id} data-source={s.id}>
                <Focusable focusKey={'src-' + s.id} className="src-row src-row-builtin" onPress={() => toggle(s)}>
                  <span class="src-name">
                    {s.name}
                    <Note note={noteOf(s)} />
                  </span>
                  <span class={'src-act' + (on ? ' on' : '')}>{on ? 'вкл' : 'выкл'}</span>
                </Focusable>
                {login && (
                  <Button
                    focusKey={'src-login-' + s.id}
                    className="src-login"
                    label={loggedIn(s) ? 'Выйти' : 'Войти'}
                    onPress={() => (loggedIn(s) ? logout(s) : setLoginFor(s))}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
      {loginFor && (
        <TrackerLoginDialog
          source={loginFor}
          ctx={tvSourceContext}
          onClose={() => {
            const s = loginFor;
            setLoginFor(null);
            setTimeout(() => focusLogin(s), 0);
          }}
          onDone={() => loginDone(loginFor)}
        />
      )}
    </FocusGroup>
  );
}
