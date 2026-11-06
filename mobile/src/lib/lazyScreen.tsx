import { useEffect, useState } from 'preact/hooks';
import type { ComponentType, VNode } from 'preact';

/**
 * A tiny Preact wrapper around a dynamic import of a screen component.
 * The first render returns null while the chunk loads; subsequent renders use the loaded component.
 */
export function lazyScreen(
  loader: () => Promise<Record<string, any>>,
  exportName: string,
): ComponentType<any> {
  return function LazyScreen(props: Record<string, any>): VNode | null {
    const [Screen, setScreen] = useState<ComponentType<any> | null>(null);
    const [failed, setFailed] = useState(false);
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
      let alive = true;
      void loader()
        .then((m) => {
          const Comp = m[exportName] as ComponentType<any> | undefined;
          if (alive && Comp) setScreen(() => Comp);
        })
        .catch(() => {
          if (alive) setFailed(true);
        });
      return () => {
        alive = false;
      };
    }, [attempt]);

    if (failed) {
      return (
        <div class="lazy-error" role="alert">
          <span>Не удалось открыть экран</span>
          <button onClick={() => {
            setScreen(null);
            setFailed(false);
            setAttempt((n) => n + 1);
          }}>Повторить</button>
        </div>
      );
    }
    if (!Screen) return null;
    return <Screen {...props} />;
  };
}
