import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { applyLanguageSetting } from '../../src/i18n';
import { Sheet } from '../src/ui/Sheet';
import { CatalogUnavailable } from '../src/ui/CatalogUnavailable';
import { CodeSheet } from '../src/ui/CodeSheet';
import { DonateSheet, setDonateActions } from '../src/ui/DonateSheet';
import { LaunchError } from '../src/ui/LaunchError';
import { MiniPlayer } from '../src/ui/MiniPlayer';
import { NavBar } from '../src/ui/NavBar';
import { OldTvDialog } from '../src/ui/OldTvDialog';
import { RenameSheet } from '../src/ui/RenameSheet';
import { ResultCard } from '../src/ui/ResultCard';
import { ResumeSheet } from '../src/ui/ResumeSheet';
import { TorrentRenameSheet } from '../src/ui/TorrentRenameSheet';
import { TouchpadSheet } from '../src/ui/TouchpadSheet';
import { TrackerLogin } from '../src/ui/TrackerLogin';
import { TracksSheet } from '../src/ui/TracksSheet';
import { TvChip } from '../src/ui/TvChip';
import { useResultRows } from '../src/ui/useResultRows';
import { donateOpen, closeDonate } from '../src/donate';
import { nowPlaying } from '../src/tv/playerLink';
import { linkStatus } from '../src/tv/playerLink';
import { saveTv, setActiveTv, reloadTvs } from '../src/tv/tvStore';
import { tvNoOmp } from '../src/tv/tvClient';
import type { PlayerState } from '../../src/phone/protocol';
import type { Source, SourceResult } from '../../src/sources/types';

const CYR = /[А-Яа-яЁё]/;
let el: HTMLElement;

function mount(ui: preact.VNode): HTMLElement {
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
  act(() => render(ui, el));
  return el;
}
const text = () => el.textContent || '';
const buttons = () => Array.from(el.querySelectorAll('button')).map((b) => b.textContent).filter(Boolean);
const labels = () => Array.from(el.querySelectorAll('[aria-label]')).map((n) => n.getAttribute('aria-label'));

beforeEach(() => {
  localStorage.clear();
  applyLanguageSetting('en');
});
afterEach(() => {
  applyLanguageSetting('ru');
  document.body.innerHTML = '';
});

describe('phone shared UI in English', () => {
  it('Sheet: the backdrop is labelled in English', () => {
    mount(<Sheet label="x" onClose={() => {}}>body</Sheet>);
    expect(labels()).toContain('Close');
    expect(el.innerHTML).not.toMatch(CYR);
  });

  it('CatalogUnavailable', () => {
    mount(<CatalogUnavailable reason="Server unreachable" onRetry={() => {}} onStart={() => {}} onChangeServer={() => {}} onFaq={() => {}} />);
    expect(text()).toContain('Catalog unavailable');
    expect(buttons()).toEqual(expect.arrayContaining(['Retry', 'Start the server', 'Change server', 'Questions and answers']));
    expect(text()).not.toMatch(CYR);
  });

  it('CodeSheet', () => {
    mount(<CodeSheet tvName="Living room" onSubmit={async () => {}} onCancel={() => {}} />);
    expect(text()).toContain('Living room · Android TV');
    expect(text()).toContain('Settings → “Connect phone”');
    expect(buttons()).toEqual(expect.arrayContaining(['Connect', 'Cancel']));
    expect(labels()).toEqual(expect.arrayContaining(['Code from the TV screen', 'Digit 1', 'Digit 4']));
    expect(el.innerHTML).not.toMatch(CYR);
  });

  it('DonateSheet', () => {
    setDonateActions({ openUrl: () => {}, copy: async () => {}, paste: async () => '' });
    donateOpen.value = true;
    mount(
      <DonateSheet
        methods={[
          { id: 'boosty', title: 'Boosty', url: 'https://boosty.to/x' },
          { id: 'crypto', title: 'Crypto', wallets: [{ network: 'TON', address: 'UQabc' }] },
        ]}
      />,
    );
    expect(text()).toContain('Support OMP');
    expect(text()).toContain('OMP is free and has no ads');
    expect(text()).toContain('Already supported?');
    expect(buttons()).toEqual(expect.arrayContaining(['Support on Boosty', 'Copy', 'Paste', 'Apply', 'Close']));
    expect(labels()).toContain('Copy the TON address');
    expect(el.querySelector('input')!.getAttribute('placeholder')).toBe('OMP-YYYY-MM-…');
    expect(el.innerHTML).not.toMatch(CYR);
    closeDonate();
    setDonateActions();
  });

  it('LaunchError offers the install guide in English', () => {
    mount(<LaunchError message={tvNoOmp()} />);
    expect(buttons()).toEqual(['How to install OMP on the TV']);
  });

  it('MiniPlayer', () => {
    const state: PlayerState = {
      hash: 'a'.repeat(40), file: 0, title: 'Show', subtitle: 'Show · S01E02', time: 90, duration: 3600, paused: true, buffering: false,
      audio: { list: [], sel: 0 }, subs: { list: [], sel: '' }, next: null,
    };
    saveTv({ ip: '10.0.0.5', name: 'Living room' });
    setActiveTv('10.0.0.5');
    nowPlaying.value = state;
    const spy = vi.spyOn(linkStatus, 'value', 'get').mockReturnValue('live');
    mount(<MiniPlayer />);
    expect(text()).toContain('On Living room · 1:30 of 1:00:00');
    expect(labels()).toEqual(expect.arrayContaining(['Back 10 seconds', 'Play']));
    expect(el.innerHTML).not.toMatch(CYR);
    spy.mockRestore();
    nowPlaying.value = null;
    reloadTvs();
  });

  it('NavBar', () => {
    mount(<NavBar active="library" />);
    expect(labels()).toContain('Sections');
    expect(buttons()).toEqual(['Catalog', 'News', 'Add', 'Remote', 'Settings']);
  });

  it('OldTvDialog', () => {
    mount(<OldTvDialog tvName="Living room" version="0.7.0" onContinue={() => {}} onGuide={() => {}} onClose={() => {}} />);
    expect(text()).toContain('Update OMP on the TV');
    expect(text()).toContain('Living room has OMP 0.7.0');
    expect(buttons()).toEqual(expect.arrayContaining(['Start anyway', 'How to update']));
    expect(el.innerHTML).not.toMatch(CYR);
  });

  it('RenameSheet', () => {
    mount(<RenameSheet title="Rename TV" value="x" onSave={() => {}} onCancel={() => {}} />);
    expect(buttons()).toEqual(expect.arrayContaining(['Cancel', 'Save']));
    expect(el.innerHTML).not.toMatch(CYR);
  });

  it('ResultCard', () => {
    const r: SourceResult = {
      Title: 'Dune', Categories: '', Size: '41 GB', CreateDate: '', Tracker: '', Link: '', Magnet: '', Hash: '', Peer: 0, Seed: 12, source: 'fake',
      sources: ['one', 'two'],
    } as SourceResult;
    mount(<ResultCard r={r} category="movie" busy="link" onCategory={() => {}} onAdd={() => {}} onWatch={() => {}} />);
    expect(text()).toContain('Getting the link…');
    expect(buttons()).toEqual(expect.arrayContaining(['Add', 'On TV']));
    expect(labels()).toEqual(expect.arrayContaining(['Add to the server: Dune', 'Add and watch on TV: Dune']));
    expect(text()).toContain('also in');
    expect(el.innerHTML).not.toMatch(CYR);
  });

  it('ResumeSheet', () => {
    mount(<ResumeSheet info="Show · S01E02" at={600} duration={3600} onResume={() => {}} onRestart={() => {}} onCancel={() => {}} />);
    expect(text()).toContain('Where to start?');
    expect(text()).toContain('Continue from 10:00');
    expect(text()).toContain('50 min left');
    expect(buttons().join('|')).toContain('From the start');
    expect(buttons()).toContain('Cancel');
    expect(el.innerHTML).not.toMatch(CYR);
  });

  it('TorrentRenameSheet', () => {
    mount(<TorrentRenameSheet initial="x" onSave={async () => {}} onClose={() => {}} />);
    expect(el.querySelector('.m-sheet-title')!.textContent).toBe('Rename');
    expect(el.querySelector('label')!.textContent).toBe('Title');
    expect(buttons()).toEqual(['Cancel', 'Save']);
    expect(el.innerHTML).not.toMatch(CYR);
  });

  it('TouchpadSheet', () => {
    mount(<TouchpadSheet onClose={() => {}} />);
    expect(el.querySelector('.m-sheet-title')!.textContent).toBe('Touchpad');
    expect(text()).toContain('Cursor speed');
    expect(text()).toContain('3 of 5');
    expect(text()).toContain('Tap to click');
    expect(text()).toContain('Reverse scrolling');
    expect(text()).toContain('Scroll strip');
    expect(buttons()).toContain('Done');
    expect(el.innerHTML).not.toMatch(CYR);
  });

  it('TrackerLogin', () => {
    const source = { id: 's', name: 'rutracker', kind: 'builtin', login: async () => {}, search: async () => [] } as unknown as Source;
    mount(<TrackerLogin source={source} ctx={() => ({}) as never} onClose={() => {}} onDone={() => {}} />);
    expect(el.querySelector('.m-sheet-title')!.textContent).toBe('Sign in to rutracker');
    expect(text()).toContain('Login');
    expect(text()).toContain('Password');
    expect(text()).toContain('sent only to rutracker');
    expect(buttons()).toEqual(['Cancel', 'Sign in']);
    expect(el.querySelector('#m-login-user')!.getAttribute('placeholder')).toBe('your login on rutracker');
    // the empty form
    act(() => (el.querySelector('button[type=submit]') as HTMLElement).click());
    expect(el.querySelector('[role=alert]')!.textContent).toBe('Enter the login and password');
    expect(el.innerHTML).not.toMatch(CYR);
  });

  it('TracksSheet', () => {
    const state = { audio: { list: [], sel: 0 }, subs: { list: [], sel: '' } } as unknown as PlayerState;
    mount(<TracksSheet state={state} onAudio={() => {}} onSubs={() => {}} onClose={() => {}} />);
    const titles = Array.from(el.querySelectorAll('.m-sheet-title')).map((n) => n.textContent);
    expect(titles).toEqual(['Audio', 'Subtitles']);
    expect(Array.from(el.querySelectorAll('.m-track-none')).map((n) => n.textContent)).toEqual(['No tracks', 'No tracks']);
    expect(el.innerHTML).not.toMatch(CYR);
  });

  it('TvChip', () => {
    reloadTvs();
    mount(<TvChip />);
    expect(labels()).toEqual(['Choose a TV']);
    saveTv({ ip: '10.0.0.5', name: 'Living room' });
    setActiveTv('10.0.0.5');
    mount(<TvChip />);
    expect(labels()).toEqual(['TV “Living room” is not connected']);
    reloadTvs();
  });

  it('useResultRows: the category sheet', () => {
    const r = { Title: 'Dune', Categories: '', Size: '41 GB', CreateDate: '', Tracker: '', Link: '', Magnet: '', Hash: '', Peer: 0, Seed: 12, source: 'fake' } as SourceResult;
    function Rows() {
      const rows = useResultRows();
      return (
        <div>
          {rows.card(r)}
          {rows.sheets}
        </div>
      );
    }
    mount(<Rows />);
    act(() => (el.querySelector('.m-chip') as HTMLElement).click());
    expect(el.querySelector('[role=dialog]')!.getAttribute('aria-label')).toBe('Category');
    expect(el.querySelector('.m-sheet-title')!.textContent).toBe('Category');
    expect(el.innerHTML).not.toMatch(CYR);
  });
});
