import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { WhatsNewSheet } from '../src/ui/WhatsNewSheet';
import { whatsNew, closeWhatsNew } from '../../src/store/whatsNew';
import { CHANGELOG_URL } from '../../src/lib/changelogData';

function mount(): HTMLElement {
  document.body.innerHTML = '<div id="app"></div>';
  const el = document.getElementById('app')!;
  render(<WhatsNewSheet />, el);
  return el;
}
const btn = (el: HTMLElement, t: string) => Array.from(el.querySelectorAll('button')).find((b) => b.textContent === t)!;

beforeEach(() => closeWhatsNew());

describe('WhatsNewSheet', () => {
  it('renders nothing when closed', () => {
    expect(mount().querySelector('.m-sheet')).toBeNull();
  });

  it('shows versions, opens GitHub externally, closes', async () => {
    whatsNew.value = {
      title: 'Что нового в 0.2.0', auto: true,
      entries: [{ version: '0.2.0', items: ['А', 'Б'] }, { version: '0.1.0', items: ['В'] }],
    };
    const el = mount();
    expect(el.textContent).toContain('Что нового в 0.2.0');
    expect(el.querySelectorAll('h3').length).toBe(2);
    expect(el.querySelectorAll('li').length).toBe(3);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await act(async () => { btn(el, 'Все изменения на GitHub').click(); });
    expect(open).toHaveBeenCalledWith(CHANGELOG_URL, '_system');
    open.mockRestore();
    await act(async () => { btn(el, 'Закрыть').click(); });
    expect(whatsNew.value).toBeNull();
    expect(el.querySelector('.m-sheet')).toBeNull();
  });
});
