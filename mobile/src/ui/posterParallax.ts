// Tilt math for the «Сейчас играет» poster: three depth layers + glare/shadow.

export const PARALLAX_MAX_X = 9;
export const PARALLAX_MAX_Y = 12;

/** Relative shift amplitudes (% of the stage). Farther layers move more. */
export const LAYER_SHIFT = {
  back: { x: 9, y: 10 },
  mid: { x: 5, y: 5.5 },
  front: { x: 2.2, y: 2.5 },
} as const;

export interface Tilt {
  rx: number;
  ry: number;
}

export interface LayerOffset {
  x: number;
  y: number;
}

export interface PosterMotion {
  back: LayerOffset;
  mid: LayerOffset;
  front: LayerOffset;
  gx: number;
  gy: number;
  sx: number;
  sy: number;
}

/** @deprecated Prefer posterMotion; kept for mid-layer glare callers/tests. */
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

function offset(nx: number, ny: number, amp: { x: number; y: number }): LayerOffset {
  return { x: nx * amp.x, y: ny * amp.y };
}

/** Back / mid / front layer shifts + glare hotspot and drop-shadow lean. */
export function posterMotion(t: Tilt): PosterMotion {
  const nx = -t.ry / PARALLAX_MAX_Y;
  const ny = t.rx / PARALLAX_MAX_X;
  return {
    back: offset(nx, ny, LAYER_SHIFT.back),
    mid: offset(nx, ny, LAYER_SHIFT.mid),
    front: offset(nx, ny, LAYER_SHIFT.front),
    gx: 50 + (t.ry / PARALLAX_MAX_Y) * 35,
    gy: 42 - (t.rx / PARALLAX_MAX_X) * 30,
    sx: -t.ry * 1.4,
    sy: t.rx * 1.2,
  };
}

/** Mid-layer shift (compat). */
export function parallaxShift(t: Tilt): ParallaxShift {
  const m = posterMotion(t);
  return { x: m.mid.x, y: m.mid.y, gx: m.gx, gy: m.gy, sx: m.sx, sy: m.sy };
}

export function lerpTilt(cur: Tilt, target: Tilt, k: number): Tilt {
  return {
    rx: cur.rx + (target.rx - cur.rx) * k,
    ry: cur.ry + (target.ry - cur.ry) * k,
  };
}
