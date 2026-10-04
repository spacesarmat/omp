import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
// @ts-ignore node builtin, no @types/node in this project
import { generateKeyPairSync } from 'node:crypto';
import {
  applySupportCode,
  closeDonate,
  donateCardDue,
  FIRST_RUN_KEY,
  CARD_AFTER_MS,
  localSupportUntil,
  openDonate,
  reloadSupport,
  setSupportIo,
  supporterActive,
  syncSupport,
  SUPPORT_KEY,
} from '../src/donate';
import { verifySupportCode } from '../src/supportCode';
import { DonateSheet, setDonateActions } from '../src/ui/DonateSheet';
import { supportCode, publicKeyOf } from '../../scripts/donate-lib.mjs';
import { supportEndText, supportUntil } from '../../src/lib/donate';
import { supportOf } from '../../src/lib/journal';
import { torrents } from '../../src/store/library';
import { resetSupportSeen } from '../../src/store/support';
import type { Torrent } from '../../src/api/types';

const { privateKey } = generateKeyPairSync('ed25519');
const PEM = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
const PUB = publicKeyOf(PEM);

const now = new Date();
const pad = (n: number) => (n < 10 ? '0' : '') + n;
const MONTH = now.getFullYear() + '-' + pad(now.getMonth() + 1);
const UNTIL = supportUntil(now.getFullYear(), now.getMonth() + 1);

/** A TorrServer with one torrent (network fake of list / setData). */
function fakeServer() {
  const t: Torrent = { hash: 'h1', title: 'T', stat: 5, timestamp: 1, data: JSON.stringify({ lampa: 1, omp: { v: 1, h: [], s: { i: true, c: false } } }) } as Torrent;
  const c = {
    list: vi.fn(() => Promise.resolve([{ ...t }])),
    setData: vi.fn((_x: Pick<Torrent, 'hash'>, data: string) => {
      t.data = data;
      return Promise.resolve();
    }),
  };
  return { c, t };
}

function mount(ui: preact.VNode): HTMLElement {
  document.body.innerHTML = '<div id="app"></div>';
  const el = document.getElementById('app')!;
  act(() => render(ui, el));
  return el;
}
const btn = (el: ParentNode, t: string) => Array.from(el.querySelectorAll('button')).find((b) => (b.textContent || '').includes(t))!;
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

let server = fakeServer();

beforeEach(() => {
  localStorage.clear();
  reloadSupport();
  resetSupportSeen();
  torrents.value = [];
  closeDonate();
  server = fakeServer();
  setSupportIo({ verify: (text, at) => verifySupportCode(text, at, PUB), client: () => server.c });
});
afterEach(() => {
  setSupportIo();
  setDonateActions();
  localStorage.clear();
  reloadSupport();
});

describe('«Уже поддержали?» in the donate sheet', () => {
  it('Вставить → Применить: thanks line, local state, the end time (not the code) on the server', async () => {
    const code = supportCode(MONTH, PEM);
    setDonateActions({ paste: () => Promise.resolve('  ' + code + '\n') });
    const el = mount(<DonateSheet />);
    await act(async () => { openDonate(); });
    expect(el.textContent).toContain('Уже поддержали?');
    expect(el.textContent).toContain('Код поддержки опубликован на Boosty для подписчиков и меняется каждый месяц.');
    expect(el.textContent).not.toContain('Спасибо!');
    await act(async () => btn(el, 'Вставить').click());
    await act(flush);
    expect((el.querySelector('input') as HTMLInputElement).value).toBe(code);
    await act(async () => btn(el, 'Применить').click());
    await act(async () => { for (let i = 0; i < 5; i++) await flush(); });
    expect(el.textContent).toContain('Спасибо! Просьбы о поддержке скрыты до ' + supportEndText(UNTIL) + ' на телефоне и телевизорах.');
    expect(JSON.parse(localStorage.getItem(SUPPORT_KEY)!)).toEqual({ until: UNTIL });
    expect(supporterActive()).toBe(true);
    expect(server.c.setData).toHaveBeenCalledTimes(1);
    expect(supportOf(server.t.data)).toBe(UNTIL);
    expect(JSON.parse(server.t.data!).lampa).toBe(1);
    expect(JSON.parse(server.t.data!).omp.s).toEqual({ i: true, c: false });
    expect(server.t.data).not.toContain(code.slice(12, 40));
  });

  it('a wrong code shows «Код не подходит» and changes nothing', async () => {
    const el = mount(<DonateSheet />);
    await act(async () => { openDonate(); });
    const input = el.querySelector('input') as HTMLInputElement;
    await act(async () => {
      input.value = 'OMP-' + MONTH + '-' + 'A'.repeat(86);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => btn(el, 'Применить').click());
    await act(async () => { for (let i = 0; i < 5; i++) await flush(); });
    expect(el.querySelector('[role=alert]')!.textContent).toBe('Код не подходит');
    expect(localStorage.getItem(SUPPORT_KEY)).toBeNull();
    expect(server.c.setData).not.toHaveBeenCalled();
  });

  it('an expired code says so', async () => {
    const r = await applySupportCode(supportCode('2020-01', PEM));
    expect(r).toEqual({ ok: false, error: 'Срок кода истёк' });
    expect(localSupportUntil.value).toBe(0);
  });
});

describe('support state on the phone', () => {
  it('hides the 30-day card while active', async () => {
    const T = Date.now();
    localStorage.setItem(FIRST_RUN_KEY, JSON.stringify(T - CARD_AFTER_MS - 1));
    expect(donateCardDue(undefined, T)).toBe(true);
    expect((await applySupportCode(supportCode(MONTH, PEM))).ok).toBe(true);
    expect(donateCardDue(undefined, T)).toBe(false);
    // offline: the local copy alone keeps it (after a restart)
    reloadSupport();
    expect(supporterActive()).toBe(true);
    expect(donateCardDue(undefined, UNTIL + 1)).toBe(true);
  });

  it('a code applied on another phone (journal) counts too', () => {
    torrents.value = [{ hash: 'x', title: 'X', stat: 5, data: JSON.stringify({ omp: { v: 1, h: [], d: { until: UNTIL } } }) } as Torrent];
    expect(supporterActive()).toBe(true);
  });

  it('a malformed stored state is dropped', () => {
    localStorage.setItem(SUPPORT_KEY, JSON.stringify({ until: 'x' }));
    reloadSupport();
    expect(localSupportUntil.value).toBe(0);
    expect(localStorage.getItem(SUPPORT_KEY)).toBeNull();
  });

  it('syncSupport writes a server that lacks the mark once, and nothing when it has it', async () => {
    localStorage.setItem(SUPPORT_KEY, JSON.stringify({ until: UNTIL }));
    reloadSupport();
    expect(await syncSupport(server.c, [server.t])).toBe(true);
    expect(server.c.setData).toHaveBeenCalledTimes(1);
    expect(await syncSupport(server.c, [server.t])).toBe(false);
    expect(server.c.setData).toHaveBeenCalledTimes(1);
    expect(await syncSupport(null, [])).toBe(false);
  });
});
