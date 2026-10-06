import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { applyLanguageSetting } from '../../src/i18n';
import { Faq, searchFaq } from '../src/screens/Faq';
import { FAQ, DEVICES, SECTIONS, faqText, resolveFaqLink, type FaqLine } from '../src/faq';
import { FAQ_RU } from '../src/faq.ru';
import { FAQ_EN } from '../src/faq.en';
import { FAQ_ATV_ADB, FAQ_LG_DEVMODE, FAQ_SAMSUNG, FAQ_XIAOMI, FAQ_SBER, FAQ_YANDEX } from '../../src/lib/installPlan';
import { resetTo } from '../src/nav';

function mount(ui: preact.VNode): HTMLElement {
  document.body.innerHTML = '<div id="app"></div>';
  const el = document.getElementById('app')!;
  act(() => render(ui, el));
  return el;
}
const lineText = (l: FaqLine) => (typeof l === 'string' ? l : l.text);
const all = (x: { q: string; short: FaqLine[]; more?: FaqLine[]; by?: { [d: string]: { q?: string; short?: FaqLine[]; more?: FaqLine[] } | undefined } }) => {
  const out: string[] = [x.q, ...x.short.map(lineText), ...(x.more || []).map(lineText)];
  for (const k of Object.keys(x.by || {})) {
    const o = x.by![k]!;
    if (o.q) out.push(o.q);
    out.push(...(o.short || []).map(lineText), ...(o.more || []).map(lineText));
  }
  return out;
};

beforeEach(() => {
  localStorage.clear();
  resetTo({ name: 'settings' });
  applyLanguageSetting('en');
});
afterEach(() => applyLanguageSetting('ru'));

describe('English FAQ', () => {
  it('has the same ids and line counts as the Russian one', () => {
    expect(Object.keys(FAQ_EN).sort()).toEqual(Object.keys(FAQ_RU).sort());
    expect(Object.keys(FAQ_RU).sort()).toEqual(FAQ.map((i) => i.id).sort());
    for (const id of Object.keys(FAQ_RU)) {
      const r = FAQ_RU[id];
      const e = FAQ_EN[id];
      expect(e.short.length, id + ' short').toBe(r.short.length);
      expect((e.more || []).length, id + ' more').toBe((r.more || []).length);
      expect(Object.keys(e.by || {}).sort(), id + ' by').toEqual(Object.keys(r.by || {}).sort());
      for (const d of Object.keys(r.by || {})) {
        const ro = (r.by as any)[d];
        const eo = (e.by as any)[d];
        expect((eo.short || []).length, id + ' by short').toBe((ro.short || []).length);
        expect((eo.more || []).length, id + ' by more').toBe((ro.more || []).length);
        expect(!!eo.q, id + ' by q').toBe(!!ro.q);
      }
      // links keep the same urls
      const urls = (x: typeof r) => JSON.stringify(all(x).length) && [...x.short, ...(x.more || [])].filter((l) => typeof l !== 'string').map((l) => (l as { url: string }).url);
      expect(urls(e)).toEqual(urls(r));
    }
  });

  it('has the brand questions with the English pairing wording', () => {
    for (const id of ['xiaomi', 'sber', 'yandex']) {
      const x = faqText(id);
      expect(x.short.map((l) => (typeof l === 'string' ? l : l.text)).join(' '), id).toContain('Settings → “Connect a phone”');
      expect(x.short.join(' '), id).toContain('4-digit code');
    }
    expect(faqText('xiaomi').q).toBe('Install on Xiaomi (Mi Box, Mi TV)');
    expect(faqText('sber').short.join(' ')).toContain('apps.sber.ru/my');
    expect((faqText('yandex').more || []).join(' ')).toContain('subscription');
  });

  it('has no Cyrillic', () => {
    for (const id of Object.keys(FAQ_EN)) for (const s of all(FAQ_EN[id])) expect(/[А-Яа-яЁё]/.test(s), id + ': ' + s).toBe(false);
  });

  it('serves the English texts, chips and sections in English', () => {
    expect(faqText('no-sound').q).toBe('No sound (AC3, DTS)');
    expect(DEVICES.map((d) => d.label)).toEqual(['LG TV', 'Android TV', 'Phone', 'TorrServer', 'General']);
    for (const s of SECTIONS) expect(/[А-Яа-я]/.test(s.label)).toBe(false);
    expect(FAQ.find((i) => i.id === 'no-sound')!.q).toBe('No sound (AC3, DTS)');
  });

  it('shows an English page and finds Jackett, “no sound” and “update”', async () => {
    const el = mount(<Faq />);
    expect(el.querySelector('.m-bar-title')!.textContent).toBe('Questions and answers');
    expect(el.querySelector('input')!.getAttribute('placeholder')).toBe('Search: “no sound”, “update”…');
    expect(searchFaq('Jackett').length).toBeGreaterThan(0);
    expect(searchFaq('no sound').some((h) => h.item.id === 'no-sound')).toBe(true);
    expect(searchFaq('update').length).toBeGreaterThan(0);
    const input = el.querySelector('input')!;
    await act(async () => {
      input.value = 'Jackett';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(el.querySelectorAll('.m-faq-q').length).toBeGreaterThan(0);
    expect(el.querySelector('.m-faq-hint')!.textContent).toContain('Found');
  });

  it('opens questions from the install assistant by id in English too', () => {
    expect(resolveFaqLink(FAQ_LG_DEVMODE)).toEqual({ id: 'lg-devmode', device: 'lg' });
    expect(resolveFaqLink(FAQ_ATV_ADB)).toEqual({ id: 'atv-adb', device: 'atv' });
    expect(resolveFaqLink(FAQ_SAMSUNG)).toEqual({ id: 'samsung', device: 'common' });
    expect(resolveFaqLink(FAQ_XIAOMI)).toEqual({ id: 'xiaomi', device: 'atv' });
    expect(resolveFaqLink(FAQ_SBER)).toEqual({ id: 'sber', device: 'atv' });
    expect(resolveFaqLink(FAQ_YANDEX)).toEqual({ id: 'yandex', device: 'atv' });
    const el = mount(<Faq q={FAQ_LG_DEVMODE} />);
    expect(el.querySelector('.m-faq-item.open .m-faq-q')!.textContent).toContain('Install without root');
  });
});
