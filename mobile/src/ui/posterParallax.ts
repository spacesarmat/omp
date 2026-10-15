// Tilt math for the «Сейчас играет» poster: the card rotates, the art shifts the other way.

export const PARALLAX_MAX_X = 9;
export const PARALLAX_MAX_Y = 12;
const SHIFT_PCT = 5;

export interface Tilt {
  rx: number;
  ry: number;
}

export interface ParallaxShift {
  x: number;
  y: number;
  gx: number;
  gy: number;
  sx: number;
  sy: number;
}

function clamp(n: number, max: number): number {
  return Math.max(-max, Math.min(max, n));
}

/** Gyro deltas from the pose when the screen opened. Positive ry: phone tilted right. */
export function gyroTilt(beta: number, gamma: number, baseBeta: number, baseGamma: number): Tilt {
  return {
    rx: clamp((beta - baseBeta) * 0.4, PARALLAX_MAX_X),
    ry: clamp((gamma - baseGamma) * 0.5, PARALLAX_MAX_Y),
  };
}

/** Pointer over the poster. px/py are -0.5..0.5 from the centre (py grows downward). */
export function pointerTilt(px: number, py: number): Tilt {
  return {
    rx: clamp(-py * 2 * PARALLAX_MAX_X, PARALLAX_MAX_X),
    ry: clamp(px * 2 * PARALLAX_MAX_Y, PARALLAX_MAX_Y),
  };
}

/** Art and glare move against the tilt so the picture reads as a layer inside the card. */
export function parallaxShift(t: Tilt): ParallaxShift {
  return {
    x: (-t.ry / PARALLAX_MAX_Y) * SHIFT_PCT,
    y: (t.rx / PARALLAX_MAX_X) * SHIFT_PCT,
    gx: 50 + (t.ry / PARALLAX_MAX_Y) * 35,
    gy: 42 - (t.rx / PARALLAX_MAX_X) * 30,
    sx: -t.ry * 1.4,
    sy: t.rx * 1.2,
  };
}

export function lerpTilt(cur: Tilt, target: Tilt, k: number): Tilt {
  return {
    rx: cur.rx + (target.rx - cur.rx) * k,
    ry: cur.ry + (target.ry - cur.ry) * k,
  };
}
