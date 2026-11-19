import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Invite } from '../src/screens/Invite';
import { loadPhoneReferral } from '../src/lib/referralLoad';
import { currentRoute, resetTo } from '../src/nav';
import { toast } from '../src/ui/toast';

let el: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
  resetTo({ name: 'invite' });
});

describe('tell friends', () => {
  it('stays off when the phone is signed out', async () => {
    expect(await loadPhoneReferral()).toEqual({ enabled: false, code: '', friends: 0, noticeDays: 0, noticeCredit: 0 });
  });

  it('says the program is off and hides the code', () => {
    act(() => render(<Invite />, el));
    expect(el.textContent).toContain('Реферальная программа выключена');
    expect(el.querySelector('[data-invite-link]')).toBeNull();
  });

  it('shows the link, the code, the counter and share', () => {
    act(() => render(<Invite enabled code="OMP-1" friends={3} />, el));
    expect(el.textContent).toContain('Пригласите друга');
    expect(el.textContent).toContain('Вам начисляется бонус');
    expect(el.querySelector('.m-invite-qr')).toBeTruthy();
    expect(el.querySelector('.m-invite-stat')).toBeTruthy();
    expect(el.querySelector('[data-invite-link]')!.textContent).toBe('https://omp-player.online/r/OMP-1');
    expect(el.querySelector('[data-invite-code]')!.textContent).toContain('OMP-1');
    expect(el.querySelector('[data-invite-count]')!.textContent).toContain('3');
    expect((el.querySelector('[data-invite-share]') as HTMLElement).classList.contains('m-invite-share')).toBe(true);
    act(() => (el.querySelector('[data-invite-share]') as HTMLButtonElement).click());
    expect(currentRoute.value.name).toBe('invite');
  });

  it('copies the code and the link and says so', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText }, share: undefined });
    toast.value = '';
    act(() => render(<Invite enabled code="OMP-1" friends={1} />, el));
    act(() => (el.querySelector('[aria-label="Скопировать промокод"]') as HTMLButtonElement).click());
    await act(async () => { await Promise.resolve(); });
    expect(writeText).toHaveBeenCalledWith('OMP-1');
    expect(toast.value).toBe('Промокод скопирован');
    act(() => (el.querySelector('[aria-label="Скопировать ссылку"]') as HTMLButtonElement).click());
    await act(async () => { await Promise.resolve(); });
    expect(writeText).toHaveBeenLastCalledWith('https://omp-player.online/r/OMP-1');
    expect(toast.value).toBe('Ссылка скопирована');
    vi.unstubAllGlobals();
    toast.value = '';
  });

  it('loads the signed-in card and shows the notice', async () => {
    let resolveCard: (row: { enabled: boolean; code: string; friends: number; noticeDays: number }) => void = () => undefined;
    const load = () => new Promise<{ enabled: boolean; code: string; friends: number; noticeDays: number }>((resolve) => {
      resolveCard = resolve;
    });
    await act(async () => {
      render(<Invite load={load} />, el);
    });
    await act(async () => {
      resolveCard({ enabled: true, code: 'OMP-9', friends: 2, noticeDays: 7 });
    });
    expect(el.querySelector('[data-invite-code]')!.textContent).toContain('OMP-9');
    expect(el.querySelector('[data-invite-count]')!.textContent).toContain('2');
    expect(el.querySelector('[data-invite-notice]')!.textContent).toContain('7');
  });
});
