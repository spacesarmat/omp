import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { applyLanguageSetting } from '../../src/i18n';
import { ResultCard, resultMeta, sizeText } from '../src/ui/ResultCard';
import { releaseChips, releaseTitle } from '../src/ui/ReleaseRow';
import { MAX_RUNNING, posterKey, setPosterLookupForTests } from '../src/ui/resultPosters';
import type { SourceResult } from '../../src/sources/types';

const STAR_TREK =
  'Звездный путь: Странные новые миры / Star Trek: Strange New Worlds (2022-2026) WEB-DL [AV1/1080p] (S1-4E1-40 of 40) HDrezka, TVShows, LostFilm';

const res = (Title: string, i = 0): SourceResult =>
  ({ Title, Categories: '', Size: '10 GB', CreateDate: '', Tracker: 'rutor', Link: 'l' + i + Title, Magnet: '', Hash: '', Peer: 0, Seed: 5 }) as SourceResult;

// a controllable IntersectionObserver: rows become visible only when the test says so
let observers: { cb: IntersectionObserverCallback; nodes: Element[]; off: boolean }[] = [];
class FakeIO {
  o: { cb: IntersectionObserverCallback; nodes: Element[]; off: boolean };
  constructor(cb: IntersectionObserverCallback) {
    this.o = { cb, nodes: [], off: false };
    observers.push(this.o);
  }
  observe(n: Element) {
    this.o.nodes.push(n);
  }
  disconnect() {
    this.o.off = true;
  }
}
function showRow(i: number) {
  const thumbs = Array.from(el.querySelectorAll('.m-rel-thumb'));
  const o = observers.filter((x) => !x.off && x.nodes.indexOf(thumbs[i]) >= 0)[0];
  if (o) o.cb([{ isIntersecting: true, target: thumbs[i] } as unknown as IntersectionObserverEntry], o as unknown as IntersectionObserver);
}

let el: HTMLElement;
let asked: string[] = [];
let answers: ((u: string) => void)[] = [];

const flush = () =>
  act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });

function mount(list: SourceResult[]) {
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
  const noop = () => undefined;
  act(() =>
    render(
      <div>
        {list.map((r) => (
          <ResultCard key={r.Link} r={r} category="movie" onCategory={noop} onAdd={noop} onWatch={noop} />
        ))}
      </div>,
      el,
    ),
  );
}

beforeEach(() => {
  observers = [];
  asked = [];
  answers = [];
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = FakeIO;
  setPosterLookupForTests(
    (q) =>
      new Promise<string>((resolve) => {
        asked.push(q);
        answers.push(resolve);
      }),
  );
});

afterEach(() => {
  act(() => render(null, el));
  delete (globalThis as unknown as { IntersectionObserver?: unknown }).IntersectionObserver;
  setPosterLookupForTests(null);
});

describe('seeds on a card', () => {
  it('shown when known; a feed row without seed data (0) says nothing of them', () => {
    mount([res('Film A (2026) 1080p', 1), { ...res('Film B (2026) 1080p', 2), Seed: 0 }]);
    const metas = Array.from(el.querySelectorAll('.m-rc-meta-text')).map((n) => n.textContent);
    expect(metas).toEqual(['10,0 ГБ · 5 сидов', '10,0 ГБ']);
    expect(resultMeta({ ...res('Film B', 3), Seed: 0 })).not.toContain('сид');
  });

  it('the tracker\'s size in the phone\'s one format: «1.45 GB» → «1,5 ГБ», unreadable text as it is', () => {
    expect(sizeText({ ...res('A'), Size: '1.45 GB' })).toBe('1,5 ГБ');
    expect(sizeText({ ...res('A'), Size: '70.2 GB' })).toBe('70,2 ГБ');
    expect(sizeText({ ...res('A'), Size: '700 MB' })).toBe('700 МБ');
    expect(sizeText({ ...res('A'), Size: '5,66 ГБ' })).toBe('5,7 ГБ');
    expect(sizeText({ ...res('A'), Size: 'не указан' })).toBe('не указан');
    expect(sizeText({ ...res('A'), Size: '' })).toBe('');
  });
});

describe('found release rows', () => {
  it('show the short title with its meta; the full tracker title is in «Подробнее» (a tap on the card)', () => {
    mount([res(STAR_TREK)]);
    const title = el.querySelector('.m-result-title')!;
    expect(title.firstChild!.textContent).toBe('Звездный путь: Странные новые миры');
    expect(title.querySelector('.m-title-meta')!.textContent).toMatch(/^ · /);
    expect(el.querySelector('.m-raw-title')).toBeNull();
    expect(el.querySelector('[data-raw-title]')).toBeNull();
    const open = el.querySelector('.m-rc-open') as HTMLButtonElement;
    expect(open.getAttribute('aria-label')).toBe('Подробнее: ' + STAR_TREK);
    act(() => open.click());
    expect(el.querySelector('[role=dialog]')!.getAttribute('aria-label')).toBe('Подробнее');
    expect(el.querySelector('[data-raw-title]')!.textContent).toBe(STAR_TREK);
    act(() => (el.querySelector('.m-sheet-backdrop') as HTMLButtonElement).click());
    expect(el.querySelector('[role=dialog]')).toBeNull();
  });

  it('a plain title: the short title is the whole of it', () => {
    mount([res('Дюна')]);
    expect(el.querySelector('.m-result-title')!.textContent).toBe('Дюна');
  });

  it('the card: poster, title, chips, «source · size · seeds», the date with round «＋» / «▶ ТВ» that call the handlers', () => {
    document.body.innerHTML = '<div id="app"></div>';
    el = document.getElementById('app')!;
    const calls: string[] = [];
    const r = { ...res('Северный ветер (2026) WEB-DL 2160p HDR | Дубляж'), source: 'ts-rutor', date: Date.now() } as SourceResult;
    act(() =>
      render(
        <ResultCard
          r={r}
          category="movie"
          onCategory={(id) => calls.push('cat:' + id)}
          onAdd={() => calls.push('add')}
          onWatch={() => calls.push('watch')}
        />,
        el,
      ),
    );
    const card = el.querySelector('.m-rc')!;
    expect(card.querySelector('.m-rel-thumb')).toBeTruthy();
    expect(card.querySelector('.m-btn')).toBeNull();
    expect(card.querySelector('.m-rc-meta')!.textContent).toContain('10,0 ГБ');
    expect(card.querySelector('.m-rc-date')!.textContent).not.toBe('');
    const [plus, tv] = Array.from(card.querySelectorAll('.m-rc-btn')) as HTMLButtonElement[];
    expect(plus.getAttribute('aria-label')).toBe('Добавить на сервер: ' + r.Title);
    expect(tv.getAttribute('aria-label')).toBe('Добавить и смотреть на ТВ: ' + r.Title);
    act(() => plus.click());
    act(() => tv.click());
    expect(calls).toEqual(['add', 'watch']);
    // the card's buttons do not open the details
    expect(el.querySelector('[role=dialog]')).toBeNull();
    act(() => (card.querySelector('.m-rc-open') as HTMLButtonElement).click());
    const chips = Array.from(el.querySelectorAll('[data-result-details] .m-chip')) as HTMLButtonElement[];
    expect(chips.filter((c) => c.getAttribute('aria-pressed') === 'true').map((c) => c.textContent)).toEqual(['Фильмы']);
    act(() => chips.find((c) => c.textContent === 'Музыка')!.click());
    expect(calls).toEqual(['add', 'watch', 'cat:music']);
    const full = Array.from(el.querySelectorAll('[role=dialog] .m-btn')) as HTMLButtonElement[];
    expect(full.map((b) => b.textContent)).toEqual(['Добавить', 'На ТВ']);
    act(() => full[1].click());
    expect(calls).toEqual(['add', 'watch', 'cat:music', 'watch']);
    expect(el.querySelector('[role=dialog]')).toBeNull();
  });

  it('quality chips: resolution, HDR, source and voice-over', () => {
    expect(releaseChips('Северный ветер (2026) WEB-DL 2160p HDR | Дубляж')).toEqual(['4K', 'HDR', 'WEB-DL', 'Дубляж']);
    expect(releaseChips('Фильм 1080p BDRip MVO')).toEqual(['1080p', 'BluRay', 'Многоголосый']);
    expect(releaseChips('Дюна')).toEqual([]);
    mount([res('Северный ветер (2026) WEB-DL 2160p HDR | Дубляж')]);
    const chips = Array.from(el.querySelectorAll('.m-rel-chips .m-badge-inline')).map((n) => n.textContent);
    expect(chips).toEqual(['4K', 'HDR', 'WEB-DL', 'Дубляж']);
  });

  it('a poster is asked for only once the row is on screen, and is shown then', async () => {
    mount([res('Дюна 2021 1080p', 1), res('Чужой 1979 720p', 2)]);
    await flush();
    expect(asked).toEqual([]);
    const thumb = el.querySelectorAll('.m-rel-thumb')[1] as HTMLElement;
    expect(thumb.getAttribute('style')).toContain('linear-gradient');
    showRow(1);
    await flush();
    expect(asked).toEqual(['Чужой']);
    answers[0]('https://img/alien.jpg');
    await flush();
    expect(thumb.getAttribute('data-poster-url')).toBe('https://img/alien.jpg');
    expect(thumb.getAttribute('style')).toContain('https://img/alien.jpg');
    expect(el.querySelectorAll('.m-rel-thumb')[0].getAttribute('data-poster-url')).toBeNull();
  });

  it('lookups are deduplicated by the normalized title and at most three run at once', async () => {
    const titles = ['Дюна 2021 1080p', 'ДЮНА  (2021) 2160p', 'Чужой 1979', 'Матрица 1999', 'Начало 2010', 'Интерстеллар 2014'];
    expect(posterKey(titles[0])).toBe(posterKey(titles[1]));
    mount(titles.map((x, i) => res(x, i)));
    for (let i = 0; i < titles.length; i++) showRow(i);
    await flush();
    expect(MAX_RUNNING).toBe(3);
    expect(asked).toEqual(['Дюна', 'Чужой', 'Матрица']);
    answers[0]('https://img/dune.jpg');
    await flush();
    expect(asked).toEqual(['Дюна', 'Чужой', 'Матрица', 'Начало']);
    const thumbs = el.querySelectorAll('.m-rel-thumb');
    expect(thumbs[0].getAttribute('data-poster-url')).toBe('https://img/dune.jpg');
    expect(thumbs[1].getAttribute('data-poster-url')).toBe('https://img/dune.jpg');
  });

  it('a row that leaves before its lookup starts drops it from the queue', async () => {
    const titles = ['Дюна', 'Чужой', 'Матрица', 'Начало'];
    mount(titles.map((x, i) => res(x, i)));
    for (let i = 0; i < titles.length; i++) showRow(i);
    await flush();
    expect(asked).toEqual(['Дюна', 'Чужой', 'Матрица']);
    act(() => render(null, el));
    answers[0]('');
    await flush();
    expect(asked).toEqual(['Дюна', 'Чужой', 'Матрица']);
  });

  it('renders in English', () => {
    applyLanguageSetting('en');
    try {
      expect(releaseTitle('Тёмная материя / Dark Matter (2024) S02E01-06 of 10 WEB-DL 1080p').meta).not.toMatch(/[А-Яа-яЁё]/);
      expect(releaseChips('Movie 1080p WEB-DL Dub')).toEqual(['1080p', 'WEB-DL', 'Dub']);
      mount([res('Dark Matter S02 1080p WEB-DL')]);
      expect(el.querySelector('.m-title-meta')!.textContent).toBe(' · season 2');
      expect(el.textContent).not.toMatch(/[А-Яа-яЁё]/);
    } finally {
      applyLanguageSetting('ru');
    }
  });
});
