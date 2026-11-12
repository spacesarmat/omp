import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Invite } from '../src/screens/Invite';
import { currentRoute, resetTo } from '../src/nav';

let el: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
  resetTo({ name: 'invite' });
});

describe('tell friends', () => {
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
});
