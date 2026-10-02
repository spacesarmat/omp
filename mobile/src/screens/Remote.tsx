import { useEffect, useRef, useState } from 'preact/hooks';
import { native } from '../platform/native';
import { Icon } from '../ui/Icon';
import { showToast } from '../ui/toast';
import { navigate } from '../nav';
import { activeTv } from '../tv/tvStore';
import {
  tvState,
  tvWaking,
  warmUp,
  pressButton,
  moveCursor,
  click,
  volume,
  typeText,
  deleteText,
  sendEnter,
  turnOffTv,
  pressAtvKey,
} from '../tv/tvClient';
import type { RemoteButton } from '../tv/ssap';
import { errorMessage } from '../../../src/api/http';

export interface RemoteActions {
  pressButton: (name: RemoteButton) => Promise<void>;
  moveCursor: (dx: number, dy: number) => Promise<void>;
  click: () => Promise<void>;
  volume: (dir: 'up' | 'down') => Promise<void>;
  typeText: (text: string) => Promise<void>;
  deleteText: (n: number) => Promise<void>;
  sendEnter: () => Promise<void>;
  turnOffTv: () => Promise<void>;
  /** Android TV: «Каталог» / «Сейчас играет». */
  pressAtvKey: (name: 'CATALOG' | 'NOWPLAYING') => Promise<void>;
  wakeOnLan: (mac: string, ip: string) => Promise<void>;
  warmUp: () => Promise<void>;
  confirm: (text: string) => boolean;
}

const defaults: RemoteActions = {
  pressButton,
  moveCursor,
  click,
  volume,
  typeText,
  deleteText,
  sendEnter,
  turnOffTv,
  pressAtvKey,
  wakeOnLan: (mac, ip) => native.wakeOnLan(mac, ip),
  warmUp,
  confirm: (t) => window.confirm(t),
};

let act: RemoteActions = defaults;

/** Replaces TV side effects (tests); null restores the real ones. */
export function setRemoteActions(a: Partial<RemoteActions> | null): void {
  act = a ? { ...defaults, ...a } : defaults;
}

const MOVE_THROTTLE_MS = 30;
const TAP_SLOP = 6;

const ARROW = {
  UP: 'M6 15l6-6 6 6',
  DOWN: 'M6 9l6 6 6-6',
  LEFT: 'M15 6l-6 6 6 6',
  RIGHT: 'M9 6l6 6-6 6',
};
const POWER = 'M12 3v8M6.3 6.5a8 8 0 1 0 11.4 0';
const BACK = 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3';
const HOME = 'M3 11l9-8 9 8M5 10v10h14V10';
const MENU = 'M4 6h16M4 12h16M4 18h16';
const REW10 = 'M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4';
const PREV = 'M18 6l-9 6 9 6zM6 6v12';
const PAUSE = 'M8 5v14M16 5v14';
const PLAY = 'M7 5l12 7-12 7z';
const NEXT = 'M6 6l9 6-9 6zM18 6v12';
const FF10 = 'M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4';
const VOL_DOWN = 'M4 10v4h4l5 4V6L8 10z';
const VOL_UP = 'M4 10v4h4l5 4V6L8 10zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11';
const KEYBOARD = 'M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10';

function vibrate(): void {
  try {
    navigator.vibrate?.(10);
  } catch {
    /* no vibration support */
  }
}

const STATE_TEXT: Record<string, string> = {
  idle: 'Не подключён',
  connecting: 'Подключение…',
  pairing: 'Подтвердите на ТВ',
  connected: 'Подключён',
  error: 'Нет связи',
};

interface Gesture {
  x: number;
  y: number;
  sx: number;
  sy: number;
  last: number;
  moved: boolean;
  id: number;
}

function Touchpad() {
  const st = useRef<Gesture | null>(null);
  const run = (p: Promise<void>) => p.catch((e) => showToast(errorMessage(e)));
  return (
    <div
      class="m-touchpad"
      role="application"
      aria-label="Тачпад"
      style={{ touchAction: 'none' }}
      onPointerDown={(e) => {
        if (st.current) return;
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        st.current = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, last: 0, moved: false, id: e.pointerId };
      }}
      onPointerMove={(e) => {
        const s = st.current;
        if (!s || s.id !== e.pointerId) return;
        if (!s.moved && Math.hypot(e.clientX - s.sx, e.clientY - s.sy) > TAP_SLOP) s.moved = true;
        if (!s.moved) return;
        const now = Date.now();
        if (now - s.last < MOVE_THROTTLE_MS) return;
        const dx = e.clientX - s.x;
        const dy = e.clientY - s.y;
        s.x = e.clientX;
        s.y = e.clientY;
        s.last = now;
        if (dx || dy) run(act.moveCursor(dx, dy));
      }}
      onPointerUp={(e) => {
        const s = st.current;
        if (!s || s.id !== e.pointerId) return;
        st.current = null;
        if (!s.moved) {
          vibrate();
          run(act.click());
        }
        (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
      }}
      onPointerCancel={(e) => {
        const s = st.current;
        if (!s || s.id !== e.pointerId) return;
        st.current = null;
        (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
      }}
    >
      <span class="m-muted m-small">Проведите пальцем · касание — клик</span>
    </div>
  );
}

const fail = (e: unknown) => showToast(errorMessage(e));

/** Text field whose edits are mirrored into the focused field on the TV. */
function TvKeyboard() {
  const sent = useRef('');
  const composing = useRef(false);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const field = useRef<HTMLInputElement>(null);

  /** The TV cursor sits at the end: delete back to the common prefix, then type the rest. */
  const syncText = (next: string) => {
    const prev = sent.current;
    let p = 0;
    while (p < prev.length && p < next.length && prev[p] === next[p]) p++;
    sent.current = next;
    const del = prev.length - p;
    const add = next.slice(p);
    if (!del && !add) return;
    // serialised so rapid edits reach the TV in order
    queue.current = queue.current.then(async () => {
      try {
        if (del) await act.deleteText(del);
        if (add) await act.typeText(add);
      } catch (e) {
        fail(e);
      }
    });
  };

  return (
    <input
      ref={field}
      class="m-input"
      aria-label="Ввод на телевизоре"
      placeholder="Печатайте — текст уйдёт на ТВ"
      onCompositionStart={() => (composing.current = true)}
      onCompositionEnd={(e) => {
        composing.current = false;
        syncText((e.target as HTMLInputElement).value);
      }}
      onInput={(e) => {
        if (composing.current || (e as unknown as InputEvent).isComposing) return;
        syncText((e.target as HTMLInputElement).value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          sent.current = '';
          if (field.current) field.current.value = '';
          queue.current = queue.current.then(() => act.sendEnter()).catch(fail);
        } else if (e.key === 'Backspace' && !sent.current) {
          queue.current = queue.current.then(() => act.deleteText(1)).catch(fail);
        }
      }}
    />
  );
}

function dpadButton(name: 'UP' | 'DOWN' | 'LEFT' | 'RIGHT', label: string, press: (n: RemoteButton) => void) {
  return (
    <button type="button" class={'m-dpad m-dpad-' + name.toLowerCase()} aria-label={label} onClick={() => press(name)}>
      <Icon d={ARROW[name]} size={28} />
    </button>
  );
}

function DPad({ press }: { press: (n: RemoteButton) => void }) {
  return (
    <div class="m-dpad-wrap">
      {dpadButton('UP', 'Вверх', press)}
      {dpadButton('LEFT', 'Влево', press)}
      {dpadButton('RIGHT', 'Вправо', press)}
      {dpadButton('DOWN', 'Вниз', press)}
      <button type="button" class="m-dpad-ok" onClick={() => press('ENTER')}>
        OK
      </button>
    </div>
  );
}

const ATV_STATE: Record<string, string> = {
  idle: 'не подключён',
  connecting: 'подключение…',
  pairing: 'подключение…',
  connected: 'подключён',
  error: 'нет связи',
};

/** Remote for OMP on Android TV (spec item 9): no power, touchpad or channel keys. */
function AtvRemote({ name }: { name: string }) {
  const state = tvState.value;
  const [kbd, setKbd] = useState(false);
  const press = (n: RemoteButton) => {
    vibrate();
    act.pressButton(n).catch(fail);
  };
  const ompKey = (n: 'CATALOG' | 'NOWPLAYING') => {
    vibrate();
    act.pressAtvKey(n).catch(fail);
  };
  const vol = (dir: 'up' | 'down') => {
    vibrate();
    act.volume(dir).catch(fail);
  };
  const shown = tvWaking.value && state !== 'connected' ? 'connecting' : state;
  return (
    <div class="m-screen" data-route="remote">
      <div class="m-lib-head">
        <div class="m-remote-name">
          <span class="m-remote-title">{name}</span>
          <span class={'m-remote-state' + (state === 'connected' ? ' on' : '')}>
            {'Android TV · ' + (ATV_STATE[shown] || shown)}
          </span>
        </div>
      </div>
      <p class="m-remote-note">Пульт управляет OMP на телевизоре. Включение ТВ и другие приложения — пультом от телевизора.</p>
      <DPad press={press} />
      <div class="m-keyrow">
        <button type="button" class="m-key" onClick={() => press('BACK')}>
          <Icon d={BACK} size={20} /> Назад
        </button>
        <button type="button" class="m-key" onClick={() => ompKey('CATALOG')}>
          Каталог
        </button>
        <button type="button" class="m-key" onClick={() => ompKey('NOWPLAYING')}>
          Сейчас играет
        </button>
      </div>
      <div class="m-keyrow">
        <button type="button" class="m-key" aria-label="Клавиатура" aria-pressed={kbd} onClick={() => setKbd(!kbd)}>
          <Icon d={KEYBOARD} size={20} /> Клавиатура
        </button>
        <div class="m-vol">
          <button type="button" class="m-key" aria-label="Тише" onClick={() => vol('down')}>
            −
          </button>
          <span class="m-vol-label">Громк.</span>
          <button type="button" class="m-key" aria-label="Громче" onClick={() => vol('up')}>
            +
          </button>
        </div>
      </div>
      {kbd && <TvKeyboard />}
    </div>
  );
}

export function Remote() {
  const tv = activeTv.value;
  const state = tvState.value;
  const [mode, setMode] = useState<'buttons' | 'touchpad'>('buttons');
  const [kbd, setKbd] = useState(false);
  const [playing, setPlaying] = useState(true);

  const tvIp = tv?.ip;
  useEffect(() => {
    if (tvIp) void act.warmUp();
  }, [tvIp]);

  if (!tv) {
    return (
      <div class="m-screen" data-route="remote">
        <h1>Пульт</h1>
        <div class="m-empty">
          <h2>Подключите телевизор</h2>
          <p class="m-muted">Чтобы управлять ТВ с телефона, сначала подключите его.</p>
          <button type="button" class="m-btn m-btn-primary" onClick={() => navigate({ name: 'tv' })}>
            Подключить ТВ
          </button>
        </div>
      </div>
    );
  }

  if (tv.kind === 'atv') return <AtvRemote name={tv.name} />;

  const press = (name: RemoteButton) => {
    vibrate();
    act.pressButton(name).catch(fail);
  };
  const togglePlay = () => {
    vibrate();
    act
      .pressButton(playing ? 'PAUSE' : 'PLAY')
      .then(() => setPlaying(!playing))
      .catch(fail);
  };
  const vol = (dir: 'up' | 'down') => {
    vibrate();
    act.volume(dir).catch(fail);
  };
  const off = async () => {
    if (!act.confirm('Выключить ' + tv.name + '?')) return;
    try {
      await act.turnOffTv();
      showToast('Телевизор выключается');
    } catch (e) {
      fail(e);
    }
  };
  const on = async () => {
    if (!tv.mac) {
      showToast('Подключитесь к телевизору, когда он включён, — тогда его можно будет включать с телефона');
      return;
    }
    try {
      await act.wakeOnLan(tv.mac, tv.ip);
    } catch (e) {
      fail(e);
      return;
    }
    showToast('Включаю ' + tv.name + '…');
    void act.warmUp();
  };
  const media = (label: string, d: string, onClick: () => void, primary = false) => (
    <button type="button" class={'m-media' + (primary ? ' primary' : '')} aria-label={label} onClick={onClick}>
      <Icon d={d} size={22} />
    </button>
  );

  return (
    <div class="m-screen" data-route="remote">
      <div class="m-lib-head">
        <div class="m-remote-name">
          <span class="m-remote-title">{tv.name}</span>
          <span class={'m-remote-state' + (state === 'connected' ? ' on' : '')}>{tvWaking.value && state !== 'connected' && state !== 'pairing' ? STATE_TEXT.connecting : STATE_TEXT[state] || state}</span>
        </div>
        <button
          type="button"
          class={'m-power' + (state !== 'connected' && state !== 'pairing' && tv.mac ? ' on' : '')}
          aria-label={state === 'connected' || state === 'pairing' ? 'Выключить телевизор' : 'Включить телевизор'}
          disabled={state === 'pairing'}
          onClick={() => void (state === 'connected' ? off() : on())}
        >
          <Icon d={POWER} />
        </button>
      </div>
      <div class="m-seg" role="tablist">
        <button type="button" role="tab" aria-selected={mode === 'buttons'} class={mode === 'buttons' ? 'on' : ''} onClick={() => setMode('buttons')}>
          Кнопки
        </button>
        <button type="button" role="tab" aria-selected={mode === 'touchpad'} class={mode === 'touchpad' ? 'on' : ''} onClick={() => setMode('touchpad')}>
          Тачпад
        </button>
      </div>
      {mode === 'buttons' ? (
        <DPad press={press} />
      ) : (
        <Touchpad />
      )}
      <div class="m-keyrow">
        <button type="button" class="m-key" aria-label="Назад" onClick={() => press('BACK')}>
          <Icon d={BACK} size={20} /> Назад
        </button>
        <button type="button" class="m-key" aria-label="Домой" onClick={() => press('HOME')}>
          <Icon d={HOME} size={20} /> Домой
        </button>
        <button type="button" class="m-key" aria-label="Меню" onClick={() => press('MENU')}>
          <Icon d={MENU} size={20} /> Меню
        </button>
      </div>
      <div class="m-keyrow">
        {media('Назад на 10 с', REW10, () => press('REWIND'))}
        {media('Пред. серия', PREV, () => press('CHANNELDOWN'))}
        {media(playing ? 'Пауза' : 'Воспроизвести', playing ? PAUSE : PLAY, togglePlay, true)}
        {media('След. серия', NEXT, () => press('CHANNELUP'))}
        {media('Вперёд на 10 с', FF10, () => press('FASTFORWARD'))}
      </div>
      <div class="m-keyrow">
        <button type="button" class="m-key" aria-label="Тише" onClick={() => vol('down')}>
          <Icon d={VOL_DOWN} size={20} /> −
        </button>
        <button type="button" class="m-key" aria-label="Клавиатура" aria-pressed={kbd} onClick={() => setKbd(!kbd)}>
          <Icon d={KEYBOARD} size={20} /> Клавиатура
        </button>
        <button type="button" class="m-key" aria-label="Громче" onClick={() => vol('up')}>
          <Icon d={VOL_UP} size={20} /> +
        </button>
      </div>
      {kbd && <TvKeyboard />}
    </div>
  );
}
