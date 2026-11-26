import { useEffect, useState } from 'preact/hooks';
import { canCache, imageSrc, loadImage } from '../../../src/lib/imageCache';

const NEAR = '400px 0px';
const RETRIES = 2;
/** A cache request that has not answered by now is given up on: the poster shows through its own address. */
const WAIT_MS = 5000;

/**
 * Poster image that sets `src` only while the tile is near the viewport.
 * Android WebView's `loading="lazy"` stays blank after a screen is unmounted and its scroll is restored,
 * so the grey poster plate shows instead of the picture. Dropping `src` when the tile leaves also keeps
 * the decoded-image count down.
 *
 * The bytes come from the poster cache, so scrolling back does not touch the network again. When the cache
 * does not hold the picture yet, the address stays empty until the fetch settles: the browser would otherwise
 * download the same poster twice, once through the `img` and once through the cache. Hosts that reject
 * cross-origin reads settle at once to the plain URL, which keeps the old behaviour for them.
 */
export function LazyImg({ src, alt = '', onLoad, onError }: { src: string; alt?: string; onLoad?: () => void; onError?: () => void }) {
  const [el, setEl] = useState<HTMLImageElement | null>(null);
  const [near, setNear] = useState(typeof IntersectionObserver === 'undefined');
  const [attempt, setAttempt] = useState(0);
  const [hold, setHold] = useState(false);
  const [url, setUrl] = useState('');

  useEffect(() => {
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver((entries) => {
      for (let i = 0; i < entries.length; i++) setNear(entries[i].isIntersecting);
    }, { root: null, rootMargin: NEAR, threshold: 0.01 });
    io.observe(el);
    return () => io.disconnect();
  }, [el]);

  useEffect(() => {
    if (!hold) return;
    const t = setTimeout(() => setHold(false), 0);
    return () => clearTimeout(t);
  }, [hold]);

  useEffect(() => {
    if (!near || !src || hold) {
      if (!near || !src) setUrl('');
      return;
    }
    const held = imageSrc(src);
    if (held !== src) {
      setUrl(held);
      return;
    }
    // no object URLs (an old engine) or a host that already refused a read: show the poster the old way
    if (!canCache(src)) {
      setUrl(src);
      return;
    }
    let live = true;
    // a request that never answers must not keep the tile blank; once the cache has answered the fallback is off
    let timer: ReturnType<typeof setTimeout> | undefined;
    timer = setTimeout(() => {
      timer = undefined;
      if (live) setUrl(src);
    }, WAIT_MS);
    const stop = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    };
    loadImage(src).then(
      (out) => {
        stop();
        if (live) setUrl(out);
      },
      () => {
        stop();
        if (live) setUrl(src);
      },
    );
    return () => {
      live = false;
      stop();
    };
  }, [near, src, hold]);

  return (
    <img
      ref={setEl}
      alt={alt}
      src={near && !hold && url ? url : undefined}
      onLoad={() => onLoad?.()}
      onError={() => {
        if (attempt >= RETRIES) {
          onError?.();
          return;
        }
        setAttempt(attempt + 1);
        setHold(true);
      }}
    />
  );
}
