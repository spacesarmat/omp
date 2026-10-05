import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { applyLanguageSetting } from '../../src/i18n';
import { Library } from '../src/screens/Library';
import { Add } from '../src/screens/Add';
import { Settings } from '../src/screens/Settings';
import { Remote } from '../src/screens/Remote';
import { Faq } from '../src/screens/Faq';
import { News, resetNews } from '../src/screens/News';
import { resetTo } from '../src/nav';
import { reloadTvs } from '../src/tv/tvStore';
import { reloadProgress } from '../../src/store/progress';
import { addServer, setActiveServer, servers, removeServer } from '../../src/store/servers';
import { torrents } from '../../src/store/library';

const CYR = /[А-Яа-яЁё]/;
let el: HTMLElement;

const flush = () =>
  act(async () => {
    for (let i = 0; i < 15; i++) await Promise.resolve();
  });

async function mount(ui: preact.VNode): Promise<string> {
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
  await act(async () => render(ui, el));
  await flush();
  return (el.textContent || '').replace(/Русский/g, '');
}

beforeEach(() => {
  localStorage.clear();
  reloadTvs();
  reloadProgress();
  resetNews();
  for (const s of servers.value.slice()) removeServer(s.id);
  setActiveServer(addServer({ url: 'http://srv:8090' }).id);
  torrents.value = [];
  resetTo({ name: 'settings' });
  applyLanguageSetting('en');
});
afterEach(() => {
  act(() => render(null, el));
  document.body.innerHTML = '';
  applyLanguageSetting('ru');
});

describe('phone screens in English: no Cyrillic', () => {
  it('Library (empty state)', async () => {
    const text = await mount(<Library />);
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toMatch(CYR);
  });
  it('Add', async () => {
    const text = await mount(<Add />);
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toMatch(CYR);
  });
  it('Settings', async () => {
    const text = await mount(<Settings />);
    expect(text).toContain('Language');
    expect(text).not.toMatch(CYR);
  });
  it('Remote (no TV)', async () => {
    const text = await mount(<Remote />);
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toMatch(CYR);
  });
  it('FAQ', async () => {
    const text = await mount(<Faq />);
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toMatch(CYR);
  });
  it('News', async () => {
    const text = await mount(<News />);
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toMatch(CYR);
  });
});
