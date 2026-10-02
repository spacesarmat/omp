export type KeyAction =
  | 'left' | 'right' | 'up' | 'down' | 'enter' | 'back'
  | 'play' | 'pause' | 'playpause' | 'stop' | 'ff' | 'rw' | 'next' | 'prev'
  | 'red' | 'green' | 'yellow' | 'blue' | 'info';

const MAP: { [code: number]: KeyAction } = {
  37: 'left', 38: 'up', 39: 'right', 40: 'down', 13: 'enter',
  461: 'back', 27: 'back', 8: 'back',
  415: 'play', 19: 'pause', 179: 'playpause', 10252: 'playpause', 32: 'playpause',
  413: 'stop', 417: 'ff', 412: 'rw', 33: 'next', 34: 'prev', 78: 'next', 80: 'prev',
  403: 'red', 404: 'green', 405: 'yellow', 406: 'blue',
  112: 'red', 113: 'green', 114: 'yellow', 115: 'blue',
  457: 'info', 73: 'info',
};

export function keyAction(e: { keyCode: number; key?: string }): KeyAction | null {
  return MAP[e.keyCode] || null;
}
