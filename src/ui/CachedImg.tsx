import { useEffect, useState } from 'preact/hooks';
import { imageSrc, loadImage } from '../lib/imageCache';

/**
 * A picture that goes through the poster cache: the address is shown at once (the plain URL, so nothing waits for
 * us) and swapped for the cached copy when it lands. `decoding="async"` keeps the decoder off the frame the tile
 * appears in, and the given box stops the layout from jumping when the bytes arrive.
 */
export function CachedImg(p: { src: string; alt?: string; w?: number; h?: number; class?: string; onError?: () => void }) {
  const [url, setUrl] = useState(() => imageSrc(p.src));
  useEffect(() => {
    let live = true;
    setUrl(imageSrc(p.src));
    if (!p.src) return;
    loadImage(p.src).then((out) => {
      if (live && out !== p.src) setUrl(out);
    });
    return () => {
      live = false;
    };
  }, [p.src]);
  return <img src={url} alt={p.alt || ''} class={p.class} decoding="async" width={p.w} height={p.h} onError={p.onError} />;
}
