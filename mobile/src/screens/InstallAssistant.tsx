import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '../ui/Icon';
import { goBack, navigate } from '../nav';
import { showToast } from '../ui/toast';
import { errorMessage } from '../../../src/api/http';
import { HB_REPO_URL } from '../../../src/lib/updateInfo';
import { installPlan, LG_HBC_APP_ID, type DeviceFacts, type InstallPlan, type PlanAction } from '../../../src/lib/installPlan';
import { compareVersions } from '../../../src/lib/version';
import { connectTv, launchLgApp, sessionIp, tvState } from '../tv/tvClient';
import { tvs } from '../tv/tvStore';
import { latestOmpVersion, openUpdateOnTv, tvOpensUpdate } from '../tv/tvUpdate';
import {
  deviceFor,
  installNative,
  rememberDevice,
  searchDevices,
  KIND_NAME,
  type InstallDevice,
  type InstallDeviceKind,
} from '../install/devices';
import { deviceFacts } from '../install/facts';
import { createTakeover, otherConnection, takeoverQuestion, type OtherTv } from '../install/session';
import { Sheet } from '../ui/Sheet';

/** Task 7 plugs the phone installers in here; until then «Установить» is shown disabled. */
export type Installer = (plan: InstallPlan, facts: DeviceFacts) => void;
let installer: Installer | null = null;

export function setInstaller(fn: Installer | null): void {
  installer = fn;
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const BACK = 'M15 5l-7 7 7 7';
const TV_ICON = 'M3 5h18v11H3zM8 20h8';

function Bar(p: { title: string }) {
  return (
    <div class="m-bar">
      <button type="button" class="m-icon-btn" aria-label="Назад" onClick={() => goBack()}>
        <Icon d={BACK} />
      </button>
      <h1 class="m-bar-title">{p.title}</h1>
    </div>
  );
}

/** Line under a device in the list. */
function stateOf(d: InstallDevice, latestAtv: string | null): { text: string; ok: boolean } {
  if (d.kind === 'atv') {
    if (d.ompVersion) {
      const old = !!latestAtv && compareVersions(latestAtv, d.ompVersion) > 0;
      return { text: 'OMP ' + d.ompVersion + (old ? ' — есть ' + latestAtv : ''), ok: !old };
    }
    if (d.cast === 'chromecast') return { text: 'Не поддерживается', ok: false };
    if (!d.online) return { text: 'Сохранён · не найден в сети', ok: false };
    return { text: 'OMP не найден', ok: false };
  }
  if (!d.online) return { text: 'Сохранён · не найден в сети', ok: false };
  return { text: 'Подключусь и проверю, что установлено', ok: false };
}

function Find() {
  const [list, setList] = useState<InstallDevice[]>([]);
  const [searching, setSearching] = useState(true);
  const [latestAtv, setLatestAtv] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [ip, setIp] = useState('');
  const [kind, setKind] = useState<InstallDeviceKind>('lg');
  const [formError, setFormError] = useState('');
  const [round, setRound] = useState(0);

  useEffect(() => {
    let alive = true;
    setSearching(true);
    void searchDevices((l) => alive && setList(l)).then(() => alive && setSearching(false));
    return () => {
      alive = false;
    };
  }, [round]);

  // leaving the list: the native NSD searches stop too
  useEffect(() => () => void installNative().stopDiscovery().catch(() => {}), []);

  useEffect(() => {
    let alive = true;
    void latestOmpVersion('atv').then((v) => alive && setLatestAtv(v));
    return () => {
      alive = false;
    };
  }, []);

  function open(d: InstallDevice) {
    rememberDevice(d);
    navigate({ name: 'install', ip: d.ip, kind: d.kind });
  }

  function submit(e: Event) {
    e.preventDefault();
    const v = ip.trim();
    if (!IPV4.test(v)) {
      setFormError('Введите IP-адрес вида 192.168.1.42');
      return;
    }
    const known = list.find((d) => d.ip === v && d.kind === kind);
    const saved = tvs.value.find((t) => t.ip === v);
    open(
      known || {
        ip: v,
        name: saved?.name || KIND_NAME[kind] + ' ' + v,
        kind,
        online: false,
        saved: !!saved,
      },
    );
  }

  return (
    <div class="m-screen m-install" data-route="install">
      <Bar title="Установить OMP на телевизор" />
      <p class="m-muted m-note">
        {searching ? 'Телефон и телевизор должны быть в одной сети. Ищу устройства…' : 'Телефон и телевизор должны быть в одной сети.'}
      </p>
      <div class="m-install-list">
        {list.map((d) => {
          const st = stateOf(d, latestAtv);
          return (
            <button type="button" key={d.ip} class="m-install-dev" onClick={() => open(d)}>
              <span class={'m-install-dev-icon' + (st.ok ? ' ok' : '')}>
                <Icon d={TV_ICON} size={26} />
              </span>
              <span class="m-install-dev-text">
                <span class="m-install-dev-name">{d.name}</span>
                <span class="m-muted m-small">{[d.model, d.kind === 'atv' ? 'Android TV' : 'LG webOS'].filter(Boolean).join(' · ')}</span>
                <span class={'m-small ' + (st.ok ? 'm-ok' : 'm-accent')}>{st.text}</span>
              </span>
              <span class="m-muted" aria-hidden="true">
                ›
              </span>
            </button>
          );
        })}
      </div>
      {!searching && list.length === 0 && (
        <p class="m-muted m-note">Ничего не нашлось. Проверьте, что телевизор включён и в той же сети, или введите IP вручную.</p>
      )}
      {!searching && (
        <button type="button" class="m-btn m-btn-secondary" onClick={() => setRound(round + 1)}>
          Искать снова
        </button>
      )}
      {manual ? (
        <form class="m-field" onSubmit={submit}>
          <label for="install-ip">IP-адрес телевизора</label>
          <input
            id="install-ip"
            class="m-input"
            type="text"
            inputMode="decimal"
            placeholder="192.168.1.42"
            value={ip}
            onInput={(e) => setIp((e.target as HTMLInputElement).value)}
          />
          <div class="m-seg" role="group" aria-label="Тип телевизора">
            <button type="button" class={kind === 'lg' ? 'on' : ''} aria-pressed={kind === 'lg'} onClick={() => setKind('lg')}>
              LG webOS
            </button>
            <button type="button" class={kind === 'atv' ? 'on' : ''} aria-pressed={kind === 'atv'} onClick={() => setKind('atv')}>
              Android TV
            </button>
            <button type="button" class={kind === 'samsung' ? 'on' : ''} aria-pressed={kind === 'samsung'} onClick={() => setKind('samsung')}>
              Samsung
            </button>
          </div>
          {formError && (
            <div class="m-error" role="alert">
              {formError}
            </div>
          )}
          <button type="submit" class="m-btn m-btn-primary">
            Показать шаги
          </button>
        </form>
      ) : (
        <button type="button" class="m-install-manual" onClick={() => setManual(true)}>
          Ввести IP вручную
        </button>
      )}
      <p class="m-muted m-small">Samsung (Tizen) пока не поддерживается.</p>
    </div>
  );
}

function Steps(p: { ip: string; kind?: InstallDeviceKind }) {
  const device = deviceFor(p.ip, p.kind);
  const [facts, setFacts] = useState<DeviceFacts | null>(null);
  const [checking, setChecking] = useState(true);
  const [round, setRound] = useState(0);
  const [hint, setHint] = useState('');
  const alive = useRef(true);
  const req = useRef(0);
  const takeover = useRef(createTakeover()).current;
  /** Another TV is connected: asked before the assistant connects to this one. */
  const [ask, setAsk] = useState<{ other: OtherTv; proceed: () => void } | null>(null);
  const agreed = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      // leaving the steps: the TV the user was connected to comes back
      void takeover.restore(device.ip);
    };
  }, []);

  /** Runs `go` now, or after «Подключиться» when another TV is connected. */
  function withConsent(go: () => void, onCancel: () => void) {
    const other = agreed.current ? null : otherConnection(device.ip);
    if (!other) {
      takeover.note(device.ip);
      go();
      return;
    }
    setAsk({
      other,
      proceed: () => {
        agreed.current = true;
        setAsk(null);
        takeover.note(device.ip);
        go();
      },
    });
    cancelAsk.current = onCancel;
  }
  const cancelAsk = useRef<() => void>(() => {});

  useEffect(() => {
    setChecking(true);
    setHint('');
    const mine = ++req.current;
    const collect = () =>
      deviceFacts(device).then(
      (f) => {
        if (!alive.current || mine !== req.current) return;
        setFacts(f);
        setChecking(false);
      },
      () => {
        if (!alive.current || mine !== req.current) return;
        setChecking(false);
      },
    );
    // only an LG check connects to the TV
    if (device.kind === 'lg') withConsent(collect, () => goBack());
    else void collect();
  }, [round]);

  const plan = facts ? installPlan(facts) : null;
  const pairing = device.kind === 'lg' && checking && tvState.value === 'pairing' && sessionIp.value === device.ip;

  async function run(a: PlanAction) {
    if (!plan || !facts) return;
    if (a.id === 'pair' || a.id === 'recheck') {
      setRound(round + 1);
    } else if (a.id === 'faq') {
      navigate({ name: 'faq', q: a.faq });
    } else if (a.id === 'link' && a.url) {
      window.open(a.url, '_system');
    } else if (a.id === 'install') {
      if (installer && plan.install) installer(plan, facts);
    } else if (a.id === 'open-hbc') {
      try {
        await launchLgApp(LG_HBC_APP_ID, { launchMode: 'addRepository', url: HB_REPO_URL });
        showToast('Homebrew Channel открыт на телевизоре');
      } catch (e) {
        showToast(errorMessage(e));
      }
    } else if (a.id === 'update-on-tv') {
      await updateOnTv(plan);
    }
  }

  async function updateOnTv(plan: InstallPlan) {
    if (device.kind === 'atv') {
      const saved = tvs.value.find((t) => t.ip === device.ip && t.kind === 'atv' && t.token);
      if (!saved) {
        setHint('Подключите телефон к этому телевизору кодом в разделе «Телевизор» — или на ТВ откройте OMP → Настройки → «Обновление».');
        return;
      }
      const connected = await new Promise<boolean>((resolve) =>
        withConsent(
          () => connectTv(saved, { keepActive: true }).then(() => resolve(true), (e) => (showToast(errorMessage(e)), resolve(false))),
          () => resolve(false),
        ),
      );
      if (!connected) return;
    }
    const opens = !plan.installed || tvOpensUpdate(plan.installed);
    if (!opens) setHint('Эта версия OMP на ТВ не открывает обновление сама. На телевизоре: Настройки → Обновление → «Проверить обновление».');
    try {
      await openUpdateOnTv();
      showToast(opens ? 'На телевизоре открыто обновление OMP' : 'OMP открыт на телевизоре');
    } catch (e) {
      showToast(errorMessage(e));
    }
  }

  return (
    <div class="m-screen m-install" data-route="install-steps">
      <Bar title={plan ? plan.title : device.name} />
      {checking ? (
        <>
          <div class="m-muted m-searching">
            <svg class="m-spin" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#F5B700" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
              <path d="M12 3a9 9 0 1 0 9 9" />
            </svg>
            Проверяю телевизор…
          </div>
          {pairing && <div class="m-hint-warn">Подтвердите подключение на экране телевизора пультом: «Разрешить».</div>}
        </>
      ) : !plan ? (
        <div class="m-error" role="alert">
          Не удалось проверить телевизор
        </div>
      ) : (
        <>
          {plan.subtitle && <div class="m-muted m-note">{plan.subtitle}</div>}
          {plan.steps.length > 0 && (
            <ol class="m-install-steps">
              {plan.steps.map((s, i) => (
                <li key={s.id} class={'m-install-step ' + s.state} aria-current={s.state === 'current' ? 'step' : undefined}>
                  <span class="m-install-mark" aria-hidden="true">
                    {s.state === 'done' ? '✓' : String(i + 1)}
                  </span>
                  <span class="m-install-step-text">
                    <span class="m-install-step-title">{s.title}</span>
                    <span class="m-muted m-small">{s.text}</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
          {plan.notes.map((n) => (
            <div key={n} class="m-hint-warn" role="note">
              {n}
            </div>
          ))}
          {hint && (
            <div class="m-hint-warn" role="status">
              {hint}
            </div>
          )}
          <div class="m-install-actions">
            {plan.actions.map((a) => {
              if (a.id === 'faq' || a.id === 'link') {
                return (
                  <button key={a.id + a.label} type="button" class="m-link" onClick={() => void run(a)}>
                    {a.label}
                  </button>
                );
              }
              const off = a.id === 'install' && (!installer || !plan.install);
              return (
                <button
                  key={a.id}
                  type="button"
                  class={'m-btn ' + (a.primary ? 'm-btn-primary' : 'm-btn-secondary')}
                  disabled={off}
                  data-action={a.id}
                  onClick={() => void run(a)}
                >
                  {a.label}
                </button>
              );
            })}
            {plan.install && !installer && (
              <p class="m-muted m-small" data-install-soon>
                Установка с телефона появится в этом окне.
              </p>
            )}
          </div>
        </>
      )}
      {ask && (
        <Sheet
          label="Подключение к телевизору"
          onClose={() => {
            setAsk(null);
            cancelAsk.current();
          }}
        >
          <p class="m-note">{takeoverQuestion(device.name, ask.other)}</p>
          <button type="button" class="m-btn m-btn-primary" onClick={() => ask.proceed()}>
            Подключиться
          </button>
          <button
            type="button"
            class="m-btn m-btn-secondary"
            onClick={() => {
              setAsk(null);
              cancelAsk.current();
            }}
          >
            Отмена
          </button>
        </Sheet>
      )}
    </div>
  );
}

/** «Установить OMP на телевизор»: the device list, or the steps for one device (`ip`). */
export function InstallAssistant(p: { ip?: string; kind?: InstallDeviceKind }) {
  return p.ip ? <Steps ip={p.ip} kind={p.kind} /> : <Find />;
}
