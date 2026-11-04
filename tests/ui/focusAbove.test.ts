import { describe, it, expect, afterEach } from 'vitest';
import { arrowUpToAbove, focusAboveKey, focusBelowKey, verticalTarget } from '../../src/ui/focus';

function place(parent: HTMLElement, key: string, x: number, y: number, w: number, h: number, cls?: string): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('data-fk', key);
  if (cls) el.className = cls;
  el.getBoundingClientRect = () => ({
    x: x, y: y, left: x, top: y, right: x + w, bottom: y + h, width: w, height: h, toJSON: () => ({}),
  }) as DOMRect;
  parent.appendChild(el);
  return el;
}

let screen: HTMLElement;

afterEach(() => {
  if (screen) screen.remove();
});

describe('focusAboveKey', () => {
  it('Up from the leftmost cast item reaches Watch when the poster sits between them', () => {
    screen = document.createElement('div');
    screen.className = 'screen';
    document.body.appendChild(screen);
    // Watch is in the flex hero, to the right of the poster. The first actor is under the poster.
    place(screen, 'torrent-play', 400, 200, 280, 64);
    place(screen, 'torrent-playlist', 700, 200, 220, 64);
    const cast = place(screen, 'torrent-cast-0', 80, 560, 180, 220);
    place(screen, 'torrent-cast-1', 284, 560, 180, 220);
    expect(focusAboveKey(cast)).toBe('torrent-play');
  });

  it('Up from a cast item that overlaps a later button lands on that button', () => {
    screen = document.createElement('div');
    screen.className = 'screen';
    document.body.appendChild(screen);
    place(screen, 'torrent-play', 400, 200, 220, 64);
    place(screen, 'torrent-playlist', 640, 200, 220, 64);
    const cast = place(screen, 'torrent-cast-1', 660, 560, 180, 220);
    expect(focusAboveKey(cast)).toBe('torrent-playlist');
  });

  it('a full-width skip row goes to the cast, and a full-width file row goes to skip', () => {
    screen = document.createElement('div');
    screen.className = 'screen';
    document.body.appendChild(screen);
    place(screen, 'torrent-play', 400, 200, 280, 64);
    place(screen, 'torrent-cast-0', 80, 560, 180, 220);
    place(screen, 'torrent-cast-1', 700, 560, 180, 220);
    const skip = place(screen, 'skip-intro', 80, 820, 1600, 62);
    const file = place(screen, 'file-1', 80, 920, 1600, 64);
    place(screen, 'file-2', 80, 1000, 1600, 64);
    // skip overlaps both actors; the closer row is the cast, and the actor nearest the row's centre wins
    expect(focusAboveKey(skip)).toBe('torrent-cast-1');
    expect(focusAboveKey(file)).toBe('skip-intro');
    expect(focusAboveKey(screen.querySelector('[data-fk="file-2"]'))).toBe('file-1');
  });

  it('Up from the first season chip reaches Watch when there is no cast, and the cast when there is', () => {
    screen = document.createElement('div');
    screen.className = 'screen';
    document.body.appendChild(screen);
    place(screen, 'series-watch', 400, 180, 280, 64);
    place(screen, 'series-releases', 700, 180, 240, 64);
    const chip = place(screen, 'season-1', 80, 640, 190, 80);
    expect(focusAboveKey(chip)).toBe('series-watch');
    const actor = place(screen, 'series-cast-0', 80, 480, 180, 140);
    expect(focusAboveKey(chip)).toBe('series-cast-0');
    expect(focusAboveKey(actor)).toBe('series-watch');
  });

  it('skips a disabled button and anything outside the screen', () => {
    screen = document.createElement('div');
    screen.className = 'screen';
    document.body.appendChild(screen);
    place(screen, 'torrent-play', 400, 200, 280, 64, 'disabled');
    place(screen, 'torrent-playlist', 700, 200, 220, 64);
    const outside = document.createElement('div');
    outside.setAttribute('data-fk', 'tab-all');
    outside.getBoundingClientRect = () => ({
      x: 0, y: 0, left: 0, top: 0, right: 200, bottom: 40, width: 200, height: 40, toJSON: () => ({}),
    }) as DOMRect;
    document.body.appendChild(outside);
    const cast = place(screen, 'torrent-cast-0', 80, 560, 180, 220);
    expect(focusAboveKey(cast)).toBe('torrent-playlist');
    outside.remove();
  });

  it('Up from the cast reaches the wrapped second button row, even when that row overlaps the cast', () => {
    screen = document.createElement('div');
    screen.className = 'screen';
    document.body.appendChild(screen);
    place(screen, 'torrent-play', 400, 200, 280, 64);
    place(screen, 'torrent-delete', 400, 500, 200, 64);
    const cast = place(screen, 'torrent-cast-0', 80, 540, 180, 220);
    // delete bottom 564 is below the cast top 540, but its centre is still above the cast
    expect(focusAboveKey(cast)).toBe('torrent-delete');
    const fifth = place(screen, 'torrent-cast-4', 900, 540, 180, 220);
    // the wrapped row is the nearest one above, for the first actor and for one further along
    expect(focusAboveKey(fifth)).toBe('torrent-delete');
  });

  it('Down from Continue reaches the second button row, then the cast', () => {
    screen = document.createElement('div');
    screen.className = 'screen';
    document.body.appendChild(screen);
    const play = place(screen, 'torrent-play', 400, 200, 280, 64);
    const del = place(screen, 'torrent-delete', 400, 280, 200, 64);
    const cast = place(screen, 'torrent-cast-0', 80, 560, 180, 220);
    place(screen, 'file-1', 80, 900, 1600, 64);
    expect(focusBelowKey(play)).toBe('torrent-delete');
    expect(focusBelowKey(del)).toBe('torrent-cast-0');
    expect(focusBelowKey(cast)).toBe('file-1');
  });

  it('Up from a cast item whose box is empty still reaches the last action button', () => {
    screen = document.createElement('div');
    screen.className = 'screen';
    document.body.appendChild(screen);
    const actions = document.createElement('div');
    actions.className = 'torrent-actions';
    screen.appendChild(actions);
    place(actions, 'torrent-play', 80, 40, 220, 64);
    place(actions, 'torrent-delete', 320, 120, 180, 64);
    const row = document.createElement('div');
    row.className = 'tc-cast-row';
    screen.appendChild(row);
    const cast = place(row, 'torrent-cast-0', 0, 0, 0, 0);
    // a scrolled posterless card: the WebView reports no box, so rectangles find nothing
    expect(verticalTarget(cast, 'up')).toBe('torrent-delete');
  });

  it('Up from the cast reaches the last button when every wrapped row covers the cast', () => {
    screen = document.createElement('div');
    screen.className = 'screen';
    document.body.appendChild(screen);
    const actions = document.createElement('div');
    actions.className = 'torrent-actions';
    screen.appendChild(actions);
    place(actions, 'torrent-play', 80, 360, 220, 200);
    place(actions, 'torrent-poster', 320, 360, 180, 200);
    const row = document.createElement('div');
    row.className = 'tc-cast-row';
    screen.appendChild(row);
    const cast = place(row, 'torrent-cast-0', 80, 400, 180, 220);
    expect(focusAboveKey(cast)).toBeNull();
    expect(verticalTarget(cast, 'up')).toBe('torrent-poster');
  });

  it('leaves other directions to the library', () => {
    const go = arrowUpToAbove('torrent-cast-0');
    expect(go('down')).toBe(true);
    expect(go('left')).toBe(true);
    expect(go('right')).toBe(true);
  });
});
