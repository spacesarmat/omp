import { useEffect, useState } from 'preact/hooks';
import { Icon } from '../ui/Icon';
import { resetTo, afterConnectRoute } from '../nav';
import { errorMessage } from '../../../src/api/http';
import { localServer, setupLocal, SETUP_STEPS, LOCAL_PORT } from '../server/localServer';
import { TORRSERVER_VERSION } from '../server/torrserverVersion';

const CHECK = 'M5 12.5l4.5 4.5L19 7';
const SPIN = 'M12 3a9 9 0 1 0 9 9';
const DOT = 'M12 12h.01';

export function LocalServer() {
  const [step, setStep] = useState(0);
  const [version, setVersion] = useState(TORRSERVER_VERSION);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setStep(0);
    setError('');
    let current = 0;
    setupLocal((i, v) => {
      if (!alive) return;
      current = i;
      setStep(i);
      setVersion(v);
    }).catch((e) => {
      if (!alive) return;
      setStep(current);
      setError(errorMessage(e));
    });
    return () => {
      alive = false;
    };
  }, [attempt]);

  const labels = ['Подготовка сервера ' + version, 'Запуск в фоне', 'Проверка связи', 'Подключение OMP'];
  const done = step >= SETUP_STEPS;
  const ip = localServer.value.ip;
  return (
    <div class="m-screen" data-route="localServer">
      <h1 class="m-title">TorrServer на телефоне</h1>
      <div class="m-steps">
        {labels.map((label, i) => {
          const state = i < step ? 'ok' : i === step ? (error ? 'fail' : 'run') : 'wait';
          return (
            <div key={i} class={'m-step ' + state} data-state={state}>
              <span class="m-step-dot">
                <Icon d={state === 'ok' ? CHECK : state === 'run' ? SPIN : DOT} size={16} />
              </span>
              <span class="m-step-label">{label}</span>
            </div>
          );
        })}
      </div>
      {error && (
        <>
          <div class="m-error" role="alert">
            {error}
          </div>
          <button type="button" class="m-btn m-btn-secondary" onClick={() => setAttempt(attempt + 1)}>
            Повторить
          </button>
        </>
      )}
      {done && (
        <>
          <div class="m-addr-card">
            <div class="m-muted m-small">Адрес для телевизора</div>
            {ip ? (
              <div class="m-addr">
                {ip}:{LOCAL_PORT}
              </div>
            ) : (
              <div class="m-error">Телефон не в сети Wi‑Fi — телевизор не увидит сервер</div>
            )}
            {localServer.value.vpn && <div class="m-hint-warn" role="alert">Включён VPN — другие устройства могут не видеть сервер. Разрешите в VPN доступ к локальной сети или выключите его.</div>}
            <div class="m-muted m-note">
              На ТВ: Вход → «Найти в сети». Сервер работает, пока телефон включён и в этой сети Wi‑Fi.
            </div>
          </div>
          <button type="button" class="m-btn m-btn-primary" onClick={() => resetTo(afterConnectRoute())}>
            Открыть каталог
          </button>
        </>
      )}
    </div>
  );
}
