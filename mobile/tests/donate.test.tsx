import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import {
  DONATE_METHODS,
  activeMethods,
  donateCardDue,
  dismissDonateCard,
  ensureFirstRun,
  openDonate,
  closeDonate,
  FIRST_RUN_KEY,
  DONATE_CARD_KEY,
  CARD_AFTER_MS,
  type DonateMethod,
} from '../src/donate';
import { DonateSheet, setDonateActions } from '../src/ui/DonateSheet';
import { WhatsNewSheet } from '../src/ui/WhatsNewSheet';
import { Settings } from '../src/screens/Settings';
import { openWhatsNew, closeWhatsNew } from '../../src/store/whatsNew';
import { donateOpen } from '../src/donate';
import { localServer } from '../src/server/localServer';
import { NOT_BACKED_UP, BACKUP_KEYS } from '../src/lib/backup';

function mount(ui: preact.VNode): HTMLElement {
  document.body.innerHTML = '<div id="app"></div>';
  const el = document.getElementById('app')!;
  act(() => render(ui, el));
  return el;
}
const btn = (el: ParentNode, t: string) => Array.from(el.querySelectorAll('button')).find((b) => (b.textContent || '').includes(t))!;

const CRYPTO: DonateMethod = {
  id: 'crypto',
  title: 'Криптовалюта',
  wallets: [
    { network: 'TON', address: 'UQfakeaddress1' },
    { network: '', address: 'skipped' },
  ],
};

beforeEach(() => {
  localStorage.clear();
  localServer.value = { supported: false, running: false };
  closeDonate();
  closeWhatsNew();
});
afterEach(() => {
  setDonateActions();
  vi.restoreAllMocks();
});

describe('donate config', () => {
  it('ships only Boosty; empty methods are hidden', () => {
    const a = activeMethods();
    expect(a.map((m) => m.id)).toEqual(['boosty']);
    expect(a[0].url).toBe('https://boosty.to/djmaker/donate');
    expect(DONATE_METHODS.map((m) => m.id)).toEqual(['boosty', 'yoomoney', 'crypto']);
  });

  it('hides blank urls, non-https urls and wallets without data; keeps order', () => {
    const list: DonateMethod[] = [
      { id: 'yoomoney', title: 'ЮMoney', url: 'https://yoomoney.example/x' },
      { id: 'boosty', title: 'Boosty', url: '' },
      { id: 'crypto', title: 'Крипто', wallets: [{ network: 'BTC', address: '' }] },
    ];
    expect(activeMethods(list).map((m) => m.id)).toEqual(['yoomoney']);
    expect(activeMethods([{ id: 'boosty', title: 'B', url: 'javascript:alert(1)' }])).toEqual([]);
    expect(activeMethods(CRYPTO && [CRYPTO])[0].wallets).toEqual([{ network: 'TON', address: 'UQfakeaddress1' }]);
  });

  it('its storage keys are per device, never in a backup', () => {
    for (const k of [FIRST_RUN_KEY, DONATE_CARD_KEY]) {
      expect(NOT_BACKED_UP).toContain(k);
      expect(BACKUP_KEYS).not.toContain(k);
    }
  });
});

describe('DonateSheet', () => {
  it('renders nothing while closed', () => {
    const el = mount(<DonateSheet />);
    expect(el.querySelector('[role=dialog]')).toBeNull();
  });

  it('shows Boosty and opens its url through the helper', async () => {
    const openUrl = vi.fn();
    setDonateActions({ openUrl });
    const el = mount(<DonateSheet />);
    await act(async () => { openDonate(); });
    expect(el.textContent).toContain('бесплатный и без рекламы');
    expect(el.textContent).not.toContain('ЮMoney');
    expect(el.textContent).not.toContain('Криптовалюта');
    await act(async () => btn(el, 'Boosty').click());
    expect(openUrl).toHaveBeenCalledWith('https://boosty.to/djmaker/donate');
  });

  it('renders crypto wallets and copies the address', async () => {
    const copy = vi.fn().mockResolvedValue(undefined);
    setDonateActions({ copy });
    const el = mount(<DonateSheet methods={[CRYPTO]} />);
    await act(async () => { openDonate(); });
    expect(el.textContent).toContain('TON');
    expect(el.textContent).toContain('UQfakeaddress1');
    expect(el.textContent).not.toContain('skipped');
    await act(async () => btn(el, 'Скопировать').click());
    expect(copy).toHaveBeenCalledWith('UQfakeaddress1');
  });

  it('closes by the button', async () => {
    const el = mount(<DonateSheet />);
    await act(async () => { openDonate(); });
    await act(async () => btn(el, 'Закрыть').click());
    expect(donateOpen.value).toBe(false);
  });
});

describe('30-day card', () => {
  const T0 = 1_800_000_000_000;
  it('first call stores the first-run time (existing users too) and is not due', () => {
    expect(donateCardDue(undefined, T0)).toBe(false);
    expect(JSON.parse(localStorage.getItem(FIRST_RUN_KEY)!)).toBe(T0);
    expect(ensureFirstRun(T0 + 1)).toBe(T0);
  });
  it('is due only after 30 days', () => {
    localStorage.setItem(FIRST_RUN_KEY, JSON.stringify(T0));
    expect(donateCardDue(undefined, T0 + CARD_AFTER_MS - 1)).toBe(false);
    expect(donateCardDue(undefined, T0 + CARD_AFTER_MS)).toBe(true);
  });
  it('a corrupt timestamp is replaced by now', () => {
    localStorage.setItem(FIRST_RUN_KEY, '"x"');
    expect(donateCardDue(undefined, T0)).toBe(false);
    expect(JSON.parse(localStorage.getItem(FIRST_RUN_KEY)!)).toBe(T0);
  });
  it('dismissing persists', () => {
    localStorage.setItem(FIRST_RUN_KEY, JSON.stringify(T0));
    expect(donateCardDue(undefined, T0 + CARD_AFTER_MS)).toBe(true);
    dismissDonateCard();
    expect(donateCardDue(undefined, T0 + CARD_AFTER_MS * 2)).toBe(false);
  });
  it('is hidden when no method is configured', () => {
    localStorage.setItem(FIRST_RUN_KEY, JSON.stringify(T0));
    expect(donateCardDue([{ id: 'boosty', title: 'B', url: '' }], T0 + CARD_AFTER_MS * 2)).toBe(false);
  });
});

describe('entry points', () => {
  it('Settings → «О приложении» has «Поддержать OMP» that opens the sheet', async () => {
    const el = mount(<Settings />);
    await act(async () => btn(el, 'Поддержать OMP').click());
    expect(donateOpen.value).toBe(true);
  });
  it('«Что нового» has a link that swaps to the donate sheet', async () => {
    const el = mount(<WhatsNewSheet />);
    await act(async () => openWhatsNew([{ version: '0.14.1', items: ['x'] }], '0.14.1'));
    await act(async () => btn(el, 'Поддержать OMP').click());
    expect(donateOpen.value).toBe(true);
    expect(el.querySelector('[role=dialog]')).toBeNull();
  });
});

describe('fresh install detection', () => {
  it('the first-run time does not make a new install look like an update', async () => {
    const { checkWhatsNew, whatsNew } = await import('../../src/store/whatsNew');
    ensureFirstRun();
    checkWhatsNew([{ version: '0.14.1', items: ['x'] }], '0.14.1');
    expect(whatsNew.value).toBeNull();
  });
});
