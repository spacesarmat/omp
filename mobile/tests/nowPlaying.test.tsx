import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { NowPlaying } from '../src/screens/NowPlaying';
import { MiniPlayer } from '../src/ui/MiniPlayer';
import { App } from '../src/app';
import { currentRoute, resetTo, navigate } from '../src/nav';
import { nowPlaying, lastSeen, launchedAt, setPlayerLinkDeps } from '../src/tv/playerLink';
import { reloadTvs, saveTv } from '../src/tv/tvStore';
import type { PlayerState } from '../../src/phone/protocol';

let el: HTMLElement;
const NOW = 100000;
const queue = vi.fn();
const volume = vi.fn();
const fgApp = vi.fn();

const state = (o: Partial<PlayerState> = {}): PlayerState => ({
  hash: 'h',
  file: 1,
  title: 'Тишина в эфире',
  subtitle: 'Starbound Frontier · S02E03',
  time: 1394,
  duration: 2912,
  paused: false,
  buffering: false,
  audio: { list: ['Русский', 'English'], sel: 0 },
  subs: {
    list: [
      { label: 'Выключены', value: 'off' },
      { label: 'Русские', value: 'ru' },
    ],
    sel: 'ru',
  },
  next: { title: 'S02E04 · Граница' },
  ...o,
});
const setState = (s: PlayerState | null, seenAgo = 0) => {
  nowPlaying.value = s;
  lastSeen.value = NOW - seenAgo;
};
const mount = (ui: any) => {
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
  act(() => render(ui, el));
};
const lbl = (l: string) => el.querySelector(`[aria-label="${l}"]`) as HTMLElement;
const click = (n: Element) => act(() => (n as HTMLElement).click());
const byText = (t: string) => Array.from(el.querySelectorAll('button')).find((b) => (b.textContent || '').includes(t))!;
const sent = () => queue.mock.calls.map((c) => c[0][0]);

beforeEach(() => {
  localStorage.clear();
  reloadTvs();
  saveTv({ ip: '192.168.1.5', name: 'LG OLED' });
  queue.mockReset().mockResolvedValue(undefined);
  volume.mockReset().mockResolvedValue(undefined);
  fgApp.mockReset().mockResolvedValue(null);
  setPlayerLinkDeps({
    now: () => NOW,
    foregroundAppId: fgApp,
    tvFailed: () => false,
    native: { startPlayerServer: vi.fn(), queuePlayerCommands: queue, onPlayerMessage: () => () => {} } as any,
  });
  resetTo({ name: 'library' });
  navigate({ name: 'nowPlaying' });
});
afterEach(() => {
  setPlayerLinkDeps(null);
  document.body.innerHTML = '';
});

describe('NowPlaying', () => {
  it('renders title, subtitle, times and the TV name', () => {
    setState(state());
    mount(<NowPlaying volume={volume} />);
    expect(el.textContent).toContain('Тишина в эфире');
    expect(el.textContent).toContain('Starbound Frontier · S02E03');
    expect(el.textContent).toContain('23:14');
    expect(el.textContent).toContain('−25:18');
    expect(el.textContent).toContain('СЕЙЧАС НА ТВ');
    expect(el.textContent).toContain('LG OLED');
    expect(el.textContent).toContain('Дальше: S02E04 · Граница');
  });

  it('shows «Телевизор не отвечает» when stale', () => {
    setState(state(), 6000);
    mount(<NowPlaying volume={volume} />);
    expect(el.textContent).toContain('Телевизор не отвечает');
  });

  it('stale: controls are disabled and send nothing', () => {
    setState(state(), 6000);
    mount(<NowPlaying volume={volume} />);
    for (const l of ['Назад на 10 секунд', 'Вперёд на 10 секунд', 'Пауза', 'Предыдущая серия', 'Следующая серия']) {
      expect((lbl(l) as HTMLButtonElement).disabled).toBe(true);
    }
    expect((el.querySelector('input[type="range"]') as HTMLInputElement).disabled).toBe(true);
    expect((byText('Звук и субтитры') as HTMLButtonElement).disabled).toBe(true);
    expect((byText('Включить') as HTMLButtonElement).disabled).toBe(true);
    click(lbl('Пауза'));
    expect(queue).not.toHaveBeenCalled();
  });

  it('«Следующая серия» is disabled without a next episode, «Предыдущая» stays enabled', () => {
    setState(state({ next: null }));
    mount(<NowPlaying volume={volume} />);
    expect((lbl('Следующая серия') as HTMLButtonElement).disabled).toBe(true);
    expect((lbl('Предыдущая серия') as HTMLButtonElement).disabled).toBe(false);
  });

  it('right after a launch shows «Запускаем на телевизоре…» instead of the empty state', () => {
    setState(null);
    launchedAt.value = NOW - 2000;
    mount(<NowPlaying volume={volume} />);
    expect(el.textContent).toContain('Запускаем на телевизоре…');
    expect(el.textContent).not.toContain('На телевизоре ничего не играет');
    act(() => {
      launchedAt.value = NOW - 16000;
    });
    expect(el.textContent).toContain('На телевизоре ничего не играет');
  });

  it('empty state offers the catalog', () => {
    setState(null);
    mount(<NowPlaying volume={volume} />);
    expect(el.textContent).toContain('На телевизоре ничего не играет');
    click(byText('Открыть каталог'));
    expect(currentRoute.value.name).toBe('library');
  });

  it('collapse goes back, remote button opens the remote', () => {
    setState(state());
    mount(<NowPlaying volume={volume} />);
    click(lbl('Пульт'));
    expect(currentRoute.value.name).toBe('remote');
    resetTo({ name: 'library' });
    navigate({ name: 'nowPlaying' });
    click(lbl('Свернуть'));
    expect(currentRoute.value.name).toBe('library');
  });

  it('seeks on release only', () => {
    setState(state());
    mount(<NowPlaying volume={volume} />);
    const r = el.querySelector('input[type="range"]') as HTMLInputElement;
    act(() => {
      r.value = '600';
      r.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(queue).not.toHaveBeenCalled();
    expect(el.textContent).toContain('10:00');
    act(() => {
      r.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(sent()).toEqual([expect.objectContaining({ type: 'seek', t: 600 })]);
  });

  it('holds the released seek target until the TV reports near it or 1.5 s pass', () => {
    vi.useFakeTimers();
    try {
      setState(state());
      mount(<NowPlaying volume={volume} />);
      const r = el.querySelector('input[type="range"]') as HTMLInputElement;
      act(() => {
        r.value = '2000';
        r.dispatchEvent(new Event('input', { bubbles: true }));
      });
      act(() => {
        r.dispatchEvent(new Event('change', { bubbles: true }));
      });
      expect(el.textContent).toContain('33:20');
      // stale report from before the seek
      act(() => {
        nowPlaying.value = state({ time: 1400 });
        lastSeen.value = NOW + 500;
      });
      expect(el.textContent).toContain('33:20');
      // report near the target releases the hold
      act(() => {
        nowPlaying.value = state({ time: 2001 });
        lastSeen.value = NOW + 1000;
      });
      expect(el.textContent).toContain('33:21');
      // timeout path
      act(() => {
        r.value = '100';
        r.dispatchEvent(new Event('input', { bubbles: true }));
      });
      act(() => {
        r.dispatchEvent(new Event('change', { bubbles: true }));
      });
      act(() => {
        nowPlaying.value = state({ time: 1400 });
      });
      expect(el.textContent).toContain('1:40');
      act(() => {
        vi.advanceTimersByTime(1600);
      });
      expect(el.textContent).toContain('23:20');
    } finally {
      vi.useRealTimers();
    }
  });

  it('disables the seek bar without a duration', () => {
    setState(state({ duration: 0 }));
    mount(<NowPlaying volume={volume} />);
    expect((el.querySelector('input[type="range"]') as HTMLInputElement).disabled).toBe(true);
  });

  it('transport buttons send the right commands', () => {
    setState(state());
    mount(<NowPlaying volume={volume} />);
    click(lbl('Назад на 10 секунд'));
    click(lbl('Вперёд на 10 секунд'));
    click(lbl('Пауза'));
    click(lbl('Предыдущая серия'));
    click(lbl('Следующая серия'));
    click(byText('Включить'));
    expect(sent().map((c) => [c.type, c.d])).toEqual([
      ['skip', -10],
      ['skip', 10],
      ['pause', undefined],
      ['prev', undefined],
      ['next', undefined],
      ['next', undefined],
    ]);
  });

  it('shows play when paused', () => {
    setState(state({ paused: true }));
    mount(<NowPlaying volume={volume} />);
    click(lbl('Играть'));
    expect(sent()[0].type).toBe('play');
  });

  it('volume buttons call volume', () => {
    setState(state());
    mount(<NowPlaying volume={volume} />);
    click(lbl('Громкость меньше'));
    click(lbl('Громкость больше'));
    expect(volume.mock.calls.map((c) => c[0])).toEqual(['down', 'up']);
  });

  it('tracks sheet sends audio and subs commands and closes', () => {
    setState(state());
    mount(<NowPlaying volume={volume} />);
    click(byText('Звук и субтитры'));
    expect(el.querySelector('[role="dialog"]')).not.toBeNull();
    click(byText('English'));
    expect(sent()[0]).toMatchObject({ type: 'audio', i: 1 });
    expect(el.querySelector('[role="dialog"]')).toBeNull();
    click(byText('Звук и субтитры'));
    click(byText('Выключены'));
    expect(sent()[1]).toMatchObject({ type: 'subs', value: 'off' });
    expect(el.querySelector('[role="dialog"]')).toBeNull();
  });

  it('tracks sheet says «Нет дорожек» under an empty heading', () => {
    setState(state({ audio: { list: [], sel: 0 }, subs: { list: [], sel: '' } }));
    mount(<NowPlaying volume={volume} />);
    click(byText('Звук и субтитры'));
    expect(el.querySelectorAll('.m-track-none').length).toBe(2);
    expect(el.textContent).toContain('Нет дорожек');
  });

  it('marks the current track', () => {
    setState(state());
    mount(<NowPlaying volume={volume} />);
    click(byText('Звук и субтитры'));
    const on = Array.from(el.querySelectorAll('.m-track.on')).map((n) => n.textContent);
    expect(on).toEqual(['Русский', 'Русские']);
  });
});

describe('MiniPlayer', () => {
  it('shows the line, the TV and progress; text opens nowPlaying', () => {
    setState(state());
    resetTo({ name: 'library' });
    mount(<MiniPlayer />);
    expect(el.textContent).toContain('S02E03 · Тишина в эфире');
    expect(el.textContent).toContain('На LG OLED · 23:14 из 48:32');
    click(el.querySelector('.m-mini-text')!);
    expect(currentRoute.value.name).toBe('nowPlaying');
  });

  it('back and pause send commands', () => {
    setState(state());
    mount(<MiniPlayer />);
    click(lbl('Назад на 10 секунд'));
    click(lbl('Пауза'));
    expect(sent().map((c) => c.type)).toEqual(['skip', 'pause']);
  });

  it('stale: says «Телевизор не отвечает» and disables the buttons', () => {
    setState(state(), 6000);
    mount(<MiniPlayer />);
    expect(el.querySelector('.m-mini-sub.warn')!.textContent).toBe('Телевизор не отвечает');
    expect(el.textContent).not.toContain('На LG OLED');
    expect((lbl('Назад на 10 секунд') as HTMLButtonElement).disabled).toBe(true);
    expect((lbl('Пауза') as HTMLButtonElement).disabled).toBe(true);
  });

  it('stays hidden while launching', () => {
    setState(null);
    launchedAt.value = NOW - 1000;
    mount(<MiniPlayer />);
    expect(el.querySelector('.m-mini')).toBeNull();
  });

  it('renders nothing without a link', () => {
    setState(null);
    mount(<MiniPlayer />);
    expect(el.querySelector('.m-mini')).toBeNull();
  });
});

describe('mini-player in the shell', () => {
  it('shows on tab screens only', () => {
    setState(state());
    resetTo({ name: 'library' });
    mount(<App />);
    expect(el.querySelector('.m-mini')).not.toBeNull();
    act(() => navigate({ name: 'nowPlaying' }));
    expect(el.querySelector('.m-mini')).toBeNull();
    expect(el.querySelector('.m-now')).not.toBeNull();
    act(() => navigate({ name: 'torrent', hash: 'x' }));
    expect(el.querySelector('.m-mini')).toBeNull();
  });

  it('cold start with a TV tries to attach once', async () => {
    setState(null);
    resetTo({ name: 'library' });
    mount(<App />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(fgApp).toHaveBeenCalledTimes(1);
  });

  it('cold start skips the attach while the link is live', async () => {
    setState(state());
    resetTo({ name: 'library' });
    mount(<App />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(fgApp).not.toHaveBeenCalled();
  });

  it('hidden when the link is gone', () => {
    setState(state(), 31000);
    resetTo({ name: 'library' });
    mount(<App />);
    expect(el.querySelector('.m-mini')).toBeNull();
  });
});

describe('long file-name title', () => {
  it('shows the cleaned title', () => {
    setState(state({ title: 'Trudno.byt.bogom.S01.E07.2026.WEB-DL.1080p.ExKinoRay.mkv' }));
    mount(<NowPlaying volume={volume} />);
    expect(el.querySelector('.m-now-title')!.textContent).toBe('Trudno byt bogom S01 E07 2026 WEB-DL 1080p ExKinoRay');
  });
});
