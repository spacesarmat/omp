import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Invite } from '../src/screens/Invite';
import { loadPhoneReferral } from '../src/lib/referralLoad';
import { currentRoute, resetTo } from '../src/nav';

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
    expect(el.querySelector('[data-invite-link]')!.textContent).toBe('https://omp-player.online/r/OMP-1');
    expect(el.querySelector('[data-invite-code]')!.textContent).toContain('OMP-1');
    expect(el.querySelector('[data-invite-count]')!.textContent).toContain('3');
    act(() => (el.querySelector('[data-invite-share]') as HTMLButtonElement).click());
    expect(currentRoute.value.name).toBe('invite');
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
