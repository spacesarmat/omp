import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { render, h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { init, setFocus, getCurrentFocusKey } from '@noriginmedia/norigin-spatial-navigation';
import { Focusable, FocusGroup } from '../../src/ui/components';
import { restoreFocus } from '../../src/ui/focus';
import { SettingsScreen } from '../../src/screens/Settings';
import { navigate, goBack, resetTo, currentRoute } from '../../src/ui/nav';

async function until(cond: () => boolean) {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(cond()).toBe(true);
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A settings-like screen: rows without focus keys (the library makes them up), optionally arriving later. */
// how late the rows of the next mount arrive (the server answers after the screen is up)
let late = 0;

function Rows(p: { keyed?: boolean }) {
  const [shown, setShown] = useState(!late);
  useEffect(() => {
    if (late) setTimeout(() => setShown(true), late);
    restoreFocus('first');
  }, []);
  const rows: preact.JSX.Element[] = [];
  for (let i = 0; i < 8; i++) {
    rows.push(
      <Focusable key={i} focusKey={p.keyed ? 'row-' + i : undefined} className={'row row-' + i}>
        {'row ' + i}
      </Focusable>,
    );
  }
  return (
    <FocusGroup focusKey="SCREEN">
      <Focusable focusKey="first" className="first">top</Focusable>
      {shown && rows}
    </FocusGroup>
  );
}

function Sub() {
  useEffect(() => restoreFocus('sub-back'), []);
  return (
    <FocusGroup focusKey="SUB">
      <Focusable focusKey="sub-back">back</Focusable>
    </FocusGroup>
  );
}

let host: HTMLElement | null = null;

function App(p: { keyed?: boolean }) {
  const r = currentRoute.value;
  return <div class="screen-host">{r.name === 'settings' ? <Rows keyed={p.keyed} /> : <Sub />}</div>;
}

function mount(p: { keyed?: boolean } = {}) {
  host = document.createElement('div');
  document.body.appendChild(host);
  render(h(App, p), host);
}

function focusedClass(): string {
  const el = document.querySelector('.screen-host .focused');
  return el ? el.className : '';
}

beforeAll(() => {
  init({ debug: false, visualDebug: false });
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

afterEach(async () => {
  late = 0;
  if (host) render(null, host);
  host = null;
  await wait(60);
});

describe('focus on Back (TV)', () => {
  it('returns to a row without a focus key, by its place on the screen', async () => {
    resetTo({ name: 'settings' });
    mount();
    await until(() => document.querySelectorAll('.row').length === 8);
    await wait(150);
    const key = document.querySelector('.row-5')!.getAttribute('data-fk')!;
    expect(key.indexOf('sn:')).toBe(0);
    setFocus(key);
    await until(() => focusedClass().indexOf('row-5') >= 0);
    navigate({ name: 'update' });
    await until(() => getCurrentFocusKey() === 'sub-back');
    goBack();
    await wait(100);
    await until(() => focusedClass().indexOf('row-5') >= 0);
  });

  it('waits for rows that arrive later', async () => {
    resetTo({ name: 'settings' });
    mount({ keyed: true });
    await until(() => document.querySelectorAll('.row').length === 8);
    await wait(150);
    setFocus('row-6');
    await until(() => getCurrentFocusKey() === 'row-6');
    navigate({ name: 'update' });
    await until(() => getCurrentFocusKey() === 'sub-back');
    late = 300;
    goBack();
    await until(() => getCurrentFocusKey() === 'first');
    await until(() => getCurrentFocusKey() === 'row-6');
  });

  it('every row of TV Settings has its own focus key (Back returns to it even if a section appears)', async () => {
    const box = document.createElement('div');
    box.className = 'screen-host';
    document.body.appendChild(box);
    render(h(SettingsScreen, {}), box);
    await wait(150);
    const keys = Array.from(box.querySelectorAll('[data-fk]')).map((n) => n.getAttribute('data-fk')!);
    expect(keys.length).toBeGreaterThan(10);
    expect(keys.filter((k) => k.indexOf('sn:') === 0)).toEqual([]);
    render(null, box);
    box.remove();
  });

  it('a key press while waiting keeps the focus where the user put it', async () => {
    resetTo({ name: 'settings' });
    mount({ keyed: true });
    await until(() => document.querySelectorAll('.row').length === 8);
    await wait(150);
    setFocus('row-6');
    await until(() => getCurrentFocusKey() === 'row-6');
    navigate({ name: 'update' });
    await until(() => getCurrentFocusKey() === 'sub-back');
    late = 300;
    goBack();
    await until(() => getCurrentFocusKey() === 'first');
    window.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 999 } as KeyboardEventInit));
    await wait(500);
    expect(getCurrentFocusKey()).toBe('first');
  });
});
