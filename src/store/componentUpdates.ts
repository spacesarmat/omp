import { signal } from '@preact/signals';
import { request } from '../api/http';
import {
  decideOffers,
  playerVersionOrNull,
  PLAYER_LATEST_URL,
  torrServerVersion,
  TORR_LATEST_URL,
  type ComponentOffer,
  type PlayerAbi,
  type TorrReading,
} from '../lib/componentVersions';
import { settings } from './settings';
import { isObject, loadJson, saveJson } from './storage';

const KEY = 'omp.componentUpdate';
/** The least time between automatic checks when OMP comes back to the screen. A launch always checks. */
export const COMPONENT_CHECK_INTERVAL_MS = 60 * 60 * 1000;

interface SkipState {
  lastCheck: number;
  player?: string;
  torrserver?: string;
}

export function sanitizeComponentSkip(v: unknown): SkipState {
  const out: SkipState = { lastCheck: 0 };
  if (!isObject(v)) return out;
  if (typeof v.lastCheck === 'number' && isFinite(v.lastCheck) && v.lastCheck >= 0) out.lastCheck = v.lastCheck;
  if (typeof v.player === 'string' && playerVersionOrNull(v.player)) out.player = v.player;
  if (typeof v.torrserver === 'string' && torrServerVersion(v.torrserver)) out.torrserver = v.torrserver;
  return out;
}

let state: SkipState = sanitizeComponentSkip(loadJson<unknown>(KEY, {}, isObject));
/** Versions dismissed for this process. Later writes the same version into storage. */
const held = new Set<string>();
let queue: ComponentOffer[] = [];

/** The offer on screen. One at a time: 2160 Player, then TorrServer. */
export const componentPrompt = signal<ComponentOffer | null>(null);

export function reloadComponentUpdates(): void {
  state = sanitizeComponentSkip(loadJson<unknown>(KEY, {}, isObject));
  held.clear();
  queue = [];
  componentPrompt.value = null;
}

function holdKey(o: ComponentOffer): string {
  return o.kind + ':' + o.latest;
}

function show(offers: ComponentOffer[]): void {
  if (componentPrompt.value) return;
  const next = offers.filter((o) => !held.has(holdKey(o)));
  componentPrompt.value = next[0] || null;
  queue = next.slice(1);
}

function advance(): void {
  componentPrompt.value = queue.shift() || null;
}

/** «Позже»: do not ask about this version again. */
export function laterComponent(): void {
  const cur = componentPrompt.value;
  if (cur) {
    held.add(holdKey(cur));
    const patch: SkipState = { ...state };
    if (cur.kind === 'player') patch.player = cur.latest;
    else patch.torrserver = cur.latest;
    state = patch;
    saveJson(KEY, state);
  }
  advance();
}

/** Hide until the next launch. The version is asked again then, unless it was installed. */
export function dismissComponent(): void {
  const cur = componentPrompt.value;
  if (cur) held.add(holdKey(cur));
  advance();
}

export interface ComponentCheckDeps {
  playerVersion: () => Promise<string | null>;
  torr: () => Promise<TorrReading | null>;
  abi: () => Promise<PlayerAbi | null>;
  fetchJson?: (url: string) => Promise<unknown>;
  now?: number;
  manual?: boolean;
  minIntervalMs?: number;
}

function defaultFetch(url: string): Promise<unknown> {
  return request<unknown>(url, {
    timeoutMs: 10000,
    quiet: true,
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'omp' },
  });
}

export type ComponentCheckResult = 'update' | 'latest' | 'skipped' | 'error';

/**
 * Launch check. A failure, a missing player, or an unreadable TorrServer version resolves quietly:
 * nothing is shown and the error is not thrown.
 */
export function checkComponentUpdates(deps: ComponentCheckDeps): Promise<ComponentCheckResult> {
  const now = deps.now === undefined ? Date.now() : deps.now;
  const gap = deps.minIntervalMs === undefined ? 0 : deps.minIntervalMs;
  if (!deps.manual && (!settings.value.updateCheck || (state.lastCheck > 0 && state.lastCheck <= now && now - state.lastCheck < gap))) {
    return Promise.resolve('skipped');
  }
  const fetchJson = deps.fetchJson || defaultFetch;
  return Promise.all([
    Promise.resolve()
      .then(() => deps.playerVersion())
      .catch(() => null),
    Promise.resolve()
      .then(() => deps.torr())
      .catch(() => null),
    Promise.resolve()
      .then(() => deps.abi())
      .catch(() => null),
  ]).then(([playerInstalled, torr, abi]) => {
    const needPlayer = !!playerVersionOrNull(playerInstalled);
    const needTorr = !!(torr && torrServerVersion(torr.version));
    if (!needPlayer && !needTorr) return 'latest' as ComponentCheckResult;
    return Promise.all([
      needPlayer ? fetchJson(PLAYER_LATEST_URL).catch(() => null) : Promise.resolve(null),
      needTorr ? fetchJson(TORR_LATEST_URL).catch(() => null) : Promise.resolve(null),
    ]).then(([playerRelease, torrRelease]): ComponentCheckResult => {
      const playerFailed = needPlayer && playerRelease == null;
      const torrFailed = needTorr && torrRelease == null;
      if (!playerFailed && !torrFailed) {
        state = { ...state, lastCheck: now };
        saveJson(KEY, state);
      }
      const offers = decideOffers({
        playerInstalled,
        playerRelease,
        torr,
        torrRelease,
        abi: abi === 'arm64' || abi === 'armv7' ? abi : null,
        skipped: { player: state.player, torrserver: state.torrserver },
      });
      if (offers.length) {
        show(offers);
        return 'update';
      }
      return playerFailed || torrFailed ? 'error' : 'latest';
    });
  }, () => 'error' as ComponentCheckResult);
}

/** Shortly after launch (always), then when OMP returns to the screen, at most once an hour. */
export function installComponentChecks(run: (minIntervalMs: number) => void, delayMs = 4000): () => void {
  const timer = setTimeout(() => run(0), delayMs);
  const onShow = () => {
    if (!document.hidden) run(COMPONENT_CHECK_INTERVAL_MS);
  };
  document.addEventListener('visibilitychange', onShow);
  return () => {
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', onShow);
  };
}
