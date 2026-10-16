import { useEffect, useState } from 'preact/hooks';

const NEAR = '400px 0px';
const RETRIES = 2;

/**
 * Poster image that sets `src` only while the tile is near the viewport.
 * Android WebView's `loading="lazy"` stays blank after a screen is unmounted and its scroll is restored,
 * so the grey poster plate shows instead of the picture. Dropping `src` when the tile leaves also keeps
 * the decoded-image count down.
 */
export function LazyImg({ src, alt = '', onLoad, onError }: { src: string; alt?: string; onLoad?: () => void; onError?: () => void }) {
  const [el, setEl] = useState<HTMLImageElement | null>(null);
  const [near, setNear] = useState(typeof IntersectionObserver === 'undefined');
  const [attempt, setAttempt] = useState(0);
  const [hold, setHold] = useState(false);

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

  return (
    <img
      ref={setEl}
      alt={alt}
      src={near && !hold ? src : undefined}
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
