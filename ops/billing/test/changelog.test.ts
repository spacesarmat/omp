import { describe, expect, it } from 'vitest';
import { CHANGELOG_SOURCES, createChangelogSource, parseChangelogSections } from '../src/changelog.mjs';
import { CHANGELOG_FILTERS, filterChangelog, sectionTitle } from '../admin/src/lib/changelog.ts';

const RU = [
  '# Изменения',
  '',
  '<!-- markers -->',
  '',
  '## Не выпущено',
  '',
  '- [tech] Биллинг: счётчики токенов',
  '',
  '## 0.20.5',
  '',
  '- Подписка: лимит = база + бонус + купленные',
  '- [phone] Понятнее ошибки',
  '- [TECH] Биллинг на **Postgres** 17',
  '',
  '### Подраздел',
  '- [lg] LG: плитки',
  '',
  '## 0.20.4-beta.1',
  '- [atv] Android TV',
  '',
  '## 0.20.3',
  '',
  'без пунктов',
  '',
].join('\n');
const EN = '# Changes\n\n## Unreleased\n\n- [tech] Billing: token counts\n\n## 0.20.5\n\n- Subscription: limit\n';

function textRes(body: string, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => body, json: async () => ({}) };
}

describe('changelog parser (billing copy)', () => {
  it('keeps file order, flags «[tech]», reads the platform marker, flattens ### and drops empty sections', () => {
    const list = parseChangelogSections(RU);
    expect(list.map((s) => s.version)).toEqual(['Не выпущено', '0.20.5', '0.20.4-beta.1']);
    expect(list[0]).toMatchObject({ unreleased: true, beta: false });
    expect(list[0].items).toEqual([{ text: 'Биллинг: счётчики токенов', tech: true, platform: '' }]);
    expect(list[1].items).toEqual([
      { text: 'Подписка: лимит = база + бонус + купленные', tech: false, platform: '' },
      { text: 'Понятнее ошибки', tech: false, platform: 'phone' },
      { text: 'Биллинг на Postgres 17', tech: true, platform: '' },
      { text: 'LG: плитки', tech: false, platform: 'lg' },
    ]);
    expect(list[2]).toMatchObject({ beta: true, items: [{ text: 'Android TV', platform: 'atv', tech: false }] });
    expect(parseChangelogSections('')).toEqual([]);
  });

  it('the tab filters: tech only, user only, betas hidden by default', () => {
    const list = parseChangelogSections(RU);
    expect(CHANGELOG_FILTERS.map(([id]) => id)).toEqual(['all', 'tech', 'user']);
    expect(filterChangelog(list, 'all', false).map((s) => s.version)).toEqual(['Не выпущено', '0.20.5']);
    expect(filterChangelog(list, 'all', true)).toHaveLength(3);
    const tech = filterChangelog(list, 'tech', true);
    expect(tech.map((s) => s.version)).toEqual(['Не выпущено', '0.20.5']);
    expect(tech.every((s) => s.items.every((i) => i.tech))).toBe(true);
    const user = filterChangelog(list, 'user', false);
    expect(user.map((s) => s.version)).toEqual(['0.20.5']);
    expect(user[0].items.some((i) => i.tech)).toBe(false);
    expect(sectionTitle(list[0])).toBe('Не выпущено');
    expect(sectionTitle(list[1])).toBe('0.20.5');
  });
});

describe('changelog source (GitHub main, cached)', () => {
  function setup(answer: (url: string) => ReturnType<typeof textRes> | Promise<never>) {
    let t = 1_000_000;
    const calls: string[] = [];
    const net = async (url: string) => {
      calls.push(url);
      return answer(url);
    };
    const src = createChangelogSource({ net, now: () => t });
    return { src, calls, tick: (ms: number) => (t += ms), at: () => t };
  }

  it('fetches both files from main, then serves the cache for 10 minutes', async () => {
    const s = setup((url) => textRes(url === CHANGELOG_SOURCES.ru ? RU : EN));
    expect(CHANGELOG_SOURCES.ru).toBe('https://raw.githubusercontent.com/spacesarmat/omp/main/CHANGELOG.md');
    const first = await s.src.get();
    expect(first.ok).toBe(true);
    expect(first.stale).toBe(false);
    expect(first.fetchedAt).toBe(s.at());
    expect(first.ru.map((x: { version: string }) => x.version)).toContain('0.20.5');
    expect(first.en[0]).toMatchObject({ version: 'Unreleased', unreleased: true });
    expect(s.calls).toEqual([CHANGELOG_SOURCES.ru, CHANGELOG_SOURCES.en]);
    s.tick(9 * 60 * 1000);
    await s.src.get();
    expect(s.calls).toHaveLength(2);
    s.tick(2 * 60 * 1000);
    await s.src.get();
    expect(s.calls).toHaveLength(4);
  });

  it('a failed refresh serves the last good copy marked stale and waits a minute before trying again', async () => {
    let down = false;
    const s = setup((url) => (down ? textRes('', 503) : textRes(url === CHANGELOG_SOURCES.ru ? RU : EN)));
    const good = await s.src.get();
    down = true;
    s.tick(11 * 60 * 1000);
    const stale = await s.src.get();
    expect(stale.ok).toBe(true);
    expect(stale.stale).toBe(true);
    expect(stale.error).toBe('HTTP 503');
    expect(stale.fetchedAt).toBe(good.fetchedAt);
    expect(stale.ru).toEqual(good.ru);
    const n = s.calls.length;
    s.tick(30 * 1000);
    await s.src.get();
    expect(s.calls).toHaveLength(n);
    down = false;
    s.tick(31 * 1000);
    const back = await s.src.get();
    expect(back.stale).toBe(false);
    expect(back.error).toBe('');
  });

  it('nothing fetched yet and GitHub down: ok false with the error, never a throw', async () => {
    const s = setup(() => Promise.reject(new Error('ECONNRESET')));
    const r = await s.src.get();
    expect(r).toMatchObject({ ok: false, stale: false, error: 'ECONNRESET', ru: [], en: [] });
  });

  it('refuses an answer that is not the Russian changelog; a missing English file keeps Russian only', async () => {
    const wrong = setup(() => textRes('<html>rate limited</html>'));
    expect(await wrong.src.get()).toMatchObject({ ok: false, error: 'not a changelog' });
    const noEn = setup((url) => (url === CHANGELOG_SOURCES.ru ? textRes(RU) : textRes('', 404)));
    const r = await noEn.src.get();
    expect(r.ok).toBe(true);
    expect(r.en).toEqual([]);
  });

  it('a failed English refresh keeps the old English copy marked stale with its own age', async () => {
    let enDown = false;
    const s = setup((url) => (url === CHANGELOG_SOURCES.en && enDown ? textRes('', 500) : textRes(url === CHANGELOG_SOURCES.ru ? RU : EN)));
    const first = await s.src.get();
    expect(first).toMatchObject({ enStale: false, enError: '', enFetchedAt: first.fetchedAt });
    enDown = true;
    s.tick(11 * 60 * 1000);
    const next = await s.src.get();
    expect(next.stale).toBe(false);
    expect(next.fetchedAt).toBe(s.at());
    expect(next).toMatchObject({ enStale: true, enError: 'HTTP 500', enFetchedAt: first.fetchedAt });
    expect(next.en).toEqual(first.en);
  });

  it('refuses a body over 2 MB: by content-length, while streaming, and counted in bytes', async () => {
    const big = '# Изменения\n\n## 1.0.0\n\n- ' + 'я'.repeat(1_100_000) + '\n';
    expect(big.length).toBeLessThan(2 * 1024 * 1024);
    const bytes = setup(() => textRes(big));
    expect(await bytes.src.get()).toMatchObject({ ok: false, error: 'too large' });
    const header = setup(() => ({ ...textRes(RU), headers: { get: (k: string) => (k === 'content-length' ? String(3 * 1024 * 1024) : null) } }));
    expect(await header.src.get()).toMatchObject({ ok: false, error: 'too large' });
    let cancelled = false;
    let reads = 0;
    const chunk = new Uint8Array(512 * 1024);
    const stream = setup(() => ({
      ...textRes(''),
      headers: { get: () => null },
      body: {
        getReader: () => ({
          read: async () => {
            reads++;
            return reads > 100 ? { done: true, value: undefined } : { done: false, value: chunk };
          },
          cancel: async () => {
            cancelled = true;
          },
        }),
      },
    }));
    expect(await stream.src.get()).toMatchObject({ ok: false, error: 'too large' });
    expect(cancelled).toBe(true);
    expect(reads).toBeLessThan(10);
    const ok = setup((url) => ({
      ...textRes(''),
      headers: { get: () => null },
      body: (() => {
        const data = [new TextEncoder().encode(url === CHANGELOG_SOURCES.ru ? RU : EN)];
        return { getReader: () => ({ read: async () => (data.length ? { done: false, value: data.shift() } : { done: true, value: undefined }), cancel: async () => {} }) };
      })(),
    }));
    const r = await ok.src.get();
    expect(r.ok).toBe(true);
    expect(r.ru[1].items[2].text).toBe('Биллинг на Postgres 17');
  });

  it('one fetch for concurrent tab opens', async () => {
    const s = setup((url) => textRes(url === CHANGELOG_SOURCES.ru ? RU : EN));
    await Promise.all([s.src.get(), s.src.get(), s.src.get()]);
    expect(s.calls).toHaveLength(2);
  });
});
