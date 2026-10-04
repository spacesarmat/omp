import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, h } from 'preact';
import { init } from '@noriginmedia/norigin-spatial-navigation';
import { DonateCard, donateCardEnabled, donateMode, type DonateModeInput } from '../../src/player/DonateCard';
import { DONATE_QR } from '../../src/ui/donateQr';
import { DONATE_QR_URL, DONATE_URL } from '../../src/lib/donate';
import { qrData, donateUrlFrom } from '../../scripts/donate-lib.mjs';
import { PlayerScreen } from '../../src/screens/Player';
import { DialogHost } from '../../src/ui/dialog';
import { servers, activeServerId } from '../../src/store/servers';
import { updateSettings } from '../../src/store/settings';
import { reloadProgress } from '../../src/store/progress';
import { torrents } from '../../src/store/library';
import { resetSupportSeen } from '../../src/store/support';
import { mockFetch } from '../helpers/fetchMock';
// @ts-ignore node builtin, no @types/node in this project
import { readFileSync } from 'node:fs';
import type { PlayItem } from '../../src/player/types';

const base: DonateModeInput = { enabled: true, started: true, error: false, paused: false, time: 100, duration: 1000, creditsStart: null, countdown: false };

describe('donateMode', () => {
  it('on pause: the pause card', () => {
    expect(donateMode({ ...base, paused: true })).toBe('pause');
  });
  it('playing: none; inside known credits or with the next-episode countdown: the credits card', () => {
    expect(donateMode(base)).toBeNull();
    expect(donateMode({ ...base, creditsStart: 900, time: 899 })).toBeNull();
    expect(donateMode({ ...base, creditsStart: 900, time: 900 })).toBe('credits');
    expect(donateMode({ ...base, countdown: true })).toBe('credits');
    // unknown credits near the end of a movie: no card (no reliable signal)
    expect(donateMode({ ...base, time: 990 })).toBeNull();
  });
  it('resumed, loading, error, supporter / no method: none', () => {
    expect(donateMode({ ...base, paused: false })).toBeNull();
    expect(donateMode({ ...base, paused: true, started: false })).toBeNull();
    expect(donateMode({ ...base, paused: true, error: true })).toBeNull();
    expect(donateMode({ ...base, paused: true, enabled: false })).toBeNull();
  });
  it('enabled only without a support mark and with a method that opens the QR link', () => {
    expect(donateCardEnabled(false)).toBe(true);
    expect(donateCardEnabled(true)).toBe(false);
    expect(donateCardEnabled(false, '')).toBe(false);
    expect(donateCardEnabled(false, 'https://other.example/')).toBe(false);
  });
});

describe('QR module (generated at build time)', () => {
  it('was made from the configured link (run npm run gen:donate-qr after changing it)', () => {
    expect(DONATE_QR.url).toBe(DONATE_QR_URL);
    expect(donateUrlFrom(readFileSync('src/lib/donate.ts', 'utf8'))).toBe(DONATE_URL);
    const fresh = qrData(DONATE_QR_URL);
    expect(DONATE_QR.path).toBe(fresh.path);
    expect(DONATE_QR.bits).toBe(fresh.bits);
    expect(DONATE_QR.size).toBe(fresh.size);
    expect(DONATE_QR.bits.length).toBe(DONATE_QR.modules * DONATE_QR.modules);
    // Chromium 53: plain absolute path commands only
    expect(DONATE_QR.path).toMatch(/^(M\d+ \d+h\d+v1h-\d+z)+$/);
  });
});

describe('DonateCard', () => {
  it('renders the QR on white with the texts of the mockups and takes no focus', () => {
    const host = document.createElement('div');
    render(h(DonateCard, { mode: 'pause' }), host);
    const svg = host.querySelector('svg.donate-qr')!;
    expect(svg.getAttribute('viewBox')).toBe('0 0 ' + DONATE_QR.size + ' ' + DONATE_QR.size);
    expect(host.querySelector('rect')!.getAttribute('fill')).toBe('#fff');
    expect(host.textContent).toContain('Нравится OMP?');
    expect(host.textContent).toContain('Поддержите разработку — наведите камеру телефона на код');
    expect(host.textContent).toContain('boosty.to/djmaker');
    expect(host.querySelector('[tabindex], .focusable, button, a')).toBeNull();
    render(h(DonateCard, { mode: 'credits', raised: true }), host);
    expect(host.querySelector('.donate-card.donate-credits.raised')).not.toBeNull();
    expect(host.textContent).toContain('Досмотрели? Спасибо!');
    expect(host.textContent).toContain('OMP бесплатный и без рекламы. Поддержать — по коду с телефона');
    render(h(DonateCard, { mode: null }), host);
    expect(host.innerHTML).toBe('');
  });
});

// ---- the LG player ----

const HASH = 'd'.repeat(40);
const item: PlayItem = { url: 'http://srv:8090/stream/f.mkv', title: 'Серия 1', hash: HASH, fileIndex: 1 };
let serverList: object[] = [];
let hosts: HTMLElement[] = [];

async function until(cond: () => boolean) {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(cond()).toBe(true);
}

/** Fake clock of the <video>: jsdom has no media pipeline. */
function drive(video: HTMLVideoElement, duration = 1000) {
  let time = 0;
  let paused = false;
  Object.defineProperty(video, 'duration', { configurable: true, get: () => duration });
  Object.defineProperty(video, 'currentTime', { configurable: true, get: () => time, set: (v: number) => { time = v; } });
  Object.defineProperty(video, 'paused', { configurable: true, get: () => paused });
  video.play = (() => { paused = false; video.dispatchEvent(new Event('playing')); return Promise.resolve(); }) as any;
  video.pause = (() => { paused = true; video.dispatchEvent(new Event('pause')); }) as any;
  video.load = (() => undefined) as any;
  video.dispatchEvent(new Event('loadedmetadata'));
  video.dispatchEvent(new Event('playing'));
  return (t: number) => {
    time = t;
    video.dispatchEvent(new Event('timeupdate'));
  };
}

async function open() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  hosts.push(host);
  render(h('div', {}, h(PlayerScreen, { queue: [item], index: 0 }), h(DialogHost, {})), host);
  await until(() => !!host.querySelector('video') && !!host.querySelector('video')!.getAttribute('src'));
  await new Promise((r) => setTimeout(r, 80));
  const video = host.querySelector('video') as HTMLVideoElement;
  const at = drive(video);
  await new Promise((r) => setTimeout(r, 40));
  return { host, video, at };
}

beforeAll(() => {
  init({ debug: false, visualDebug: false });
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});
beforeEach(() => {
  localStorage.clear();
  reloadProgress();
  torrents.value = [];
  resetSupportSeen();
  serverList = [{ hash: HASH, title: 'Раздача', stat: 5, data: '' }];
  servers.value = [{ id: 's1', name: 's', url: 'http://srv:8090' }];
  activeServerId.value = 's1';
  updateSettings({ autoNext: true });
  // network fake of TorrServer: the list (skip settings, journal), ffprobe without chapters, the rest empty
  mockFetch((url, init) => {
    if (url.indexOf('/torrents') >= 0 && String(init.body || '').indexOf('"list"') >= 0) return { body: JSON.stringify(serverList) };
    if (url.indexOf('/ffp/') >= 0) return { body: JSON.stringify({ streams: [] }) };
    return { body: '{}' };
  });
});
afterEach(async () => {
  hosts.splice(0).forEach((x) => render(null, x));
  await new Promise((r) => setTimeout(r, 40));
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('LG player: «Поддержать» card', () => {
  it('appears at once on pause and goes away when playback resumes', async () => {
    const { host, video, at } = await open();
    at(100);
    await new Promise((r) => setTimeout(r, 20));
    expect(host.querySelector('.donate-card')).toBeNull();
    video.pause();
    await until(() => !!host.querySelector('.donate-card.donate-pause'));
    expect(host.textContent).toContain('Нравится OMP?');
    video.play();
    await until(() => !host.querySelector('.donate-card'));
  });

  it('a pause does not swallow keys: OK still resumes', async () => {
    const { host, video, at } = await open();
    at(50);
    video.pause();
    await until(() => !!host.querySelector('.donate-card'));
    const { dispatchKey } = await import('../../src/ui/keys');
    dispatchKey('enter', new KeyboardEvent('keydown'));
    expect(video.paused).toBe(false);
    await until(() => !host.querySelector('.donate-card'));
  });

  it('in the credits known from a manual mark, next to the end', async () => {
    serverList = [{ hash: HASH, title: 'Раздача', stat: 5, data: JSON.stringify({ omp: { v: 1, h: [], s: { i: false, c: false, mc: 100 } } }) }];
    const { host, at } = await open();
    await new Promise((r) => setTimeout(r, 40));
    at(850);
    await new Promise((r) => setTimeout(r, 20));
    expect(host.querySelector('.donate-card')).toBeNull();
    at(905);
    await until(() => !!host.querySelector('.donate-card.donate-credits'));
    expect(host.textContent).toContain('Досмотрели? Спасибо!');
  });

  it('hidden while the journal says a support code is active', async () => {
    const until2 = Date.now() + 20 * 86400000;
    serverList = [{ hash: HASH, title: 'Раздача', stat: 5, data: JSON.stringify({ omp: { v: 1, h: [], d: { until: until2 } } }) }];
    const { host, video, at } = await open();
    await new Promise((r) => setTimeout(r, 40));
    at(100);
    video.pause();
    await new Promise((r) => setTimeout(r, 60));
    expect(host.querySelector('.player-controls')).not.toBeNull();
    expect(host.querySelector('.donate-card')).toBeNull();
  });

  it('shown again once the support mark has passed', async () => {
    serverList = [{ hash: HASH, title: 'Раздача', stat: 5, data: JSON.stringify({ omp: { v: 1, h: [], d: { until: Date.now() - 1000 } } }) }];
    const { host, video, at } = await open();
    await new Promise((r) => setTimeout(r, 40));
    at(100);
    video.pause();
    await until(() => !!host.querySelector('.donate-card'));
  });
});
