import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { applyLanguageSetting } from '../../src/i18n';
import { SubSheet, parseGb, parseSeeds } from '../src/ui/SubSheet';
import { SubFindings } from '../src/screens/SubFindings';
import { currentRoute, navigate, resetTo } from '../src/nav';
import { toast } from '../src/ui/toast';
import { setWatchActions } from '../src/watch';
import { reloadTvs, saveTv } from '../src/tv/tvStore';
import { fakeMonitor, type FakeMonitor } from './fakeMonitor';
import { addServer, setActiveServer, servers, removeServer } from '../../src/store/servers';
import { TorrServerClient } from '../../src/api/torrserver';
import { reloadSourcePrefs, setSourceOn } from '../../src/sources/store';
import { registerSource, unregisterSource } from '../../src/sources/registry';
import { addFindings, addSubscription, getSubscription, loadSubs, rememberSeen, seenKeys, unseenCount } from '../../src/monitor/subs';
import type { SourceResult } from '../../src/sources/types';
import type { Subscription } from '../../src/monitor/types';

let el: HTMLElement;
let mon: FakeMonitor;
const launch = vi.fn();
const HASH = 'a'.repeat(40);

const flush = () =>
  act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
const byText = (t: string) => Array.from(el.querySelectorAll('button')).find((b) => b.textContent === t);
const click = (n: Element | undefined | null) => {
  if (!n) throw new Error('missing element');
  act(() => (n as HTMLElement).click());
};
function type(id: string, v: string) {
  const i = el.querySelector('#' + id) as HTMLInputElement;
  act(() => {
    i.value = v;
    i.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const error = () => (el.querySelector('[role=alert]') || { textContent: '' }).textContent;

function row(p: Partial<SourceResult>): SourceResult {
  return { Title: 'Дюна', Categories: '', Size: '41 ГБ', CreateDate: '', Tracker: '', Link: '', Magnet: 'magnet:?xt=urn:btih:' + HASH, Hash: HASH, Peer: 0, Seed: 1200, source: 'fake', ...p };
}

function sheet(p: { sub?: Subscription; initial?: any; onClose?: () => void; onDeleted?: () => void } = {}) {
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
  act(() => render(<SubSheet sub={p.sub} initial={p.initial} onClose={p.onClose || (() => {})} onDeleted={p.onDeleted} />, el));
}

beforeEach(() => {
  localStorage.clear();
  reloadSourcePrefs();
  reloadTvs();
  for (const s of servers.value.slice()) removeServer(s.id);
  setActiveServer(addServer({ url: 'http://srv:8090' }).id);
  toast.value = '';
  launch.mockReset().mockResolvedValue(undefined);
  setWatchActions({ ompVersion: async () => null, reportUrl: async () => null, launchOnTv: launch, remoteDelayMs: 0 });
  vi.spyOn(TorrServerClient.prototype, 'list').mockResolvedValue([]);
  vi.spyOn(TorrServerClient.prototype, 'tmdbSettings').mockResolvedValue(null);
  mon = fakeMonitor();
  registerSource({ id: 'fake', name: 'Фейк', kind: 'builtin', search: () => Promise.resolve([]) });
});

afterEach(() => {
  if (el) act(() => render(null, el));
  unregisterSource('fake');
  mon.restore();
  vi.restoreAllMocks();
  setWatchActions(null);
});

describe('parsers', () => {
  it('seeds: integer ≥ 1 or empty; size: number > 0 with a comma or a dot', () => {
    expect(parseSeeds('')).toBeUndefined();
    expect(parseSeeds(' 20 ')).toBe(20);
    expect(parseSeeds('0')).toBeNull();
    expect(parseSeeds('2.5')).toBeNull();
    expect(parseGb('')).toBeUndefined();
    expect(parseGb('8,5')).toBe(8.5);
    expect(parseGb('30')).toBe(30);
    expect(parseGb('0')).toBeNull();
    expect(parseGb('много')).toBeNull();
  });
});

describe('SubSheet', () => {
  it('validates: query, seeds, size, sources', () => {
    sheet();
    click(byText('Сохранить'));
    expect(error()).toBe('Введите, что искать');
    type('m-sub-query', 'Дюна');
    type('m-sub-seeds', 'abc');
    click(byText('Сохранить'));
    expect(error()).toContain('Сидов — целое число от 1');
    type('m-sub-seeds', '20');
    type('m-sub-size', '-1');
    click(byText('Сохранить'));
    expect(error()).toContain('Размер — число больше нуля');
    expect(loadSubs()).toEqual([]);
  });

  it('creates a subscription with every condition and asks for notifications on the first one', async () => {
    const close = vi.fn();
    sheet({ onClose: close });
    type('m-sub-query', '  Дюна   2160p ');
    click(byText('2160p'));
    type('m-sub-seeds', '20');
    type('m-sub-size', '45,5');
    click(el.querySelector('[role=switch][aria-label="Уведомлять"]'));
    click(byText('Сохранить'));
    await flush();
    const [s] = loadSubs();
    expect(s).toMatchObject({ query: 'Дюна 2160p', quality: '2160', minSeeds: 20, maxSizeGb: 45.5, sources: null, notify: false });
    expect(close).toHaveBeenCalled();
    expect(toast.value).toBe('Подписка создана');
    expect(mon.requestNotifyPermission).toHaveBeenCalledTimes(1);
    // the second subscription does not ask again
    sheet();
    type('m-sub-query', 'Песчаный город');
    click(byText('Сохранить'));
    await flush();
    expect(loadSubs()).toHaveLength(2);
    expect(mon.requestNotifyPermission).toHaveBeenCalledTimes(1);
  });

  it('picks sources; none picked is refused', () => {
    sheet({ initial: { query: 'Дюна' } });
    click(el.querySelector('[aria-haspopup=dialog]'));
    click(Array.from(el.querySelectorAll('[role=checkbox]')).find((b) => b.textContent === 'Фейк'));
    click(byText('Готово'));
    expect(el.textContent).toContain('Фейк ›');
    click(el.querySelector('[aria-haspopup=dialog]'));
    click(Array.from(el.querySelectorAll('[role=checkbox]')).find((b) => b.textContent === 'Фейк'));
    click(byText('Готово'));
    click(byText('Сохранить'));
    expect(error()).toBe('Выберите хотя бы один источник');
  });

  it('editing the conditions forgets what was seen (the next check is silent)', async () => {
    const s = addSubscription({ query: 'Дюна', quality: '', sources: null, notify: true })!;
    rememberSeen(s.id, ['h:' + HASH]);
    sheet({ sub: s });
    expect((el.querySelector('#m-sub-query') as HTMLInputElement).value).toBe('Дюна');
    expect(el.textContent).toContain('следующая проверка только запомнит');
    click(byText('1080p+'));
    click(byText('Сохранить'));
    expect(getSubscription(s.id)!.quality).toBe('1080');
    expect(seenKeys(s.id)).toBeNull();
    expect(toast.value).toBe('Подписка сохранена');
  });

  it('«Удалить» asks and deletes', () => {
    const s = addSubscription({ query: 'Дюна', quality: '', sources: null, notify: true })!;
    const deleted = vi.fn();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    sheet({ sub: s, onDeleted: deleted });
    click(byText('Удалить'));
    expect(loadSubs()).toHaveLength(1);
    confirm.mockReturnValue(true);
    click(byText('Удалить'));
    expect(loadSubs()).toEqual([]);
    expect(deleted).toHaveBeenCalled();
  });
});

describe('SubFindings', () => {
  function mount(p: { id: string; finding?: string; watch?: boolean }) {
    document.body.innerHTML = '<div id="app"></div>';
    el = document.getElementById('app')!;
    act(() => render(<SubFindings {...p} />, el));
  }

  it('newest first, «Новая» marks, opening counts them as looked at', async () => {
    const s = addSubscription({ query: 'Дюна', quality: '', sources: null, notify: true })!;
    addFindings([
      { subId: s.id, key: 'old', at: 1, seen: true, result: row({ Title: 'Дюна старая', Hash: 'b'.repeat(40) }) },
      { subId: s.id, key: 'new', at: 5, result: row({ Title: 'Дюна новая' }) },
    ]);
    mount({ id: s.id });
    await flush();
    const cards = Array.from(el.querySelectorAll('.m-result'));
    expect(cards.map((c) => c.querySelector('.m-result-title')!.textContent)).toEqual(['Дюна новая', 'Дюна старая']);
    expect(cards[0].querySelector('.m-flag')!.textContent).toBe('Новая');
    expect(cards[1].querySelector('.m-flag')).toBeNull();
    expect(unseenCount(s.id)).toBe(0);
  });

  it('«Изменить» opens the subscription; deleting goes back', async () => {
    const s = addSubscription({ query: 'Дюна', quality: '', sources: null, notify: true })!;
    resetTo({ name: 'news' });
    navigate({ name: 'subFindings', id: s.id });
    mount({ id: s.id });
    expect(el.textContent).toContain('Подписка ещё не проверялась');
    click(byText('Изменить'));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    click(byText('Удалить'));
    expect(currentRoute.value.name).toBe('news');
  });

  it('a notification link highlights the finding; «Смотреть на ТВ» needs a tap', async () => {
    saveTv({ ip: '192.168.1.5', name: 'LG OLED' });
    vi.spyOn(TorrServerClient.prototype, 'add').mockResolvedValue({ hash: HASH } as any);
    const s = addSubscription({ query: 'Дюна', quality: '', sources: null, notify: true })!;
    addFindings([{ subId: s.id, key: 'k1', at: 5, result: row({ Title: 'Дюна: Часть третья' }) }]);
    mount({ id: s.id, finding: 'k1', watch: true });
    await flush();
    expect(el.querySelector('.m-result.m-hl')).toBeTruthy();
    expect(el.querySelector('.m-watch-prompt')!.textContent).toContain('Смотреть на ТВ: Дюна: Часть третья?');
    expect(launch).not.toHaveBeenCalled();
    click(byText('Не сейчас'));
    expect(el.querySelector('.m-watch-prompt')).toBeNull();
    expect(launch).not.toHaveBeenCalled();
    click(el.querySelector('[aria-label^="Добавить и смотреть на ТВ:"]'));
    await flush();
    expect(launch).toHaveBeenCalled();
  });

  it('a subscription that is gone says so', () => {
    setSourceOn('fake', true);
    mount({ id: 'nope' });
    expect(el.textContent).toContain('Подписка удалена');
  });
});

describe('SubSheet in English', () => {
  afterEach(() => applyLanguageSetting('ru'));

  it('shows the form, the errors and the sources picker in English', () => {
    applyLanguageSetting('en');
    sheet();
    expect(el.querySelector('.m-sheet-title')!.textContent).toBe('Subscription');
    const form = el.querySelector('.m-sub-form')!.textContent!;
    for (const w of ['What to search for', 'Quality', 'Minimum seeds', 'Size up to, GB', 'Sources', 'all enabled', 'Notify', 'about every new release']) {
      expect(form).toContain(w);
    }
    expect(el.querySelector('#m-sub-size')!.getAttribute('placeholder')).toBe('no limit');
    expect(form).not.toMatch(/[А-Яа-яЁё]/);
    expect(Array.from(el.querySelectorAll('.m-marks-actions button')).map((b) => b.textContent)).toEqual(['Cancel', 'Save']);
    click(byText('Save'));
    expect(error()).toBe('Enter what to search for');
    type('m-sub-query', 'Dune');
    type('m-sub-seeds', 'x');
    click(byText('Save'));
    expect(error()).toBe('Seeds: a whole number from 1, or leave the field empty');
    type('m-sub-seeds', '');
    type('m-sub-size', '0');
    click(byText('Save'));
    expect(error()).toBe('Size: a number above zero, for example 20, or leave the field empty');
    click(el.querySelector('.m-set-pick'));
    expect(el.querySelector('.m-sheet-title')!.textContent).toBe('Sources');
    expect(el.querySelector('.m-opt-name')!.textContent).toBe('All enabled');
    expect(byText('Done')).toBeTruthy();
  });

  it('toasts, the delete question and the sources count are English', async () => {
    applyLanguageSetting('en');
    const close = vi.fn();
    sheet({ onClose: close });
    type('m-sub-query', 'Dune');
    click(byText('Save'));
    await flush();
    expect(toast.value).toBe('Subscription created');
    const [s] = loadSubs();
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false);
    sheet({ sub: s });
    click(byText('Delete'));
    expect(ask).toHaveBeenCalledWith('Delete the subscription “Dune”?');
    ask.mockRestore();
  });
});

describe('SubFindings in English', () => {
  beforeEach(() => applyLanguageSetting('en'));
  afterEach(() => applyLanguageSetting('ru'));
  function mount(p: { id: string }) {
    document.body.innerHTML = '<div id="app"></div>';
    el = document.getElementById('app')!;
    act(() => render(<SubFindings {...p} />, el));
  }

  it('never checked, then new findings with the flag, and the edit button', async () => {
    const s = addSubscription({ query: 'Dune', quality: '', sources: null, notify: true })!;
    mount({ id: s.id });
    await flush();
    expect(el.querySelector('[aria-label="Back"]')).toBeTruthy();
    expect(byText('Edit')).toBeTruthy();
    expect(el.textContent).toContain('The subscription has not been checked yet. The first check only remembers what is already there — OMP will report new releases after it.');
    rememberSeen(s.id, []);
    addFindings([{ subId: s.id, key: 'new', at: 5, result: row({ Title: 'Dune Part Three', Size: '41 GB' }) }]);
    mount({ id: s.id });
    await flush();
    expect(el.querySelector('.m-flag')!.textContent).toBe('New');
    // the fixture source «Фейк» is tracker data
    expect(el.textContent!.replace('Фейк', '')).not.toMatch(/[А-Яа-яЁё]/);
  });

  it('no new releases, and a deleted subscription', async () => {
    const s = addSubscription({ query: 'Dune', quality: '', sources: null, notify: true })!;
    rememberSeen(s.id, []);
    mount({ id: s.id });
    await flush();
    expect(el.textContent).toContain('No new releases yet');
    mount({ id: 'nope' });
    expect(el.querySelector('h1')!.textContent).toBe('Subscription');
    expect(el.textContent).toContain('Subscription deleted');
    expect(el.textContent).not.toMatch(/[А-Яа-яЁё]/);
  });
});
