// «Сейчас играет» poster: a 3D card. Gyro (from the pose at open) and a finger over the poster tilt it;
// the picture shifts the other way. prefers-reduced-motion leaves it flat.
import { useEffect, useRef } from 'preact/hooks';
import type { PlayerState } from '../../../src/phone/protocol';
import { hasPosterImage, playerPosterStyle } from './playerPoster';
import { gyroTilt, lerpTilt, parallaxShift, pointerTilt, type Tilt } from './posterParallax';
import { prefersReducedMotion } from './usePinchStep';

function applyTilt(card: HTMLElement, t: Tilt): void {
  const s = parallaxShift(t);
  card.style.setProperty('--rx', t.rx.toFixed(2) + 'deg');
  card.style.setProperty('--ry', t.ry.toFixed(2) + 'deg');
  card.style.setProperty('--px', s.x.toFixed(2) + '%');
  card.style.setProperty('--py', s.y.toFixed(2) + '%');
  card.style.setProperty('--gx', s.gx.toFixed(1) + '%');
  card.style.setProperty('--gy', s.gy.toFixed(1) + '%');
  card.style.setProperty('--sx', s.sx.toFixed(1));
  card.style.setProperty('--sy', s.sy.toFixed(1));
}

function usePosterParallax(stageRef: { current: HTMLDivElement | null }, cardRef: { current: HTMLDivElement | null }): void {
  useEffect(() => {
    const stage = stageRef.current;
    const card = cardRef.current;
    if (!stage || !card || prefersReducedMotion()) return;
    let base: { beta: number; gamma: number } | null = null;
    let gyro: Tilt | null = null;
    let pointer: Tilt | null = null;
    let cur: Tilt = { rx: 0, ry: 0 };
    let raf = 0;
    let running = false;
    const tick = () => {
      const target = pointer || gyro || { rx: 0, ry: 0 };
      cur = lerpTilt(cur, target, 0.16);
      applyTilt(card, cur);
      const moving = Math.abs(target.rx - cur.rx) > 0.05 || Math.abs(target.ry - cur.ry) > 0.05;
      if (moving) raf = requestAnimationFrame(tick);
      else running = false;
    };
    const kick = () => {
      if (running) return;
      running = true;
      raf = requestAnimationFrame(tick);
    };
    const onOrient = (e: DeviceOrientationEvent) => {
      if (e.beta == null || e.gamma == null) return;
      if (!base) base = { beta: e.beta, gamma: e.gamma };
      gyro = gyroTilt(e.beta, e.gamma, base.beta, base.gamma);
      kick();
    };
    const onMove = (e: PointerEvent) => {
      const r = stage.getBoundingClientRect();
      if (!r.width || !r.height) return;
      pointer = pointerTilt((e.clientX - r.left) / r.width - 0.5, (e.clientY - r.top) / r.height - 0.5);
      kick();
    };
    const onLeave = () => {
      pointer = null;
      kick();
    };
    let asked = false;
    const ask = () => {
      if (asked) return;
      asked = true;
      const D = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
      if (typeof D.requestPermission === 'function') void D.requestPermission().catch(() => {});
    };
    window.addEventListener('deviceorientation', onOrient);
    stage.addEventListener('pointerdown', ask);
    stage.addEventListener('pointermove', onMove);
    stage.addEventListener('pointerleave', onLeave);
    stage.addEventListener('pointercancel', onLeave);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('deviceorientation', onOrient);
      stage.removeEventListener('pointerdown', ask);
      stage.removeEventListener('pointermove', onMove);
      stage.removeEventListener('pointerleave', onLeave);
      stage.removeEventListener('pointercancel', onLeave);
    };
  }, [stageRef, cardRef]);
}

/** Poster card of «Сейчас играет». `title` shows only when there is no image. */
export function NowPoster({ state, title }: { state: PlayerState; title: string }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  usePosterParallax(stageRef, cardRef);
  const image = hasPosterImage(state);
  return (
    <div class="m-now-stage" ref={stageRef}>
      <div class="m-now-poster" ref={cardRef} style={image ? undefined : playerPosterStyle(state)}>
        {image && <div class="m-now-poster-art" style={playerPosterStyle(state)} />}
        <div class="m-now-poster-glare" aria-hidden="true" />
        {!image && <span class="m-now-poster-title">{title}</span>}
      </div>
    </div>
  );
}
