import { describe, it, expect } from 'vitest';
import { checkedLine, episodesLine, freshText, hoursText, rangeText, subRule, summaryLines, whenText } from '../src/monitor/text';

const at = (h: number, m: number, dayShift = 0) => new Date(2026, 9, 3 + dayShift, h, m).getTime();

describe('monitoring texts', () => {
  it('times: today, yesterday, a date', () => {
    const now = at(15, 0);
    expect(whenText(at(14, 20), now)).toBe('сегодня 14:20');
    expect(whenText(at(9, 5, -1), now)).toBe('вчера 09:05');
    expect(whenText(at(9, 5, -3), now)).toBe('30 сент. 09:05');
  });

  it('«Проверено в … · следующая проверка около …»', () => {
    const now = at(15, 0);
    expect(checkedLine({ last: at(14, 20), next: at(17, 20), enabled: true, now })).toBe('Проверено в 14:20 · следующая проверка около 17:20');
    expect(checkedLine({ last: at(23, 0, -1), next: null, enabled: true, now })).toBe('Проверено вчера в 23:00');
    expect(checkedLine({ last: null, next: null, enabled: false, now })).toBe('Ещё не проверялось · фоновая проверка выключена');
  });

  it('hours, new counts', () => {
    expect([1, 3, 6, 12].map(hoursText)).toEqual(['раз в час', 'раз в 3 часа', 'раз в 6 часов', 'раз в 12 часов']);
    expect(freshText(1)).toBe('1 новая');
    expect(freshText(3)).toBe('3 новых');
    expect(freshText(21)).toBe('21 новая');
  });

  it('subscription conditions', () => {
    expect(subRule({ id: 'a', query: 'q', quality: '2160', sources: null, notify: true, createdAt: 0, minSeeds: 20 })).toBe('Все источники · 2160p · от 20 сидов');
    expect(subRule({ id: 'a', query: 'q', quality: '1080', sources: ['nnmclub'], notify: false, createdAt: 0, maxSizeGb: 8.5, minSeeds: 1 })).toBe(
      'nnmclub · от 1080p · от 1 сида · до 8,5 ГБ · без уведомлений',
    );
    expect(subRule({ id: 'a', query: 'q', quality: '', sources: null, notify: true, createdAt: 0 })).toBe('Все источники · любое качество');
  });

  it('episode ranges', () => {
    expect(episodesLine({ torrentHash: 'h', torrentTitle: 't', season: 2, haveTo: 8, to: 10 })).toBe('Вышли серии 9–10 · у вас 1–8');
    expect(episodesLine({ torrentHash: 'h', torrentTitle: 't', season: 2, haveTo: 9, to: 10 }, 5)).toBe('Вышла серия 10 · у вас 5–9');
    expect(rangeText('Starbound Frontier / Сезон 2 / Серии 1-10 из 10 / 1080p')).toBe('Серии 1–10 из 10');
    expect(rangeText('Show S03E05 1080p')).toBe('Серия 5');
    expect(rangeText('Фильм (2026) 1080p')).toBe('');
  });

  it('last check summary', () => {
    const now = at(15, 0);
    expect(
      summaryLines({ at: at(14, 20), kind: 'check', found: 0, notified: 0, answered: 7, asked: 8, subs: 3, skipped: 2, feed: false, error: 'Сервер недоступен' }, now),
    ).toEqual(['Последняя проверка: сегодня 14:20', 'Новых раздач нет', 'Источники: 7 из 8 ответили', 'Не успели проверить: 2 подписки', 'Сервер недоступен']);
  });
});
