import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, h } from 'preact';
import { act } from 'preact/test-utils';
import { init, getCurrentFocusKey, setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { PhoneSourcesScreen, stateLine } from '../../src/screens/PhoneSources';
import { DialogHost } from '../../src/ui/dialog';
import { ToastHost } from '../../src/ui/toast';
import { currentRoute, goBack, resetTo } from '../../src/ui/nav';
import { setRpcTransport, phoneStatus } from '../../src/phone/rpc';
import { savePhoneLink, forgetPhoneLink, phoneLink } from '../../src/phone/phoneStore';
import { knownSourceName, resetSourceNames } from '../../src/sources/sourceNames';
import { applyLanguageSetting } from '../../src/i18n';
import type { RpcSource } from '../../src/phone/rpcTypes';

const PH = { url: 'http://192.168.1.20:8097', token: 'f'.repeat(32), name: 'Pixel 8' };

const SOURCES: RpcSource[] = [
  { id: 'rutracker', name: 'RuTracker', on: true, state: 'loggedIn' },
  { id: 'kinozal', name: 'Kinozal', on: true, state: 'cloudflare' },
  { id: 'nnmclub', name: 'NNM-Club', on: false, state: 'off' },
];

type Reply = unknown;
let script: { [method: string]: Reply[] };
let calls: Array<{ method: string; params: any }>;

function useScript(s: { [method: string]: Reply[] }) {
  script = s;
  calls = [];
  setRpcTransport((_url, body) => {
    const req = JSON.parse(body);
    calls.push(req);
    const list = script[req.method] || [];
    const next = list.length > 1 ? list.shift() : list[0];
    if (next instanceof Error) return Promise.reject(next);
    if (next === undefined) return Promise.reject(new Error('network'));
    if (typeof next === 'string') return Promise.resolve(next);
    return Promise.resolve(JSON.stringify({ ok: true, result: next }));
  });
}

let host: HTMLElement;

async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

async function until(cond: () => boolean) {
  for (let i = 0; i < 100 && !cond(); i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  expect(cond()).toBe(true);
}

async function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  act(() => render(h('div', {}, h(PhoneSourcesScreen, {}), h(DialogHost, {}), h(ToastHost, {})), host));
  await flush();
}

const row = (id: string) => host.querySelector('[data-psrc="' + id + '"]') as HTMLElement;
const byText = (t: string) =>
  Array.from(host.querySelectorAll('.focusable')).find((n) => (n.textContent || '').indexOf(t) >= 0) as HTMLElement | undefined;
const click = (n: Element) => act(() => (n as HTMLElement).click());

beforeAll(() => {
  init({ debug: false, visualDebug: false });
  if (!(Element.prototype as any).scrollIntoView) (Element.prototype as any).scrollIntoView = () => undefined;
});
beforeEach(() => {
  localStorage.clear();
  resetSourceNames();
  resetTo({ name: 'settings' });
  savePhoneLink(PH);
});
afterEach(() => {
  Array.from(document.body.children).forEach((c) => act(() => render(null, c)));
  document.body.innerHTML = '';
  setRpcTransport(null);
  forgetPhoneLink();
  phoneStatus.value = 'unknown';
});

describe('«Источники поиска» on LG', () => {
  it('shows the phone online, its sites with their states and switches', async () => {
    useScript({ sources: [{ sources: SOURCES }] });
    await mount();
    const card = host.querySelector('.psrc-card') as HTMLElement;
    expect(card.textContent).toContain('Сайты ищет телефон Pixel 8');
    expect(card.textContent).toContain('на связи');
    expect(card.querySelector('.psrc-pill-ok')).not.toBeNull();
    expect(row('rutracker').textContent).toContain('вход выполнен');
    expect(row('kinozal').textContent).toContain('проверка Cloudflare — откройте сайт на телефоне');
    expect(row('nnmclub').textContent).toContain('выключен');
    expect(row('rutracker').querySelector('.src-switch')!.classList.contains('on')).toBe(true);
    expect(row('nnmclub').querySelector('.src-switch')!.classList.contains('on')).toBe(false);
    expect(host.textContent).toContain('Rutor, Jackett');
    expect(host.textContent).toContain('ОК — включить или выключить сайт · Назад — к поиску');
    // the phone's names are kept for the search rows
    expect(knownSourceName('rutracker')).toBe('RuTracker');
    // the token is never on screen
    expect(host.innerHTML).not.toContain(PH.token);
  });

  it('shows «проверяем…» while the phone is asked', async () => {
    setRpcTransport(() => new Promise<string>(() => undefined));
    await mount();
    expect(host.querySelector('.psrc-card')!.textContent).toContain('проверяем…');
  });

  it('OK on a site switches it on the phone', async () => {
    useScript({ sources: [{ sources: SOURCES }], setSourceEnabled: [{ on: false }] });
    await mount();
    click(row('kinozal').querySelector('.focusable')!);
    expect(row('kinozal').querySelector('.src-switch')!.classList.contains('on')).toBe(false);
    await flush();
    const set = calls.filter((c) => c.method === 'setSourceEnabled');
    expect(set).toEqual([{ method: 'setSourceEnabled', params: { id: 'kinozal', on: false } }]);
    expect(row('kinozal').querySelector('.src-switch')!.classList.contains('on')).toBe(false);
    expect(row('kinozal').textContent).toContain('выключен');
  });

  it('a failed switch flips back and shows a toast', async () => {
    useScript({ sources: [{ sources: SOURCES }], setSourceEnabled: ['{"ok":false,"error":{"code":"failed","message":"nope"}}'] });
    await mount();
    click(row('kinozal').querySelector('.focusable')!);
    expect(row('kinozal').querySelector('.src-switch')!.classList.contains('on')).toBe(false);
    await flush();
    expect(row('kinozal').querySelector('.src-switch')!.classList.contains('on')).toBe(true);
    expect(row('kinozal').textContent).toContain('проверка Cloudflare');
    expect(host.querySelector('.toast-error')!.textContent).toContain('Kinozal');
  });

  it('a phone that does not answer: «не отвечает», the hint and «Повторить», which asks again', async () => {
    useScript({ sources: [new Error('timeout')] });
    await mount();
    const card = host.querySelector('.psrc-card') as HTMLElement;
    expect(card.textContent).toContain('не отвечает');
    expect(card.querySelector('.psrc-pill-bad')).not.toBeNull();
    expect(card.textContent).toContain('Телефон не отвечает — откройте OMP на телефоне');
    expect(row('rutracker')).toBeNull();
    await until(() => getCurrentFocusKey() === 'psrc-retry');
    let answer: (v: string) => void = () => undefined;
    const asked: string[] = [];
    setRpcTransport((_url, body) => {
      asked.push(JSON.parse(body).method);
      return new Promise<string>((r) => { answer = r; });
    });
    click(byText('Повторить')!);
    await flush();
    expect(asked).toEqual(['sources']);
    // asked again: «проверяем…», and «Повторить» stays with the focus meanwhile
    expect(host.querySelector('.psrc-card')!.textContent).toContain('проверяем…');
    expect(byText('Повторить')).not.toBeUndefined();
    expect(getCurrentFocusKey()).toBe('psrc-retry');
    answer(JSON.stringify({ ok: true, result: { sources: SOURCES } }));
    await flush();
    expect(host.querySelector('.psrc-card')!.textContent).toContain('на связи');
    expect(row('rutracker')).not.toBeNull();
    expect(byText('Повторить')).toBeUndefined();
    await until(() => getCurrentFocusKey() === 'psrc-rutracker');
  });

  it('no phone: the «Телефон не подключён» card; «Rutor, Jackett» opens the TorrServer sources', async () => {
    forgetPhoneLink();
    useScript({});
    await mount();
    const card = host.querySelector('.psrc-card') as HTMLElement;
    expect(card.textContent).toContain('Телефон не подключён');
    expect(card.textContent).toContain('Настройки → Телевизор');
    expect(calls).toEqual([]);
    expect(byText('Забыть телефон')).toBeUndefined();
    expect(getCurrentFocusKey()).toBe('psrc-ts');
    click(byText('Rutor, Jackett')!);
    expect(currentRoute.value.name).toBe('tsSources');
  });

  it('«Забыть телефон» after a confirmation forgets the link', async () => {
    useScript({ sources: [{ sources: SOURCES }] });
    await mount();
    click(byText('Забыть телефон')!);
    expect(host.querySelector('.dialog')!.textContent).toContain('Забыть телефон Pixel 8?');
    const yes = Array.from(host.querySelectorAll('.dialog-option')).find((n) => n.textContent === 'Забыть телефон')!;
    click(yes);
    await flush();
    expect(phoneLink.value).toBeNull();
    expect(host.querySelector('.psrc-card')!.textContent).toContain('Телефон не подключён');
    expect(row('rutracker')).toBeNull();
  });

  it('a switch the phone does not answer: rows go, focus moves to «Повторить»', async () => {
    useScript({ sources: [{ sources: SOURCES }], setSourceEnabled: [new Error('timeout')] });
    await mount();
    act(() => setFocus('psrc-kinozal'));
    await until(() => getCurrentFocusKey() === 'psrc-kinozal');
    click(row('kinozal').querySelector('.focusable')!);
    await flush();
    expect(host.querySelector('.toast-error')!.textContent).toContain('Kinozal');
    expect(host.querySelector('.psrc-card')!.textContent).toContain('не отвечает');
    expect(row('kinozal')).toBeNull();
    await until(() => getCurrentFocusKey() === 'psrc-retry');
  });

  it('back from «Rutor, Jackett» keeps the rows and the focus on that row', async () => {
    useScript({ sources: [{ sources: SOURCES }] });
    resetTo({ name: 'sources' });
    await mount();
    act(() => setFocus('psrc-ts'));
    await until(() => getCurrentFocusKey() === 'psrc-ts');
    click(byText('Rutor, Jackett')!);
    expect(currentRoute.value.name).toBe('tsSources');
    act(() => render(null, host));
    goBack();
    setRpcTransport(() => new Promise<string>(() => undefined));
    await mount();
    // the last list shows at once, while the phone is asked again
    expect(row('rutracker')).not.toBeNull();
    expect(host.querySelector('.psrc-card')!.textContent).toContain('проверяем…');
    await until(() => getCurrentFocusKey() === 'psrc-ts');
  });

  it('focuses the first site once the list arrives', async () => {
    useScript({ sources: [{ sources: SOURCES }] });
    await mount();
    expect(getCurrentFocusKey()).toBe('psrc-rutracker');
  });

  it('English', async () => {
    applyLanguageSetting('en');
    try {
      useScript({ sources: [{ sources: SOURCES }] });
      await mount();
      expect(host.querySelector('.psrc-card')!.textContent).toContain('Sites are searched by phone Pixel 8');
      expect(row('rutracker').textContent).toContain('signed in');
      expect(host.textContent).toContain('Without a phone');
    } finally {
      applyLanguageSetting('ru');
    }
  });
});

describe('stateLine', () => {
  const s = (state: RpcSource['state'], message?: string): RpcSource => ({ id: 'x', name: 'X', on: state !== 'off', state, message });
  it('maps every state', () => {
    expect(stateLine(s('ok'))).toEqual({ text: 'работает', tone: 'ok' });
    expect(stateLine(s('loggedIn'))).toEqual({ text: 'вход выполнен', tone: 'ok' });
    expect(stateLine(s('login'))).toEqual({ text: 'нужен вход — войдите на телефоне', tone: 'warn' });
    expect(stateLine(s('cloudflare'))).toEqual({ text: 'проверка Cloudflare — откройте сайт на телефоне', tone: 'warn' });
    expect(stateLine(s('error', 'Сайт недоступен'))).toEqual({ text: 'Сайт недоступен', tone: 'bad' });
    expect(stateLine(s('off'))).toEqual({ text: 'выключен', tone: 'off' });
    expect(stateLine(s('unknown'))).toEqual({ text: 'ещё не проверялся', tone: 'off' });
  });
  it('cuts a long error to 80 chars and fixes the glyphs', () => {
    const long = stateLine(s('error', 'x'.repeat(200)));
    expect(long.text.length).toBe(80);
    expect(stateLine(s('error', 'a−b')).text).toBe('a-b');
    expect(stateLine(s('error')).text).toBe('ошибка');
  });
  it('English', () => {
    applyLanguageSetting('en');
    try {
      expect(stateLine(s('login')).text).toBe('sign-in needed — sign in on the phone');
      expect(stateLine(s('cloudflare')).text).toBe('Cloudflare check — open the site on the phone');
      expect(stateLine(s('unknown')).text).toBe('not checked yet');
    } finally {
      applyLanguageSetting('ru');
    }
  });
});
