import { describe, expect, it } from 'vitest';
import {
  applyBuilt,
  markupError,
  normalizeDashes,
  normalizeLang,
  pickVariant,
  previewNodes,
  referralNotes,
  renderBody,
  subscriptionCopyState,
  templateById,
  validateCopy,
  CATALOG,
} from '../src/botCopy.mjs';

const home = () => templateById('cabinet.home');

describe('bot copy catalog', () => {
  it('lists every user-facing group once per id', () => {
    const ids = CATALOG.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    const cats = new Set(CATALOG.map((row) => row.category));
    for (const name of ['Кабинет', 'Оплата', 'Продление', 'Донаты', 'Рефералы', 'Устройства', 'Промокод', 'Поддержка']) {
      expect(cats.has(name)).toBe(true);
    }
    expect(templateById('cabinet.home')?.required).toContain('status');
    expect(templateById('renewal.quote')).toBeTruthy();
    expect(templateById('donate.thanks')).toBeTruthy();
    expect(templateById('referral.bound')).toBeTruthy();
    expect(templateById('pay.received_new')).toBeTruthy();
    expect(templateById('promo.bad')).toBeTruthy();
  });

  it('keeps default texts free of em and en dashes', () => {
    const blob = JSON.stringify(CATALOG);
    expect(blob).not.toContain('\u2014');
    expect(blob).not.toContain('\u2013');
  });
});

describe('bot copy render and validation', () => {
  it('replaces em and en dashes before save', () => {
    expect(normalizeDashes('a\u2014b\u2013c')).toBe('a-b-c');
    const out = validateCopy(home(), { body: 'Кабинет \u2014 {status}', buttons: null, mediaKind: '', mediaUrl: '' });
    expect(out.ok).toBe(true);
    expect(out.value?.body).toBe('Кабинет - {status}');
  });

  it('renders known variables and escapes values for HTML', () => {
    expect(renderBody('Привет, {name}', { name: 'Ann' })).toBe('Привет, Ann');
    expect(renderBody('Привет, {name}', { name: '<b>' })).toBe('Привет, &lt;b&gt;');
    expect(renderBody('{missing}', {})).toBe('');
  });

  it('rejects unknown variables, missing required ones, broken markup and oversize text', () => {
    const unknown = validateCopy(home(), { body: 'Hi {status} {nope}', buttons: null, mediaKind: '', mediaUrl: '' });
    expect(unknown.ok).toBe(false);
    expect(unknown.errors.join(' ')).toContain('{nope}');

    const missing = validateCopy(home(), { body: 'Только текст', buttons: null, mediaKind: '', mediaUrl: '' });
    expect(missing.ok).toBe(false);
    expect(missing.errors.join(' ')).toContain('{status}');

    expect(markupError('<b>ok</b>')).toBe('');
    expect(markupError('<a href="https://omp-player.online">x</a>')).toBe('');
    expect(markupError('<b>x')).not.toBe('');
    expect(markupError('<script>x</script>')).not.toBe('');
    expect(markupError('<a href="javascript:alert(1)">x</a>')).not.toBe('');

    const long = validateCopy(home(), { body: '{status}' + 'я'.repeat(4096), buttons: null, mediaKind: '', mediaUrl: '' });
    expect(long.ok).toBe(false);
    expect(long.errors.join(' ')).toContain('4096');

    const caption = validateCopy(home(), {
      body: '{status}' + 'я'.repeat(1024),
      buttons: null,
      mediaKind: 'photo',
      mediaUrl: 'https://omp-player.online/a.jpg',
    });
    expect(caption.ok).toBe(false);
    expect(caption.errors.join(' ')).toContain('1024');
  });

  it('rejects a bad button and keeps generated buttons when buttons is null', () => {
    const bad = validateCopy(home(), {
      body: '{status}',
      mediaKind: '',
      mediaUrl: '',
      buttons: [[{ text: '', kind: 'url', value: 'https://omp-player.online' }]],
    });
    expect(bad.ok).toBe(false);

    const keep = validateCopy(home(), { body: '{status}', buttons: null, mediaKind: '', mediaUrl: '' });
    expect(keep.ok).toBe(true);
    expect(keep.value?.buttons).toBeNull();
  });
});

describe('bot copy variants and fallback', () => {
  it('maps language and subscription state', () => {
    expect(normalizeLang('en-US')).toBe('en');
    expect(normalizeLang('ru')).toBe('ru');
    expect(normalizeLang('de')).toBe('');
    expect(subscriptionCopyState(null, false)).toBe('');
    expect(subscriptionCopyState({ active: false, inGrace: false }, true)).toBe('expired');
    expect(subscriptionCopyState({ active: true, inGrace: true }, true)).toBe('expired');
    expect(subscriptionCopyState({ active: true, inGrace: false }, false)).toBe('trial');
    expect(subscriptionCopyState({ active: true, inGrace: false }, true)).toBe('active');
  });

  it('prefers the exact variant, then language, then state, then the default', () => {
    const rows = [
      { subState: '', lang: '', body: 'default' },
      { subState: 'active', lang: '', body: 'active' },
      { subState: '', lang: 'en', body: 'en' },
      { subState: 'active', lang: 'en', body: 'active-en' },
    ];
    expect(pickVariant(rows, 'active', 'en')?.body).toBe('active-en');
    expect(pickVariant(rows.filter((r) => r.body !== 'active-en'), 'active', 'en')?.body).toBe('en');
    expect(pickVariant(rows.filter((r) => r.lang !== 'en'), 'active', 'en')?.body).toBe('active');
    expect(pickVariant([rows[0]], 'expired', 'ru')?.body).toBe('default');
    expect(pickVariant([], 'active', 'en')).toBeNull();
  });

  it('keeps the in-code message until a saved template applies', () => {
    const built = { text: 'из кода', inline: { inline_keyboard: [[{ text: 'Оплатить', url: 'https://t.me/x' }]] }, parseMode: 'Markdown' };
    const same = applyBuilt(null, built, {});
    expect(same.used).toBe('code');
    expect(same.text).toBe('из кода');
    expect(same.parseMode).toBe('Markdown');

    const custom = applyBuilt(
      { body: '<b>{name}</b>', buttons: [[{ text: 'Сайт', kind: 'url', value: 'https://omp-player.online' }]], mediaKind: '', mediaUrl: '' },
      built,
      { name: 'Ann' },
    );
    expect(custom.used).toBe('template');
    expect(custom.text).toBe('<b>Ann</b>');
    expect(custom.parseMode).toBe('HTML');
    expect(custom.inline).toEqual({ inline_keyboard: [[{ text: 'Сайт', url: 'https://omp-player.online' }]] });

    const huge = applyBuilt({ body: '{name}', buttons: null, mediaKind: '', mediaUrl: '' }, built, { name: 'я'.repeat(5000) });
    expect(huge.used).toBe('code');
    expect(huge.text).toBe('из кода');
  });

  it('renders a telegram-like preview without raw html injection', () => {
    const nodes = previewNodes('<b>A</b> <a href="https://omp-player.online">B</a>');
    expect(nodes.map((n) => n.type)).toEqual(['b', 'text', 'a']);
    expect(previewNodes('<script>x</script>')[0]).toMatchObject({ type: 'text' });
  });
});

describe('referral notices', () => {
  it('reports a grant once when the journal row becomes granted', () => {
    const before = [{ id: '1', status: 'waiting', referrerId: 'r', friendId: 'f', days: 0, friendGranted: false }];
    const after = [{ id: '1', status: 'granted', referrerId: 'r', friendId: 'f', days: 7, friendGranted: true }];
    expect(referralNotes(before, after)).toEqual([
      { accountId: 'r', role: 'referrer', days: 7 },
      { accountId: 'f', role: 'friend', days: 0 },
    ]);
    expect(referralNotes(after, after)).toEqual([]);
  });
});
