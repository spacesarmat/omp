import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../../../src/i18n';
import { native } from '../platform/native';
import { Icon } from '../ui/Icon';
import { showToast } from '../ui/toast';
import { navigate } from '../nav';
import { activeTv, ATV_PORT, isAtv, isTvRenamed, setActiveTv, tvs, type SavedTv } from '../tv/tvStore';
import { TvRenameSheet } from '../ui/TvRenameSheet';
import { useLongPress } from '../ui/longPress';
import { Sheet } from '../ui/Sheet';
import { CodeSheet } from '../ui/CodeSheet';
import { TouchpadSheet } from '../ui/TouchpadSheet';
import { touchpad, cursorGain, scrollFactor } from '../tv/touchpad';
import { linkStatus } from '../tv/playerLink';
import type { FoundOmpTv } from '../platform/native';
import {
  tvState,
  tvError,
  tvForgot,
  pairAtv,
  tvWaking,
  warmUp,
  cancelWarmUp,
  connectTv,
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
import { KeyPump, LONG_PRESS_MS, PadArrows, pressKey, TAP_SLOP as PAD_SLOP } from '../tv/atvPad';
import { errorMessage } from '../../../src/api/http';
import { vibrate } from '../ui/vibrate';
import { ScreenHeader } from '../ui/ScreenHeader';

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
  /** Makes a saved TV the active one and connects with its saved key or token. */
  switchTv: (tv: SavedTv) => Promise<void>;
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
  switchTv: (tv) => {
    // the saved key or token is reused: no pairing again
    cancelWarmUp();
    setActiveTv(tv.ip);
    return connectTv(tv).catch(() => {});
  },
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
const TUNE = 'M4 7h9M17 7h3M4 17h3M11 17h9M15 4v6M9 14v6';
const KEYBOARD = 'M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10';
const MUTE = 'M11 5L6 9H3v6h3l5 4zM22 9l-6 6M16 9l6 6';

/** The four colour keys of the TV remote, left to right (webOS pointer-socket button names). */
const COLOR_KEYS: ReadonlyArray<readonly ['RED' | 'GREEN' | 'YELLOW' | 'BLUE', () => string]> = [
  ['RED', () => t('remote.red')],
  ['GREEN', () => t('remote.green')],
  ['YELLOW', () => t('remote.yellow')],
  ['BLUE', () => t('remote.blue')],
];

/** The TV's name without the maker prefixes LG puts first: «[LG] webOS TV OLED55C9PLA» → «OLED55C9PLA». */
export function shortTvName(name: string): string {
  const short = (name || '').replace(/^\s*\[LG\]\s*/i, '').replace(/^webOS TV\s*/i, '').trim();
  return short || name;
}

/** A saved TV's name as the remote shows it: the user's own name as typed, else the TV's name without LG prefixes. */
export function tvDisplayName(tv: SavedTv): string {
  return isTvRenamed(tv) ? tv.name : shortTvName(tv.name);
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

/** A saved TV that does not answer: the reason and «Повторить», never the setup screen. */
function NoAnswer({ tv }: { tv: SavedTv }) {
  if (tvState.value !== 'error' || tvWaking.value) return null;
  return (
    <div class="m-remote-noanswer" data-no-answer>
      <div class="m-hint-warn" role="status">
        {t('remote.noAnswerTv', { name: tvDisplayName(tv) })}
      </div>
      <button type="button" class="m-btn m-btn-secondary" onClick={() => void act.warmUp()}>
        {t('common.retry')}
      </button>
    </div>
  );
}

/** The state line of a saved TV in the switcher: the live one for the current TV, else saved / needs a code. */
function savedState(tv: SavedTv, current: SavedTv, live: string): string {
  if (tv.ip === current.ip) return live;
  return isAtv(tv) && !tv.token ? t('remote.tvNeedsCode') : t('remote.tvSaved');
}

/**
 * The TV's name in the header; with more than one saved TV it opens a sheet of them (with their state) and one tap
 * switches, reusing the saved LG key or Android TV token.
 */
function TvSwitch({ tv, live, class: cls }: { tv: SavedTv; live: string; class: string }) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const list = tvs.value;
  const multi = list.length >= 2;
  // a long press on the name renames the TV (on the phone only) and never switches it
  const press = useLongPress(
    () => {
      vibrate();
      setOpen(false);
      setRenaming(true);
    },
    () => {
      if (multi) setOpen(true);
    },
  );
  const name = tvDisplayName(tv);
  const sheet = renaming && <TvRenameSheet tv={tv} onClose={() => setRenaming(false)} />;
  if (!multi) {
    return (
      <>
        <span class={cls} data-tv-name {...press}>
          {name}
        </span>
        {sheet}
      </>
    );
  }
  return (
    <>
      <button type="button" class={cls + ' m-remote-switch'} data-tv-name aria-haspopup="dialog" aria-label={t('remote.switchTv') + ': ' + tv.name} {...press}>
        {name} ▾
      </button>
      {sheet}
      {open && (
        <Sheet label={t('remote.switchTitle')} onClose={() => setOpen(false)}>
          <div class="m-sheet-title">{t('remote.switchTitle')}</div>
          {list.map((x) => (
            <button
              key={x.ip}
              type="button"
              class={'m-opt' + (x.ip === tv.ip ? ' on' : '')}
              data-switch-tv={x.ip}
              aria-pressed={x.ip === tv.ip}
              onClick={() => {
                setOpen(false);
                if (x.ip !== tv.ip) void act.switchTv(x);
              }}
            >
              <span class="m-opt-text">
                <span class="m-opt-name">{tvDisplayName(x)}</span>
                <span class="m-opt-sub">{x.ip + ' · ' + savedState(x, tv, live)}</span>
              </span>
            </button>
          ))}
          <button
            type="button"
            class="m-opt"
            data-rename-tv
            onClick={() => {
              setOpen(false);
              setRenaming(true);
            }}
          >
            <span class="m-opt-text">
              <span class="m-opt-name">{t('remote.renameTv')}</span>
              <span class="m-opt-sub">{name}</span>
            </span>
          </button>
        </Sheet>
      )}
    </>
  );
}

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
      class="m-touchpad"
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

/**
 * «Тачпад» for Android TV: the box has no pointer, so a swipe sends arrows, a two-finger swipe Up / Down, a tap OK and a
 * long press Menu (src/tv/atvPad.ts), one key at a time over /omp/key.
 */
const PAD_FEEDBACK: { [k: string]: string } = { UP: '↑', DOWN: '↓', LEFT: '←', RIGHT: '→', ENTER: 'OK' };

function AtvTouchpad() {
  const pump = useRef<KeyPump<RemoteButton> | null>(null);
  if (!pump.current) pump.current = new KeyPump<RemoteButton>((k) => act.pressButton(k), 4, fail);
  const arrows = useRef(new PadArrows());
  const pts = useRef<{ [id: number]: { x: number; y: number } }>({});
  const g = useRef<{ id: number; sx: number; sy: number; t0: number; last: number; moved: boolean; two: boolean; long: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const [fb, setFb] = useState<{ text: string; n: number } | null>(null);
  const fbTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      clearTimer();
      if (fbTimer.current) clearTimeout(fbTimer.current);
    },
    [],
  );
  const send = (keys: RemoteButton[]) => {
    if (!keys.length) return;
    pump.current!.push(keys);
    const text = PAD_FEEDBACK[keys[keys.length - 1]] ?? (keys[keys.length - 1] === 'MENU' ? t('remote.menu') : '');
    if (!text) return;
    // the last key sent shows in the pad centre and fades within ~300 ms (the CSS animation restarts on each new n)
    setFb((p) => ({ text, n: (p?.n ?? 0) + 1 }));
    if (fbTimer.current) clearTimeout(fbTimer.current);
    fbTimer.current = setTimeout(() => setFb(null), 300);
  };
  const end = (e: PointerEvent) => {
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    delete pts.current[e.pointerId];
    const s = g.current;
    if (!s || Object.keys(pts.current).length) return;
    clearTimer();
    g.current = null;
    arrows.current.reset();
    if (e.type !== 'pointerup' || s.two) return;
    const k = pressKey(s.moved, Date.now() - s.t0, s.long);
    if (k) {
      vibrate();
      send([k]);
    }
  };
  return (
    <div
      class="m-touchpad"
      role="application"
      aria-label={t('remote.touchpad.title')}
      data-atv-pad
      style={{ touchAction: 'none' }}
      onPointerDown={(e) => {
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        pts.current[e.pointerId] = { x: e.clientX, y: e.clientY };
        const s = g.current;
        if (s) {
          // a second finger: a scroll from now on, never a tap or a long press
          s.two = true;
          s.moved = true;
          clearTimer();
          return;
        }
        const now = Date.now();
        g.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, t0: now, last: now, moved: false, two: false, long: false };
        clearTimer();
        timer.current = setTimeout(() => {
          const c = g.current;
          if (!c || c.moved || c.two) return;
          c.long = true;
          vibrate();
          send(['MENU']);
        }, LONG_PRESS_MS);
      }}
      onPointerMove={(e) => {
        const s = g.current;
        const p = pts.current[e.pointerId];
        if (!s || !p) return;
        const dx = e.clientX - p.x;
        const dy = e.clientY - p.y;
        p.x = e.clientX;
        p.y = e.clientY;
        const now = Date.now();
        const dt = now - s.last;
        s.last = now;
        if (s.two) {
          // the fingers' mean travel: each moving finger gives half of it with two fingers down
          send(arrows.current.scroll(dy / Math.max(1, Object.keys(pts.current).length), dt));
          return;
        }
        if (e.pointerId !== s.id || s.long) return;
        if (!s.moved && Math.abs(e.clientX - s.sx) + Math.abs(e.clientY - s.sy) > PAD_SLOP) {
          s.moved = true;
          clearTimer();
        }
        if (s.moved) send(arrows.current.move(dx, dy, dt));
      }}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <span class="m-muted m-small">{t('remote.atvPadArea')}</span>
      {fb && (
        <span class="m-pad-fb" key={fb.n} data-pad-feedback aria-hidden="true">
          {fb.text}
        </span>
      )}
    </div>
  );
}

/** A round key with its caption under it (the LG «Кнопки» look). */
function atvRoundKey(label: string, d: string, onClick: () => void) {
  return (
    <div class="m-rkey">
      <button type="button" class="m-rkey-btn" aria-label={label} onClick={onClick}>
        <Icon d={d} size={24} />
      </button>
      <span class="m-rkey-cap" aria-hidden="true">
        {label}
      </span>
    </div>
  );
}

/** Remote for OMP on Android TV: the LG «Кнопки» layout without power, touchpad, channel and media keys. */
function AtvRemote({ tv }: { tv: SavedTv }) {
  const state = tvState.value;
  const [kbd, setKbd] = useState(false);
  const [coding, setCoding] = useState(false);
  const [mode, setMode] = useState<'buttons' | 'touchpad'>('buttons');
  // the TV forgot this phone (its token was dropped): pair again by the code
  const forgot = !tv.token || (state === 'error' && tvError.value === tvForgot());
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
      <ScreenHeader
        title={t('nav.remote')}
        subtitle={
          <span title={tv.name}>
            <TvSwitch tv={tv} live={atvStateText(shown)} class="m-remote-title" />
            {' · '}
            <span class={'m-remote-state' + (state === 'connected' ? ' on' : '')}>{t('remote.atvLine', { state: atvStateText(shown) })}</span>
          </span>
        }
      />
      {!forgot && <NoAnswer tv={tv} />}
      {forgot && (
        <div class="m-remote-forgot">
          <div class="m-hint-warn">{tvForgot()}</div>
          <button type="button" class="m-btn m-btn-primary" onClick={() => setCoding(true)}>
            {t('remote.pairAgain')}
          </button>
        </div>
      )}
      <div class="m-seg" role="tablist">
        <button type="button" role="tab" aria-selected={mode === 'buttons'} class={mode === 'buttons' ? 'on' : ''} onClick={() => setMode('buttons')}>
          {t('remote.buttons')}
        </button>
        <button type="button" role="tab" aria-selected={mode === 'touchpad'} class={mode === 'touchpad' ? 'on' : ''} onClick={() => setMode('touchpad')}>
          {t('remote.swipes')}
        </button>
      </div>
      {mode === 'touchpad' ? (
        <div class="m-rt" data-atv-remote>
          <AtvTouchpad />
          <div class="m-rb-row m-rt-keys">
            <button type="button" class="m-key" aria-label={t('common.back')} onClick={() => press('BACK')}>
              <Icon d={BACK} size={22} />
            </button>
            <button type="button" class="m-key" aria-label={t('remote.home')} onClick={() => ompKey('CATALOG')}>
              <Icon d={HOME} size={20} /> {t('remote.home')}
            </button>
            <button type="button" class="m-key" aria-label={t('remote.menu')} onClick={() => press('MENU')}>
              <Icon d={MENU} size={20} /> {t('remote.menu')}
            </button>
            <button type="button" class="m-key" aria-label={t('remote.keyboard')} aria-pressed={kbd} onClick={() => setKbd(!kbd)}>
              <Icon d={KEYBOARD} size={22} />
            </button>
          </div>
          <div class="m-vol m-rt-vol">
            <button type="button" class="m-key" aria-label={t('remote.volDown')} onClick={() => vol('down')}>
              −
            </button>
            <span class="m-vol-label">{t('remote.volume')}</span>
            <button type="button" class="m-key" aria-label={t('remote.volUp')} onClick={() => vol('up')}>
              +
            </button>
          </div>
        </div>
      ) : (
      /* the layout of the LG «Кнопки» remote: what OMP on Android TV cannot do (power, pointer, channels) is left out */
      <div class="m-rb" data-atv-remote>
        <div class="m-stage m-rb-pad">
          <DPad press={press} />
        </div>
        <div class="m-rb-colors">
          {COLOR_KEYS.map(([n, label]) => (
            <button key={n} type="button" class={'m-ckey m-ckey-' + n.toLowerCase()} aria-label={label()} onClick={() => press(n)} />
          ))}
        </div>
        <div class="m-rb-round">
          {atvRoundKey(t('common.back'), BACK, () => press('BACK'))}
          {/* «Домой» on Android TV: the OMP catalog */}
          {atvRoundKey(t('remote.home'), HOME, () => ompKey('CATALOG'))}
          {atvRoundKey(t('remote.menu'), MENU, () => press('MENU'))}
        </div>
        <div class="m-rb-bottom">
          <div class="m-rocker">
            <button type="button" class="m-rocker-btn" aria-label={t('remote.volUp')} onClick={() => vol('up')}>
              <span class="m-rocker-sign">+</span>
            </button>
            <span class="m-rocker-cap">{t('remote.volShort')}</span>
            <button type="button" class="m-rocker-btn" aria-label={t('remote.volDown')} onClick={() => vol('down')}>
              <span class="m-rocker-sign">−</span>
            </button>
          </div>
          <div class="m-rb-play">
            <button type="button" class="m-rb-playbtn" aria-label={t('remote.nowPlaying')} onClick={() => ompKey('NOWPLAYING')}>
              <Icon d={PLAY} size={26} />
            </button>
            <span class="m-rocker-cap">{t('remote.nowPlaying')}</span>
          </div>
          <div class="m-rocker">
            <button type="button" class="m-rocker-btn" aria-label={t('remote.keyboard')} aria-pressed={kbd} onClick={() => setKbd(!kbd)}>
              <Icon d={KEYBOARD} size={24} />
            </button>
            <span class="m-rocker-cap">{t('remote.kbdShort')}</span>
          </div>
        </div>
      </div>
      )}
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
        <ScreenHeader title={t('nav.remote')} />
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
  const roundKey = (label: string, d: string, onClick: () => void) => (
    <div class="m-rkey">
      <button type="button" class="m-rkey-btn" aria-label={label} onClick={onClick}>
        <Icon d={d} size={24} />
      </button>
      <span class="m-rkey-cap" aria-hidden="true">{label}</span>
    </div>
  );
  const shownState = tvWaking.value && state !== 'connected' && state !== 'pairing' ? stateText('connecting') : stateText(state);
  const backKey = (
    <button type="button" class="m-key" aria-label={t('common.back')} onClick={() => press('BACK')}>
      <Icon d={BACK} size={22} />
    </button>
  );
  const keyboardKey = (
    <button type="button" class="m-key" aria-label={t('remote.keyboard')} aria-pressed={kbd} onClick={() => setKbd(!kbd)}>
      <Icon d={KEYBOARD} size={22} />
    </button>
  );
  const homeKey = (
    <button type="button" class="m-key" aria-label={t('remote.home')} onClick={() => press('HOME')}>
      <Icon d={HOME} size={20} /> {t('remote.home')}
    </button>
  );
  const menuKey = (
    <button type="button" class="m-key" aria-label={t('remote.menu')} onClick={() => press('MENU')}>
      <Icon d={MENU} size={20} /> {t('remote.menu')}
    </button>
  );
  const mediaRow = (
    <div class="m-rb-row m-rb-media">
      {media(t('remote.back10s'), REW10, () => press('REWIND'))}
      {media(t('remote.prevEpisode'), PREV, () => press('CHANNELDOWN'))}
      {media(playing ? t('remote.mini.pause') : t('remote.playBtn'), playing ? PAUSE : PLAY, togglePlay, true)}
      {media(t('remote.nextEpisode'), NEXT, () => press('CHANNELUP'))}
      {media(t('remote.fwd10s'), FF10, () => press('FASTFORWARD'))}
    </div>
  );

  return (
    <div class={screenClass(kbd)} data-route="remote">
      <ScreenHeader
        title={t('nav.remote')}
        subtitle={
          <span title={tv.name}>
            <TvSwitch tv={tv} live={shownState} class="m-remote-title" />
            {' · '}
            <span class={'m-remote-state' + (state === 'connected' ? ' on' : '')}>{shownState}</span>
          </span>
        }
      >
        <button type="button" class="m-tvchip m-head-btn" aria-label={t('remote.touchpad.label')} onClick={() => setTuning(true)}>
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
      </ScreenHeader>
      <NoAnswer tv={tv} />
      <div class="m-seg" role="tablist">
        <button type="button" role="tab" aria-selected={mode === 'buttons'} class={mode === 'buttons' ? 'on' : ''} onClick={() => setMode('buttons')}>
          {t('remote.buttons')}
        </button>
        <button type="button" role="tab" aria-selected={mode === 'touchpad'} class={mode === 'touchpad' ? 'on' : ''} onClick={() => setMode('touchpad')}>
          {t('remote.touchpad.title')}
        </button>
      </div>
      {mode === 'buttons' ? (
        <div class="m-rb">
          <div class="m-stage m-rb-pad">
            <DPad press={press} />
          </div>
          <div class="m-rb-colors">
            {COLOR_KEYS.map(([name, label]) => (
              <button key={name} type="button" class={'m-ckey m-ckey-' + name.toLowerCase()} aria-label={label()} onClick={() => press(name)} />
            ))}
          </div>
          <div class="m-rb-round">
            {roundKey(t('common.back'), BACK, () => press('BACK'))}
            {roundKey(t('remote.home'), HOME, () => press('HOME'))}
            {roundKey(t('remote.menu'), MENU, () => press('MENU'))}
          </div>
          <div class="m-rb-bottom">
            <div class="m-rocker">
              <button type="button" class="m-rocker-btn" aria-label={t('remote.volUp')} onClick={() => vol('up')}>
                <span class="m-rocker-sign">+</span>
              </button>
              <span class="m-rocker-cap">{t('remote.volShort')}</span>
              <button type="button" class="m-rocker-btn" aria-label={t('remote.volDown')} onClick={() => vol('down')}>
                <span class="m-rocker-sign">−</span>
              </button>
            </div>
            <div class="m-rb-play">
              <button
                type="button"
                class="m-rb-playbtn"
                aria-label={playing ? t('remote.mini.pause') : t('remote.playBtn')}
                onClick={togglePlay}
              >
                <Icon d={playing ? PAUSE : PLAY} size={26} />
              </button>
              <div class="m-rb-seek">
                <button type="button" class="m-rb-seekbtn" aria-label={t('remote.back10s')} onClick={() => press('REWIND')}>
                  <Icon d={REW10} size={20} />
                </button>
                <button type="button" class="m-rb-seekbtn" aria-label={t('remote.fwd10s')} onClick={() => press('FASTFORWARD')}>
                  <Icon d={FF10} size={20} />
                </button>
              </div>
            </div>
            <div class="m-rocker">
              <button type="button" class="m-rocker-btn" aria-label={t('remote.keyboard')} aria-pressed={kbd} onClick={() => setKbd(!kbd)}>
                <Icon d={KEYBOARD} size={24} />
              </button>
              <span class="m-rocker-cap">{t('remote.kbdShort')}</span>
              <button type="button" class="m-rocker-btn" aria-label={t('remote.mute')} onClick={() => press('MUTE')}>
                <Icon d={MUTE} size={24} />
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div class="m-rt">
          <Touchpad />
          <div class="m-rb-row m-rt-keys">
            {backKey}
            {homeKey}
            {menuKey}
            {keyboardKey}
          </div>
          {mediaRow}
          <div class="m-vol m-rt-vol">
            <button type="button" class="m-key" aria-label={t('remote.volDown')} onClick={() => vol('down')}>
              −
            </button>
            <span class="m-vol-label">{t('remote.volume')}</span>
            <button type="button" class="m-key" aria-label={t('remote.volUp')} onClick={() => vol('up')}>
              +
            </button>
          </div>
        </div>
      )}
      {kbd && <TvKeyboard />}
      {tuning && <TouchpadSheet onClose={() => setTuning(false)} />}
    </div>
  );
}
