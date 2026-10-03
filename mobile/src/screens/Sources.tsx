import { useEffect, useState } from 'preact/hooks';
import { Icon } from '../ui/Icon';
import { TrackerLogin } from '../ui/TrackerLogin';
import { showToast } from '../ui/toast';
import { goBack, navigate } from '../nav';
import { phoneSourceContext } from '../searchContext';
import { errorMessage } from '../../../src/api/http';
import { builtinSources, torrServerSources } from '../../../src/sources/registry';
import { getHealth, isSourceOn, onHealthChange, setHealth, setSourceOn } from '../../../src/sources/store';
import { healthText, JACKETT_HINT, type HealthLine } from '../../../src/sources/view';
import type { Source } from '../../../src/sources/types';

/** Names of the TorrServer sources on this screen. */
const TS_LABELS: Record<string, string> = {
  'ts-rutor': 'rutor (поиск TorrServer)',
  'ts-torznab': 'Jackett / Prowlarr (Torznab)',
};

function label(s: Source): string {
  return TS_LABELS[s.id] || s.name;
}

function SourceRow({
  source,
  note,
  login,
  onToggle,
}: {
  source: Source;
  note: HealthLine | null;
  login?: { loggedIn: boolean; onLogin: () => void; onLogout: () => void };
  onToggle: () => void;
}) {
  const on = isSourceOn(source);
  const name = label(source);
  return (
    <div class="m-src-row" data-source={source.id}>
      <span class="m-src-name">
        <span>{name}</span>
        {note && <span class={'m-src-note' + (note.tone === 'muted' ? '' : ' ' + note.tone)}>{note.text}</span>}
      </span>
      {login &&
        (login.loggedIn ? (
          <button type="button" class="m-btn m-btn-secondary m-btn-sm" onClick={login.onLogout}>
            Выйти
          </button>
        ) : (
          <button type="button" class="m-btn m-btn-secondary m-btn-sm" onClick={login.onLogin}>
            Войти
          </button>
        ))}
      <button type="button" role="switch" aria-checked={on} aria-label={name} class={'m-switch' + (on ? ' on' : '')} onClick={onToggle}>
        <span class="m-switch-knob" />
      </button>
    </div>
  );
}

export function Sources() {
  const [, setTick] = useState(0);
  const rerender = () => setTick((n) => n + 1);
  // sources with a login: saved credentials exist (asked once, no network)
  const [logged, setLogged] = useState<Record<string, boolean>>({});
  const [loginFor, setLoginFor] = useState<Source | null>(null);
  const ts = torrServerSources();
  const builtins = builtinSources();

  useEffect(() => {
    let alive = true;
    const off = onHealthChange(() => alive && rerender());
    builtins
      .filter((s) => s.needsLogin && s.loggedIn)
      .forEach((s) => {
        s.loggedIn!(phoneSourceContext()).then(
          (v) => alive && setLogged((m) => ({ ...m, [s.id]: v })),
          () => alive && setLogged((m) => ({ ...m, [s.id]: false })),
        );
      });
    return () => {
      alive = false;
      off();
    };
  }, []);

  const toggle = (s: Source) => {
    setSourceOn(s.id, !isSourceOn(s));
    rerender();
  };

  const loggedIn = (s: Source) => !!logged[s.id];

  const noteOf = (s: Source): HealthLine | null => {
    if (s.needsLogin && s.login && !loggedIn(s)) return { text: 'нужен вход', tone: 'muted' };
    return healthText(getHealth(s.id));
  };

  const logout = (s: Source) => {
    if (!s.logout) return;
    s.logout(phoneSourceContext()).then(
      () => {
        setLogged((m) => ({ ...m, [s.id]: false }));
        setHealth(s.id, { state: 'login', at: Date.now() });
      },
      (e) => showToast(errorMessage(e)),
    );
  };

  const loggedInDone = (s: Source) => {
    setLoginFor(null);
    setLogged((m) => ({ ...m, [s.id]: true }));
    // signed in: the source works and takes part in the search
    setSourceOn(s.id, true);
    setHealth(s.id, { state: 'ok', at: Date.now() });
  };

  return (
    <div class="m-screen" data-route="sources">
      <div class="m-bar">
        <button type="button" class="m-icon-btn" aria-label="Назад" onClick={() => goBack()}>
          <Icon d="M15 5l-7 7 7 7" />
        </button>
        <h1 class="m-bar-title">Источники поиска</h1>
      </div>
      <section class="m-set-group">
        <div class="m-set-label">Через TorrServer</div>
        <div class="m-set-card m-src-card">
          {ts.map((s) => (
            <SourceRow key={s.id} source={s} note={healthText(getHealth(s.id))} onToggle={() => toggle(s)} />
          ))}
        </div>
      </section>
      {builtins.length > 0 && (
        <section class="m-set-group">
          <div class="m-set-label">Встроенные · на телефоне</div>
          <div class="m-set-card m-src-card">
            {builtins.map((s) => (
              <SourceRow
                key={s.id}
                source={s}
                note={noteOf(s)}
                login={
                  s.needsLogin && s.login
                    ? { loggedIn: loggedIn(s), onLogin: () => setLoginFor(s), onLogout: () => logout(s) }
                    : undefined
                }
                onToggle={() => toggle(s)}
              />
            ))}
          </div>
        </section>
      )}
      <div class="m-hint-warn">
        {JACKETT_HINT}
        <div>
          <button type="button" class="m-link" onClick={() => navigate({ name: 'faq' })}>
            Вопросы и ответы
          </button>
        </div>
      </div>
      {loginFor && (
        <TrackerLogin source={loginFor} ctx={phoneSourceContext} onClose={() => setLoginFor(null)} onDone={() => loggedInDone(loginFor)} />
      )}
    </div>
  );
}
