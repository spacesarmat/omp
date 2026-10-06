import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../src/ui/toast', () => ({ toast: vi.fn() }));

import { wantList, toggleWant, isWanted, reloadWant, sanitizeWant, wantAction, WANT_KEY, WANT_MAX } from '../../src/store/wantList';
import { toast } from '../../src/ui/toast';
import { setRpcTransport } from '../../src/phone/rpc';
import { savePhoneLink, forgetPhoneLink } from '../../src/phone/phoneStore';

const item = (id: number, kind: 'movie' | 'tv' = 'movie') => ({ kind, id, title: 'T' + id, year: 2020, poster: '' });

beforeEach(() => {
  localStorage.clear();
  wantList.value = [];
  forgetPhoneLink();
  vi.mocked(toast).mockClear();
});
afterEach(() => {
  setRpcTransport(null);
  forgetPhoneLink();
});

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
const title = { kind: 'movie' as const, id: 7, title: 'Дюна', original: 'Dune', year: 2021, poster: '', rating: 8 };

describe('wantList', () => {
  it('toggles, keeps newest first and persists', () => {
    expect(toggleWant(item(1), 1)).toBe(true);
    expect(toggleWant(item(2, 'tv'), 2)).toBe(true);
    expect(wantList.value.map((w) => w.id)).toEqual([2, 1]);
    expect(isWanted('tv', 2)).toBe(true);
    expect(isWanted('movie', 2)).toBe(false);
    reloadWant();
    expect(wantList.value).toHaveLength(2);
    expect(toggleWant(item(1), 3)).toBe(false);
    expect(wantList.value.map((w) => w.id)).toEqual([2]);
    expect(JSON.parse(localStorage.getItem(WANT_KEY)!)).toHaveLength(1);
  });

  it('keeps at most 500, dropping the oldest', () => {
    for (let i = 0; i < WANT_MAX + 5; i++) toggleWant(item(i), i);
    expect(wantList.value).toHaveLength(WANT_MAX);
    expect(wantList.value[0].id).toBe(WANT_MAX + 4);
    expect(isWanted('movie', 0)).toBe(false);
  });

  it('ignores bad JSON and bad entries', () => {
    localStorage.setItem(WANT_KEY, '{oops');
    reloadWant();
    expect(wantList.value).toEqual([]);
    expect(sanitizeWant([{ kind: 'movie', id: 1, title: 'a' }, { kind: 'x', id: 2, title: 'b' }, null, { kind: 'tv', id: 1, title: 'c' }, { kind: 'movie', id: 1, title: 'dup' }]))
      .toEqual([{ kind: 'movie', id: 1, title: 'a', year: 0, poster: '', added: 0 }, { kind: 'tv', id: 1, title: 'c', year: 0, poster: '', added: 0 }]);
    expect(sanitizeWant({})).toEqual([]);
  });
});

describe('wantAction', () => {
  it('with the phone online saves locally, asks the phone once with the card query and says the phone will report', async () => {
    savePhoneLink({ url: 'http://192.168.1.20:8097', token: 'f'.repeat(32), name: 'Phone' });
    const calls: any[] = [];
    setRpcTransport((_url, body) => {
      calls.push(JSON.parse(body));
      return Promise.resolve(JSON.stringify({ ok: true, result: { sub: { id: 'w1' }, created: true } }));
    });
    expect(wantAction(title)).toBe(true);
    await flush();
    expect(isWanted('movie', 7)).toBe(true);
    expect(calls).toEqual([{ method: 'wantAdd', params: { query: 'Дюна 2021' } }]);
    expect(vi.mocked(toast).mock.calls).toEqual([['Добавлено в «Хочу посмотреть» — OMP на телефоне сообщит о раздачах']]);
  });

  it('without a phone saves locally and says to connect one; a failing phone says the same', async () => {
    expect(wantAction(title)).toBe(true);
    await flush();
    expect(isWanted('movie', 7)).toBe(true);
    expect(vi.mocked(toast).mock.calls[0][0]).toBe('Добавлено в «Хочу посмотреть». Подключите телефон, чтобы получать сообщения о раздачах');
    expect(vi.mocked(toast).mock.calls[0][0]).not.toContain('следующих версиях');

    savePhoneLink({ url: 'http://192.168.1.20:8097', token: 'f'.repeat(32), name: 'Phone' });
    setRpcTransport(() => Promise.reject(new Error('network')));
    vi.mocked(toast).mockClear();
    expect(wantAction({ ...title, id: 8 })).toBe(true);
    await flush();
    expect(isWanted('movie', 8)).toBe(true);
    expect(vi.mocked(toast).mock.calls[0][0]).toContain('Подключите телефон');
  });

  it('removing from the TV list does not touch the phone', async () => {
    toggleWant(title, 1);
    savePhoneLink({ url: 'http://192.168.1.20:8097', token: 'f'.repeat(32), name: 'Phone' });
    const send = vi.fn(() => Promise.resolve(JSON.stringify({ ok: true, result: {} })));
    setRpcTransport(send);
    expect(wantAction(title)).toBe(false);
    await flush();
    expect(send).not.toHaveBeenCalled();
    expect(vi.mocked(toast).mock.calls).toEqual([['Убрано из «Хочу посмотреть».']]);
  });
});
