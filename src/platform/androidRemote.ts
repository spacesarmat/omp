// Android TV: the phone remote. The native control server (android/.../control/TvRemote.kt) turns the phone's
// requests into plugin events; here they become the same actions as on LG: launch params, the «Сейчас играет»
// link, remote keys (as webOS key codes through the key bridge) and text for the input field.

import { nativePlugin, OmpNativeTvPlugin, ListenerHandle } from './androidNative';
import { sendKey, BACK_KEY } from './androidKeys';
import { runLaunchParams } from '../launchActions';
import { attachPhone } from '../phone/link';
import { activeServer } from '../store/servers';
import { resetTo } from '../ui/nav';
import { log } from '../lib/log';
import { allSources } from '../sources/registry';
import { applyRemoteIndexers, applyRemoteSources, loginState, notifyTransferApplied, parseRemoteSources, transferLoginNotStored, TRANSFER_TIMEOUT_MS } from '../sources/transfer';
import { tvSourceContext } from '../sources/tvContext';
import type { Source, SourceContext } from '../sources/types';

/** Phone key names → webOS key codes the TV interface understands. */
const KEY_CODES: { [name: string]: number } = {
  UP: 38,
  DOWN: 40,
  LEFT: 37,
  RIGHT: 39,
  ENTER: 13,
  BACK: BACK_KEY,
};

function isObj(v: unknown): v is { [k: string]: unknown } {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function isEditable(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
  if (!el) return false;
  const tag = el.tagName;
  if (tag !== 'INPUT' && tag !== 'TEXTAREA') return false;
  const f = el as HTMLInputElement;
  return !f.disabled && !f.readOnly;
}

/** The field the phone types into: the focused input, else the input of the focused TextInput row. */
export function remoteTextTarget(): HTMLInputElement | HTMLTextAreaElement | null {
  const active = document.activeElement;
  if (isEditable(active)) return active;
  const row = document.querySelector('.text-input.focused input, .text-input.focused textarea');
  return isEditable(row) ? row : null;
}

function caret(el: HTMLInputElement | HTMLTextAreaElement): [number, number] {
  const len = el.value.length;
  try {
    const s = el.selectionStart;
    const e = el.selectionEnd;
    // a field that is not focused reports its caret at the end in some engines, 0 in others: append there
    if (typeof s === 'number' && typeof e === 'number' && document.activeElement === el) return [s, e];
  } catch (err) {
    /* types without selection (number, email) */
  }
  return [len, len];
}

function setValue(el: HTMLInputElement | HTMLTextAreaElement, value: string, pos: number): void {
  el.value = value;
  try {
    if (document.activeElement === el) el.setSelectionRange(pos, pos);
  } catch (err) {
    /* types without selection */
  }
  let ev: Event;
  try {
    ev = new Event('input', { bubbles: true });
  } catch (err) {
    ev = document.createEvent('Event');
    ev.initEvent('input', true, false);
  }
  el.dispatchEvent(ev);
}

function keydownOn(target: EventTarget, code: number): void {
  let e: Event;
  try {
    e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true });
  } catch (err) {
    e = document.createEvent('Event');
    e.initEvent('keydown', true, true);
  }
  Object.defineProperty(e, 'keyCode', { value: code });
  Object.defineProperty(e, 'which', { value: code });
  target.dispatchEvent(e);
}

/** remoteText { text } inserts at the caret, { delete: n } removes n characters before it, { enter } submits. */
export function applyRemoteText(d: unknown): void {
  if (!isObj(d)) return;
  const el = remoteTextTarget();
  if (d.enter === true) {
    keydownOn(el || document.activeElement || document.body, 13);
    return;
  }
  if (!el) return;
  const [s, e] = caret(el);
  const v = el.value;
  if (typeof d.text === 'string') {
    const t = el.tagName === 'INPUT' ? d.text.replace(/[\r\n]+/g, ' ') : d.text;
    if (!t) return;
    setValue(el, v.slice(0, s) + t + v.slice(e), s + t.length);
    return;
  }
  if (typeof d.delete === 'number' && isFinite(d.delete) && d.delete >= 1) {
    const n = Math.floor(d.delete);
    const from = s !== e ? s : Math.max(0, s - n);
    if (from === e) return;
    setValue(el, v.slice(0, from) + v.slice(e), from);
  }
}

/** remoteKey { name }: arrows / OK / Back as key presses, «Каталог» → the library. */
export function applyRemoteKey(d: unknown): void {
  const name = isObj(d) && typeof d.name === 'string' ? d.name : '';
  if (name === 'CATALOG') {
    // the native player (if any) is already closed by the native side
    resetTo(activeServer.value ? { name: 'library' } : { name: 'connect' });
    return;
  }
  const code = KEY_CODES[name];
  if (code !== undefined) sendKey(code);
}

/** remoteAttach { report }: the «Сейчас играет» link only (same check as the launch param). */
export function applyRemoteAttach(d: unknown): void {
  const r = isObj(d) && typeof d.report === 'string' ? d.report.trim() : '';
  if (/^http:\/\//i.test(r) && r.length <= 200) attachPhone(r);
}

let lastSourcesId = '';

/** Forgets the last applied transfer id (tests). */
export function resetRemoteSources(): void {
  lastSourcesId = '';
}

/**
 * remoteSources { id, sources, rutracker, phone, at }: «Передать на телевизор» from the phone. The switches are applied,
 * the saved login is tried, and the native side gets remoteSourcesDone { id, rutracker? } (it answers the phone).
 */
export function applyRemoteSourcesEvent(
  d: unknown,
  plugin: Pick<OmpNativeTvPlugin, 'remoteSourcesDone'>,
  known: () => Source[] = allSources,
  ctx: () => SourceContext = tvSourceContext,
  now: () => number = Date.now,
): Promise<void> {
  const r = parseRemoteSources(d);
  if (r && (r.id === lastSourcesId || (r.at > 0 && now() - r.at > TRANSFER_TIMEOUT_MS))) {
    // the same transfer twice (live event and the pending one) or one the phone has already given up on
    return Promise.resolve();
  }
  if (r) lastSourcesId = r.id;
  if (!r) {
    log('warn', 'tv', 'Передача источников с телефона: неверные данные');
    const id = d && typeof d === 'object' ? (d as { id?: unknown }).id : undefined;
    // the native side waits for an answer: say it failed rather than let the phone wait for the timeout
    if (typeof id !== 'string' || !id) return Promise.resolve();
    return plugin.remoteSourcesDone({ id, failed: true }).then(() => undefined, () => undefined);
  }
  const before = loginState();
  const done = (rutracker?: string, indexers?: number) => {
    const o: { id: string; rutracker?: string; indexers?: number } = { id: r.id };
    if (rutracker) o.rutracker = rutracker;
    if (indexers !== undefined) o.indexers = indexers;
    return plugin.remoteSourcesDone(o).then(
      // a verified login is promoted by the native side before this resolves: the screen reads it now
      (a) => {
        if (rutracker === 'ok' && a && a.stored === false) {
          log('error', 'tv', 'Вход на rutracker проверен, но не сохранён на телевизоре');
          transferLoginNotStored(before);
        } else notifyTransferApplied();
      },
      () => {
        log('warn', 'tv', 'Передача источников с телефона: не удалось ответить');
      },
    );
  };
  const sent = r.indexers ? r.indexers.length : 0;
  // connections first (their keys move to their own entries), so their switches apply to known sources
  const indexers = sent ? applyRemoteIndexers(r, ctx().secrets) : Promise.resolve(0);
  return indexers.then((saved) => applyRemoteSources(r, known(), ctx).then((res) => ({ res, saved }))).then(
    ({ res, saved }) => {
      log(
        (res && res !== 'ok') || saved < sent ? 'warn' : 'info',
        'tv',
        'Источники переданы с телефона' + (res ? ', вход на rutracker: ' + res : '') + (sent ? ', индексаторов: ' + saved + ' из ' + sent : ''),
      );
      return done(res, sent ? saved : undefined);
    },
    () => {
      log('error', 'tv', 'Передача источников с телефона не применилась');
      return plugin.remoteSourcesDone({ id: r.id, failed: true }).then(() => undefined, () => undefined);
    },
  );
}

/** Subscribes to the phone remote events; returns the uninstaller. No-op without the plugin. */
export function installAndroidRemote(plugin: OmpNativeTvPlugin | null = nativePlugin()): () => void {
  if (!plugin) return () => undefined;
  let removed = false;
  const handles: ListenerHandle[] = [];
  const on = (event: string, cb: (d: unknown) => void): Promise<unknown> =>
    plugin.addListener(event, cb).then(
      (h) => {
        if (removed) {
          try { h.remove(); } catch (e) { /* ignore */ }
        } else handles.push(h);
      },
      () => undefined,
    );
  on('remoteLaunch', (d) => { if (isObj(d) && d.params !== undefined) runLaunchParams(d.params); });
  on('remoteAttach', applyRemoteAttach);
  on('remoteKey', applyRemoteKey);
  on('remoteText', applyRemoteText);
  // remoteSources is not retained natively: once listening, ask for the one transfer that may be waiting
  on('remoteSources', (d) => { void applyRemoteSourcesEvent(d, plugin); }).then(() => {
    if (removed || typeof plugin.remoteSourcesPending !== 'function') return undefined;
    return plugin.remoteSourcesPending().then(
      (r) => {
        if (!removed && r && r.event) void applyRemoteSourcesEvent(r.event, plugin);
      },
      () => undefined,
    );
  });
  return () => {
    removed = true;
    handles.splice(0).forEach((h) => {
      try { h.remove(); } catch (e) { /* ignore */ }
    });
  };
}
