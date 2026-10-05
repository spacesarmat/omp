import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../../../src/i18n';
import { native } from '../platform/native';
import { Icon } from '../ui/Icon';
import { showToast } from '../ui/toast';
import { navigate } from '../nav';
import { activeTv, ATV_PORT, type SavedTv } from '../tv/tvStore';
import { CodeSheet } from '../ui/CodeSheet';
import { TouchpadSheet } from '../ui/TouchpadSheet';
import { touchpad, cursorGain, scrollFactor } from '../tv/touchpad';
import { linkStatus } from '../tv/playerLink';
import type { FoundOmpTv } from '../platform/native';
import {
  tvState,
  tvError,
  TV_FORGOT,
  pairAtv,
  tvWaking,
  warmUp,
  pressButton,
  moveCursor,
  click,
  scroll,
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
  scroll: (dx: number, dy: number) => Promise<void>;
  volume: (dir: 'up' | 'down') => Promise<void>;
  typeText: (text: string) => Promise<void>;
  deleteText: (n: number) => Promise<void>;
  sendEnter: () => Promise<void>;
  turnOffTv: () => Promise<void>;
  /** Android TV: «Каталог» / «Сейчас играет». */
  pressAtvKey: (name: 'CATALOG' | 'NOWPLAYING') => Promise<void>;
  /** Android TV: pairs again by the code on the TV screen. */
  pairAtv: (found: FoundOmpTv, code: string) => Promise<void>;
  wakeOnLan: (mac: string, ip: string) => Promise<void>;
  warmUp: () => Promise<void>;
  confirm: (text: string) => boolean;
}

const defaults: RemoteActions = {
  pressButton,
  moveCursor,
  click,
  scroll,
  volume,
  typeText,
  deleteText,
  sendEnter,
  turnOffTv,
  pressAtvKey,
  pairAtv,
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
const TUNE = 'M4 7h9M17 7h3M4 17h3M11 17h9M15 4v6M9 14v6';
const KEYBOARD = 'M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10';

function vibrate(): void {
  try {
    navigator.vibrate?.(10);
  } catch {
    /* no vibration support */
  }
}

const stateText = (s: string): string => {
  const map: Record<string, string> = {
    idle: t('remote.state.idle'),
    connecting: t('remote.state.connecting'),
    pairing: t('remote.state.pairing'),
    connected: t('remote.state.connected'),
    error: t('remote.state.error'),
  };
  return map[s] || s;
};

interface Gesture {
  /** Last position sent (the cursor delta is measured from it). */
  x: number;
  y: number;
  sx: number;
  sy: number;
  /** Time of the last sent move / the touch start, for the finger velocity. */
  t: number;
  last: number;
  moved: boolean;
  id: number;
  /** Sub-pixel rest of the scaled delta, carried to the next move. */
  rx: number;
  ry: number;
  /** Latest finger position (also between throttled moves). */
  cx: number;
  cy: number;
}

interface Scroll {
  pts: Record<number, { x: number; y: number }>;
  /** Accumulated vertical finger travel not sent yet. */
  acc: number;
  last: number;
}

/**
 * The strip along the right edge of the touchpad: one finger moving up or down scrolls the TV page (like a laptop
 * touchpad's edge). It keeps its touches to itself, so the cursor does not move and nothing is clicked.
 */
function ScrollStrip({ run }: { run: (p: Promise<void>) => void }) {
  const g = useRef<{ id: number; y: number; acc: number; last: number } | null>(null);
  const flush = (s: { acc: number }) => {
    const dy = Math.round(s.acc * scrollFactor(touchpad.value));
    if (!dy) return;
    s.acc = 0;
    run(act.scroll(0, dy));
  };
  const end = (e: PointerEvent, send: boolean) => {
    e.stopPropagation();
    const s = g.current;
    if (!s || s.id !== e.pointerId) return;
    if (send) flush(s);
    g.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  };
  return (
    <div
      class="m-tp-strip"
      role="scrollbar"
      aria-label={t('remote.scrollStrip')}
      aria-orientation="vertical"
      onPointerDown={(e) => {
        e.stopPropagation();
        if (g.current) return;
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        g.current = { id: e.pointerId, y: e.clientY, acc: 0, last: Date.now() };
      }}
      onPointerMove={(e) => {
        e.stopPropagation();
        const s = g.current;
        if (!s || s.id !== e.pointerId) return;
        s.acc += e.clientY - s.y;
        s.y = e.clientY;
        const now = Date.now();
        if (now - s.last < MOVE_THROTTLE_MS) return;
        s.last = now;
        flush(s);
      }}
      onPointerUp={(e) => end(e, true)}
      onPointerCancel={(e) => end(e, false)}
    >
      <Icon d="M7 14l5-5 5 5" />
      <span class="m-tp-strip-line" />
      <Icon d="M7 10l5 5 5-5" />
    </div>
  );
}

function Touchpad() {
  const st = useRef<Gesture | null>(null);
  const sc = useRef<Scroll | null>(null);
  const run = (p: Promise<void>) => p.catch((e) => showToast(errorMessage(e)));
  const midY = (s: Scroll) => {
    const ys = Object.keys(s.pts).map((k) => s.pts[Number(k)].y);
    return ys.reduce((a, b) => a + b, 0) / ys.length;
  };
  /** Sends the accumulated scroll travel (acc in px of finger movement). */
  const flushScroll = (g: Scroll) => {
    const dy = Math.round(g.acc * scrollFactor(touchpad.value));
    if (!dy) return;
    g.acc = 0;
    run(act.scroll(0, dy));
  };
  const release = (e: PointerEvent) => (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  return (
    <div
      class={'m-touchpad' + (touchpad.value.scrollStrip ? ' with-strip' : '')}
      role="application"
      aria-label={t('remote.touchpad.title')}
      style={{ touchAction: 'none' }}
      onPointerDown={(e) => {
        const el = e.currentTarget as HTMLElement;
        const s = st.current;
        if (s && s.id !== e.pointerId) {
          // a second finger: the gesture becomes a scroll (and can no longer be a tap)
          s.moved = true;
          el.setPointerCapture?.(e.pointerId);
          const g = sc.current || (sc.current = { pts: { [s.id]: { x: s.cx, y: s.cy } }, acc: 0, last: Date.now() });
          g.pts[e.pointerId] = { x: e.clientX, y: e.clientY };
          return;
        }
        if (s) return;
        el.setPointerCapture?.(e.pointerId);
        st.current = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: Date.now(), last: 0, moved: false, id: e.pointerId, rx: 0, ry: 0, cx: e.clientX, cy: e.clientY };
      }}
      onPointerMove={(e) => {
        const s = st.current;
        if (!s) return;
        const g = sc.current;
        if (g) {
          const p = g.pts[e.pointerId];
          if (!p) return;
          const before = midY(g);
          p.x = e.clientX;
          p.y = e.clientY;
          g.acc += midY(g) - before;
          const now = Date.now();
          if (now - g.last < MOVE_THROTTLE_MS) return;
          g.last = now;
          flushScroll(g);
          return;
        }
        if (s.id !== e.pointerId) return;
        s.cx = e.clientX;
        s.cy = e.clientY;
        if (!s.moved && Math.hypot(e.clientX - s.sx, e.clientY - s.sy) > TAP_SLOP) s.moved = true;
        if (!s.moved) return;
        const now = Date.now();
        if (now - s.last < MOVE_THROTTLE_MS) return;
        const dx = e.clientX - s.x;
        const dy = e.clientY - s.y;
        const gain = cursorGain(touchpad.value, Math.hypot(dx, dy) / Math.max(1, now - s.t));
        s.x = e.clientX;
        s.y = e.clientY;
        s.last = now;
        s.t = now;
        const ox = dx * gain + s.rx;
        const oy = dy * gain + s.ry;
        const ix = Math.round(ox);
        const iy = Math.round(oy);
        s.rx = ox - ix;
        s.ry = oy - iy;
        if (ix || iy) run(act.moveCursor(ix, iy));
      }}
      onPointerUp={(e) => {
        const s = st.current;
        if (!s) return;
        const g = sc.current;
        if (g) {
          flushScroll(g);
          delete g.pts[e.pointerId];
          release(e);
          if (!Object.keys(g.pts).length) {
            st.current = null;
            sc.current = null;
          }
          return;
        }
        if (s.id !== e.pointerId) return;
        st.current = null;
        if (!s.moved && touchpad.value.tapClick) {
          vibrate();
          run(act.click());
        }
        release(e);
      }}
      onPointerCancel={(e) => {
        const s = st.current;
        if (!s) return;
        const g = sc.current;
        if (g) {
          delete g.pts[e.pointerId];
          release(e);
          if (!Object.keys(g.pts).length) {
            st.current = null;
            sc.current = null;
          }
          return;
        }
        if (s.id !== e.pointerId) return;
        st.current = null;
        release(e);
      }}
    >
      <span class="m-muted m-small">{t('remote.touchpadArea')}</span>
      {touchpad.value.scrollStrip && <ScrollStrip run={run} />}
    </div>
  );
}

/** Remote screen class: fits the viewport; the mini-player (64 px) and the open keyboard field take room. */
function screenClass(kbd: boolean): string {
  return 'm-screen m-remote' + (linkStatus.value !== 'none' ? ' mini' : '') + (kbd ? ' kbd' : '');
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
      aria-label={t('remote.typeLabel')}
      placeholder={t('remote.typePlaceholder')}
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
      {dpadButton('UP', t('remote.up'), press)}
      {dpadButton('LEFT', t('remote.left'), press)}
      {dpadButton('RIGHT', t('remote.right'), press)}
      {dpadButton('DOWN', t('remote.down'), press)}
      <button type="button" class="m-dpad-ok" onClick={() => press('ENTER')}>
        OK
      </button>
    </div>
  );
}

const atvStateText = (s: string): string => {
  const map: Record<string, string> = {
    idle: t('remote.atvState.idle'),
    connecting: t('remote.atvState.connecting'),
    pairing: t('remote.atvState.pairing'),
    connected: t('remote.atvState.connected'),
    error: t('remote.atvState.error'),
  };
  return map[s] || s;
};

/** Remote for OMP on Android TV (spec item 9): no power, touchpad or channel keys. */
function AtvRemote({ tv }: { tv: SavedTv }) {
  const name = tv.name;
  const state = tvState.value;
  const [kbd, setKbd] = useState(false);
  const [coding, setCoding] = useState(false);
  // the TV forgot this phone (its token was dropped): pair again by the code
  const forgot = !tv.token || (state === 'error' && tvError.value === TV_FORGOT);
  const found: FoundOmpTv = { ip: tv.ip, port: tv.ctlPort || ATV_PORT, name: tv.defaultName ?? tv.name, version: '' };
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
    <div class={screenClass(kbd)} data-route="remote">
      <div class="m-lib-head">
        <div class="m-remote-name">
          <span class="m-remote-title">{name}</span>
          <span class={'m-remote-state' + (state === 'connected' ? ' on' : '')}>
            {t('remote.atvLine', { state: atvStateText(shown) })}
          </span>
        </div>
      </div>
      <p class="m-remote-note">{t('remote.atvNote')}</p>
      {forgot && (
        <div class="m-remote-forgot">
          <div class="m-hint-warn">{TV_FORGOT}</div>
          <button type="button" class="m-btn m-btn-primary" onClick={() => setCoding(true)}>
            {t('remote.pairAgain')}
          </button>
        </div>
      )}
      <div class="m-stage">
        <DPad press={press} />
      </div>
      <div class="m-keyrow">
        <button type="button" class="m-key" onClick={() => press('BACK')}>
          <Icon d={BACK} size={20} /> {t('common.back')}
        </button>
        <button type="button" class="m-key" onClick={() => ompKey('CATALOG')}>
          {t('nav.library')}
        </button>
        <button type="button" class="m-key" onClick={() => ompKey('NOWPLAYING')}>
          {t('remote.nowPlaying')}
        </button>
      </div>
      <div class="m-keyrow">
        <button type="button" class="m-key" aria-label={t('remote.keyboard')} aria-pressed={kbd} onClick={() => setKbd(!kbd)}>
          <Icon d={KEYBOARD} size={20} /> {t('remote.keyboard')}
        </button>
        <div class="m-vol">
          <button type="button" class="m-key" aria-label={t('remote.volDown')} onClick={() => vol('down')}>
            −
          </button>
          <span class="m-vol-label">{t('remote.volShort')}</span>
          <button type="button" class="m-key" aria-label={t('remote.volUp')} onClick={() => vol('up')}>
            +
          </button>
        </div>
      </div>
      {kbd && <TvKeyboard />}
      {coding && (
        <CodeSheet
          tvName={found.name}
          onSubmit={async (code) => {
            await act.pairAtv(found, code);
            setCoding(false);
          }}
          onCancel={() => setCoding(false)}
        />
      )}
    </div>
  );
}

export function Remote() {
  const tv = activeTv.value;
  const state = tvState.value;
  const [mode, setMode] = useState<'buttons' | 'touchpad'>('buttons');
  const [kbd, setKbd] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [tuning, setTuning] = useState(false);

  const tvIp = tv?.ip;
  useEffect(() => {
    if (tvIp) void act.warmUp();
  }, [tvIp]);

  if (!tv) {
    return (
      <div class="m-screen" data-route="remote">
        <h1>{t('nav.remote')}</h1>
        <div class="m-empty">
          <h2>{t('remote.noTvTitle')}</h2>
          <p class="m-muted">{t('remote.noTvText')}</p>
          <button type="button" class="m-btn m-btn-primary" onClick={() => navigate({ name: 'tv' })}>
            {t('remote.noTvButton')}
          </button>
        </div>
      </div>
    );
  }

  if (tv.kind === 'atv') return <AtvRemote tv={tv} />;

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
    if (!act.confirm(t('remote.turnOffAsk', { name: tv.name }))) return;
    try {
      await act.turnOffTv();
      showToast(t('remote.turnedOff'));
    } catch (e) {
      fail(e);
    }
  };
  const on = async () => {
    if (!tv.mac) {
      showToast(t('remote.needOnToConnect'));
      return;
    }
    try {
      await act.wakeOnLan(tv.mac, tv.ip);
    } catch (e) {
      fail(e);
      return;
    }
    showToast(t('remote.turningOn', { name: tv.name }));
    void act.warmUp();
  };
  const media = (label: string, d: string, onClick: () => void, primary = false) => (
    <button type="button" class={'m-media' + (primary ? ' primary' : '')} aria-label={label} onClick={onClick}>
      <Icon d={d} size={22} />
    </button>
  );

  return (
    <div class={screenClass(kbd)} data-route="remote">
      <div class="m-lib-head">
        <div class="m-remote-name">
          <span class="m-remote-title">{tv.name}</span>
          <span class={'m-remote-state' + (state === 'connected' ? ' on' : '')}>{tvWaking.value && state !== 'connected' && state !== 'pairing' ? stateText('connecting') : stateText(state)}</span>
        </div>
        <button type="button" class="m-icon-btn" aria-label={t('remote.touchpad.label')} onClick={() => setTuning(true)}>
          <Icon d={TUNE} />
        </button>
        <button
          type="button"
          class={'m-power' + (state !== 'connected' && state !== 'pairing' && tv.mac ? ' on' : '')}
          aria-label={state === 'connected' || state === 'pairing' ? t('remote.turnOff') : t('remote.turnOn')}
          disabled={state === 'pairing'}
          onClick={() => void (state === 'connected' ? off() : on())}
        >
          <Icon d={POWER} />
        </button>
      </div>
      <div class="m-seg" role="tablist">
        <button type="button" role="tab" aria-selected={mode === 'buttons'} class={mode === 'buttons' ? 'on' : ''} onClick={() => setMode('buttons')}>
          {t('remote.buttons')}
        </button>
        <button type="button" role="tab" aria-selected={mode === 'touchpad'} class={mode === 'touchpad' ? 'on' : ''} onClick={() => setMode('touchpad')}>
          {t('remote.touchpad.title')}
        </button>
      </div>
      {mode === 'buttons' ? (
        <div class="m-stage">
          <DPad press={press} />
        </div>
      ) : (
        <Touchpad />
      )}
      <div class="m-keyrow">
        <button type="button" class="m-key" aria-label={t('common.back')} onClick={() => press('BACK')}>
          <Icon d={BACK} size={20} /> {t('common.back')}
        </button>
        <button type="button" class="m-key" aria-label={t('remote.home')} onClick={() => press('HOME')}>
          <Icon d={HOME} size={20} /> {t('remote.home')}
        </button>
        <button type="button" class="m-key" aria-label={t('remote.menu')} onClick={() => press('MENU')}>
          <Icon d={MENU} size={20} /> {t('remote.menu')}
        </button>
      </div>
      <div class="m-keyrow">
        {media(t('remote.back10s'), REW10, () => press('REWIND'))}
        {media(t('remote.prevEpisode'), PREV, () => press('CHANNELDOWN'))}
        {media(playing ? t('remote.mini.pause') : t('remote.playBtn'), playing ? PAUSE : PLAY, togglePlay, true)}
        {media(t('remote.nextEpisode'), NEXT, () => press('CHANNELUP'))}
        {media(t('remote.fwd10s'), FF10, () => press('FASTFORWARD'))}
      </div>
      <div class="m-keyrow">
        <button type="button" class="m-key" aria-label={t('remote.volDown')} onClick={() => vol('down')}>
          <Icon d={VOL_DOWN} size={20} /> −
        </button>
        <button type="button" class="m-key" aria-label={t('remote.keyboard')} aria-pressed={kbd} onClick={() => setKbd(!kbd)}>
          <Icon d={KEYBOARD} size={20} /> {t('remote.keyboard')}
        </button>
        <button type="button" class="m-key" aria-label={t('remote.volUp')} onClick={() => vol('up')}>
          <Icon d={VOL_UP} size={20} /> +
        </button>
      </div>
      {kbd && <TvKeyboard />}
      {tuning && <TouchpadSheet onClose={() => setTuning(false)} />}
    </div>
  );
}
