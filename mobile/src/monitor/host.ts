// The background page's link to Android (android/.../monitor/MonitorHost.kt). Android adds the object
// `OmpMonitorHost` (androidx.webkit addWebMessageListener, only for this app's origin) to the hidden WebView;
// requests are JSON messages { id, op, ... } and every answer is { id, ok, value | error }.
import { t } from '../../../src/i18n';
import type { NativeHttpRequest } from '../../../src/sources/http';
import type { MonitorSummary } from '../../../src/monitor/settings';
import { sanitizeJournal, type JournalItem } from './journal';

/** A notification button handed to the page: «Добавить» (subscription) or «Заменить» (new episodes). */
export interface MonitorAction {
  kind: 'add' | 'replace';
  subId: string;
  key: string;
}

export interface StartInfo {
  /** null: a scheduled or «Проверить сейчас» check. */
  action: MonitorAction | null;
  /** Unix ms when Android destroys the page. */
  deadline: number;
  /** Dedup markers of earlier runs (journal.ts). */
  journal: JournalItem[];
}

/** One notification; Android builds the buttons and the links into the app from `subId` / `key`. */
export interface MonitorNotification {
  channel: 'subs' | 'episodes';
  /** Stable id: a later notification with the same id replaces this one. */
  id: string;
  subId: string;
  key: string;
  title: string;
  text: string;
  /** The background button. */
  action?: 'add' | 'replace';
}

export interface HttpReply {
  status?: number;
  url?: string;
  text?: string;
}

export interface MonitorHost {
  start(): Promise<StartInfo>;
  http(req: NativeHttpRequest): Promise<HttpReply>;
  secretGet(key: string): Promise<{ value?: string | null }>;
  /** Resolves false when Android could not show it (notifications off or not permitted). */
  notify(n: MonitorNotification): Promise<boolean>;
  /** Stores dedup markers outside localStorage (fsync'ed file). */
  persist(items: JournalItem[]): Promise<void>;
  /** The run is over: Android destroys the page. */
  finish(summary: MonitorSummary): void;
}

/** The object Android injects (a WebMessageListener JS object). */
export interface HostPort {
  postMessage(message: string): void;
  onmessage: ((event: { data: unknown }) => void) | null;
}

export const HOST_NAME = 'OmpMonitorHost';
const failed = (): string => t('notify.noReply');

function parseAction(v: unknown): MonitorAction | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as { kind?: unknown; subId?: unknown; key?: unknown };
  if ((o.kind !== 'add' && o.kind !== 'replace') || typeof o.subId !== 'string' || typeof o.key !== 'string') return null;
  if (!o.subId || !o.key) return null;
  return { kind: o.kind, subId: o.subId, key: o.key };
}

export function bridgeHost(port: HostPort): MonitorHost {
  let next = 1;
  const waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  port.onmessage = (event) => {
    let m: { id?: unknown; ok?: unknown; value?: unknown; error?: unknown };
    try {
      m = typeof event.data === 'string' ? JSON.parse(event.data) : null;
    } catch {
      return;
    }
    if (!m || typeof m.id !== 'number') return;
    const w = waiting.get(m.id);
    if (!w) return;
    waiting.delete(m.id);
    if (m.ok === true) w.resolve(m.value);
    else w.reject(new Error(typeof m.error === 'string' && m.error ? m.error : failed()));
  };
  const send = (op: string, body: object): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const id = next++;
      waiting.set(id, { resolve, reject });
      try {
        port.postMessage(JSON.stringify({ ...body, id, op }));
      } catch {
        waiting.delete(id);
        reject(new Error(failed()));
      }
    });
  return {
    start: () =>
      send('start', {}).then((v) => {
        const o = (v && typeof v === 'object' ? v : {}) as { action?: unknown; deadline?: unknown; journal?: unknown };
        const deadline = typeof o.deadline === 'number' && isFinite(o.deadline) ? o.deadline : Date.now() + 120_000;
        return { action: parseAction(o.action), deadline, journal: sanitizeJournal(o.journal) };
      }),
    http: (req) => send('http', { request: req }).then((v) => (v && typeof v === 'object' ? (v as HttpReply) : {})),
    secretGet: (key) =>
      send('secretGet', { key }).then((v) => {
        const o = (v && typeof v === 'object' ? v : {}) as { value?: unknown };
        return { value: typeof o.value === 'string' ? o.value : null };
      }),
    notify: (n) => send('notify', { notification: n }).then((v) => !!v && typeof v === 'object' && (v as { shown?: unknown }).shown === true),
    persist: (items) => send('persist', { items }).then(() => undefined),
    finish(summary) {
      try {
        port.postMessage(JSON.stringify({ id: next++, op: 'finish', summary }));
      } catch {
        /* Android stops the page at its deadline anyway */
      }
    },
  };
}

/** The injected host, or null when the page is opened anywhere else. */
export function windowHost(): MonitorHost | null {
  const port = (window as unknown as { [HOST_NAME]?: HostPort })[HOST_NAME];
  return port && typeof port.postMessage === 'function' ? bridgeHost(port) : null;
}
