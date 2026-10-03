import { MAX_PHONE_CHAPTERS, MAX_PHONE_CHAPTER_TITLE } from '../player/chapters';
export interface TrackList { list: string[]; sel: number }
export interface SubList { list: { label: string; value: string }[]; sel: string }
export interface PlayerState {
  hash: string; file: number;
  title: string; subtitle: string; poster?: string;
  time: number; duration: number; paused: boolean; buffering: boolean;
  audio: TrackList; subs: SubList;
  next: { title: string } | null;
  /** Chapters of the file (start seconds + title) and the current one (-1 before the first); absent from old TVs. */
  chapters?: { t: number; title: string }[];
  chapter?: number;
}
export interface PhoneMessage { v: 1; app: string; state: PlayerState | null }
export type Cmd =
  | { id: number; type: 'play' | 'pause' | 'next' | 'prev' }
  | { id: number; type: 'seek'; t: number }
  | { id: number; type: 'chapter'; i: number }
  | { id: number; type: 'skip'; d: number }
  | { id: number; type: 'audio'; i: number }
  | { id: number; type: 'subs'; value: string };

export const POST_INTERVAL_MS = 500;
export const LINK_DROP_MS = 20000;
export const STALE_MS = 5000;
export const GONE_MS = 30000;
export const CONTROL_MIN_VERSION = '0.8.0';

const HASH = /^[0-9a-f]{40}$/i;

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}
function num(v: unknown): v is number {
  return typeof v === 'number' && isFinite(v);
}
function int(v: unknown): v is number {
  return num(v) && Math.floor(v) === v;
}

/** Validates one command; null when malformed or unknown. */
export function sanitizeCmd(v: unknown): Cmd | null {
  if (!isObj(v) || !int(v.id)) return null;
  const id = v.id;
  switch (v.type) {
    case 'play':
    case 'pause':
    case 'next':
    case 'prev':
      return { id, type: v.type };
    case 'seek':
      return num(v.t) && v.t >= 0 ? { id, type: 'seek', t: v.t } : null;
    case 'chapter':
      return int(v.i) && v.i >= 0 ? { id, type: 'chapter', i: v.i } : null;
    case 'skip':
      return num(v.d) ? { id, type: 'skip', d: v.d } : null;
    case 'audio':
      return int(v.i) && v.i >= 0 ? { id, type: 'audio', i: v.i } : null;
    case 'subs':
      return typeof v.value === 'string' ? { id, type: 'subs', value: v.value } : null;
    default:
      return null;
  }
}

function strings(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  for (let i = 0; i < v.length; i++) if (typeof v[i] !== 'string') return null;
  return v.slice();
}

function sanitizeState(v: unknown): PlayerState | null {
  if (!isObj(v)) return null;
  if (typeof v.hash !== 'string' || !HASH.test(v.hash) || !int(v.file)) return null;
  if (typeof v.title !== 'string' || typeof v.subtitle !== 'string') return null;
  if (v.poster !== undefined && typeof v.poster !== 'string') return null;
  if (!num(v.time) || !num(v.duration)) return null;
  if (typeof v.paused !== 'boolean' || typeof v.buffering !== 'boolean') return null;
  if (!isObj(v.audio) || !isObj(v.subs)) return null;
  const alist = strings(v.audio.list);
  if (!alist || !int(v.audio.sel)) return null;
  if (!Array.isArray(v.subs.list) || typeof v.subs.sel !== 'string') return null;
  const slist: { label: string; value: string }[] = [];
  for (let i = 0; i < v.subs.list.length; i++) {
    const s: unknown = v.subs.list[i];
    if (!isObj(s) || typeof s.label !== 'string' || typeof s.value !== 'string') return null;
    slist.push({ label: s.label, value: s.value });
  }
  let next: { title: string } | null = null;
  if (v.next !== null && v.next !== undefined) {
    if (!isObj(v.next) || typeof v.next.title !== 'string') return null;
    next = { title: v.next.title };
  }
  const st: PlayerState = {
    hash: v.hash, file: v.file, title: v.title, subtitle: v.subtitle,
    time: v.time, duration: v.duration, paused: v.paused, buffering: v.buffering,
    audio: { list: alist, sel: v.audio.sel }, subs: { list: slist, sel: v.subs.sel }, next,
  };
  if (v.poster !== undefined) st.poster = v.poster;
  if (Array.isArray(v.chapters) && v.chapters.length) {
    const list: { t: number; title: string }[] = [];
    for (let i = 0; i < v.chapters.length && i < MAX_PHONE_CHAPTERS; i++) {
      const c: unknown = v.chapters[i];
      if (!isObj(c) || !num(c.t) || c.t < 0 || typeof c.title !== 'string') return st;
      list.push({ t: c.t, title: c.title.slice(0, MAX_PHONE_CHAPTER_TITLE) });
    }
    st.chapters = list;
    st.chapter = int(v.chapter) && v.chapter >= -1 && v.chapter < list.length ? v.chapter : -1;
  }
  return st;
}

/** Validates a phone message (used by the phone); null when malformed. */
export function sanitizeMessage(v: unknown): PhoneMessage | null {
  if (!isObj(v) || v.v !== 1 || typeof v.app !== 'string') return null;
  if (v.state === null) return { v: 1, app: v.app, state: null };
  const state = sanitizeState(v.state);
  return state ? { v: 1, app: v.app, state } : null;
}
