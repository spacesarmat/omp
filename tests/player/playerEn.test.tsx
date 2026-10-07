import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { init } from '@noriginmedia/norigin-spatial-navigation';
import { applyLanguageSetting } from '../../src/i18n';
import { Controls } from '../../src/player/Controls';
import { DonateCard } from '../../src/player/DonateCard';
import { StatsOverlay, BufferingOverlay, NextBanner, SkipBanner, UndoBanner, PlayerError } from '../../src/player/Overlays';
import { applyMark, chapterLabel } from '../../src/player/chapters';
import { playerEngineOptions, vlcUnavailable, engineLogText } from '../../src/player/nativeEngine';
import { statsLines } from '../../src/player/stats';
import { formatOffset, subSizeOptions } from '../../src/player/subtitleOffset';
import { subtitleMenu } from '../../src/player/trackOptions';
import { mediaErrorText } from '../../src/player/useVideoState';

const CYR = /[А-Яа-яЁё]/;
let root: HTMLElement;

function text(vnode: any): string {
  act(() => { render(vnode, root); });
  return root.textContent || '';
}

beforeAll(() => {
  init({ debug: false, visualDebug: false });
  if (!(Element.prototype as any).scrollIntoView) (Element.prototype as any).scrollIntoView = () => undefined;
});
beforeEach(() => {
  applyLanguageSetting('en');
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  act(() => { render(null, root); });
  root.remove();
  applyLanguageSetting('ru');
});

const noop = () => {};

describe('player in English', () => {
  it('controls bar', () => {
    const base = { title: 'Film', time: 10, duration: 100, paused: false, seekTarget: null, hasPrev: false, hasNext: false, onToggle: noop, onSeekTo: noop, onPrev: noop, onNext: noop, onTracks: noop, chapters: [{ start: 0, end: 50, title: 'Intro', kind: null as null }], chapterIdx: 0, onChapters: noop };
    const s = text(<Controls {...base} />);
    expect(s).toContain('Menu');
    expect(s).toContain('Chapters');
    expect(s).toContain('Chapter 1 “Intro”');
    expect(s).toContain('Audio');
    expect(s).toContain('Subtitles');
    expect(s).toContain('Stats');
    expect(s).toContain('CH± — chapters');
    expect(CYR.test(s)).toBe(false);
    const e = text(<Controls {...base} chapters={[]} chapterIdx={-1} />);
    expect(e).toContain('CH± — episodes');
    expect(CYR.test(e)).toBe(false);
  });

  it('banners, stats and errors', () => {
    const all = [
      text(<NextBanner seconds={5} title="S01E02" onNext={noop} />),
      text(<SkipBanner onSkip={noop} />),
      text(<UndoBanner text="Intro skipped" onUndo={noop} />),
      text(<StatsOverlay cache={null} probe={null} />),
      text(<BufferingOverlay cache={null} />),
      text(<PlayerError message="x" probe={null} onRetry={noop} onBack={noop} />),
    ];
    expect(all[0]).toContain('Next episode in 5 s');
    expect(all[1]).toContain('Skip intro');
    expect(all[2]).toBe('Intro skipped · UndoOK — undo');
    expect(all[3]).toBe('No data');
    expect(all[4]).toContain('Buffering…');
    expect(all[5]).toContain('Retry');
    expect(all[5]).toContain('Back');
    expect(CYR.test(all.join(' '))).toBe(false);
  });

  it('donate card', () => {
    const pause = text(<DonateCard mode="pause" />);
    expect(pause).toContain('Like OMP?');
    expect(CYR.test(pause)).toBe(false);
    expect(root.innerHTML).toContain('QR code of the Boosty link');
    const credits = text(<DonateCard mode="credits" />);
    expect(credits).toContain('Finished? Thank you!');
    expect(CYR.test(credits)).toBe(false);
  });

  it('marks, menus, engines, stats lines and errors', () => {
    const fmt = (s: number) => 'T' + s;
    const strings: string[] = [];
    const push = (s: string) => { strings.push(s); return s; };
    expect(push(applyMark('intro-start', 45, 2900, null, null, fmt).text)).toBe('Intro start T45 · now mark the end');
    expect(push(applyMark('intro-end', 30, 2900, null, null, fmt).text)).toBe('Mark the intro start first');
    expect(push(applyMark('credits', 2800, 2900, null, null, fmt).text)).toBe('Marked: credits from T2800');
    expect(push(applyMark('credits', 10, 0, null, null, fmt).text)).toBe('Could not mark the credits');
    expect(push(chapterLabel({ title: ' ' }, 1))).toBe('Chapter 2');
    expect(push(formatOffset(0.5))).toBe('+0.5 s (later)');
    expect(push(formatOffset(-2))).toBe('−2.0 s (earlier)');
    expect(subSizeOptions().map((o) => push(o.label))).toEqual(['Small', 'Medium', 'Large']);
    expect(subtitleMenu([], [{ url: 'u', label: 'rus', ext: 'srt' }]).map((o) => push(o.label))).toEqual(['Off', 'rus (file)']);
    expect(playerEngineOptions().map((o) => push(o.name + o.text)).length).toBe(3);
    expect(playerEngineOptions()[0].name).toBe('Auto');
    expect(push(vlcUnavailable())).toBe('VLC is not available on this device');
    expect(push(engineLogText({ index: 0, engine: 'vlc', reason: 'ass' }) || '')).toBe('player: switching to VLC (ASS subtitles)');
    const lines = statsLines({ Capacity: 100, Filled: 50, PiecesLength: 1, PiecesCount: 1, Torrent: { download_speed: 1048576, active_peers: 3, total_peers: 7, connected_seeders: 2 } } as any, null);
    expect(lines[0]).toBe('Speed: 1.0 MB/s');
    expect(lines[1]).toBe('Peers: 3 / 7 (seeds 2)');
    strings.push(...lines);
    expect(push(mediaErrorText(null))).toBe('Unknown playback error');
    expect(push(mediaErrorText({ code: 4 } as MediaError))).toBe('The TV does not support this format or codec');
    expect(strings.filter((s) => CYR.test(s))).toEqual([]);
  });
});
