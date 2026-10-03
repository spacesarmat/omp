// Install assistant: inspecting a TV needs a connection to it. The TV the user was connected to is asked about
// first and given back when the assistant closes; the inspected TV never becomes the active one.
import { connectTv, disconnectTv, sessionIp, tvState } from '../tv/tvClient';
import { tvs, type SavedTv } from '../tv/tvStore';

export interface OtherTv {
  ip: string;
  name: string;
}

const LIVE = ['connected', 'connecting', 'pairing'];

/** The TV the phone is connected (or connecting) to when it is not `ip`; null otherwise. */
export function otherConnection(ip: string): OtherTv | null {
  const cur = sessionIp.value;
  if (!cur || cur === ip || LIVE.indexOf(tvState.value) < 0) return null;
  const saved = tvs.value.find((t) => t.ip === cur);
  return { ip: cur, name: saved ? saved.name : cur };
}

/** «Подключиться к «B»? Текущее подключение к «A» будет закрыто». */
export function takeoverQuestion(target: string, other: OtherTv): string {
  return 'Подключиться к «' + target + '»? Текущее подключение к «' + other.name + '» будет закрыто.';
}

export interface Takeover {
  /** Call right before connecting to `ip`: remembers what was connected (once per screen). */
  note(ip: string): void;
  /** Gives the previous connection back if the session is still on `ip`. */
  restore(ip: string): Promise<void>;
}

export function createTakeover(): Takeover {
  // undefined = nothing taken over; null = nothing was connected before
  let prev: SavedTv | null | undefined;
  return {
    note(ip) {
      if (prev !== undefined) return;
      const cur = sessionIp.value;
      if (cur === ip && tvState.value === 'connected') return;
      prev = cur && cur !== ip && LIVE.indexOf(tvState.value) >= 0 ? tvs.value.find((t) => t.ip === cur) || null : null;
    },
    async restore(ip) {
      if (prev === undefined) return;
      const p = prev;
      prev = undefined;
      if (sessionIp.value !== ip) return;
      if (p) await connectTv(p, { keepActive: true }).catch(() => {});
      else await disconnectTv();
    },
  };
}
