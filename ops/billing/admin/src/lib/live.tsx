import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

type LiveMode = 'live' | 'poll' | 'pause';

type LiveValue = {
  paused: boolean;
  setPaused: (v: boolean) => void;
  mode: LiveMode;
  at: number;
};

const LiveContext = createContext<LiveValue>({
  paused: false,
  setPaused: () => undefined,
  mode: 'poll',
  at: 0,
});

export function useLive() {
  return useContext(LiveContext);
}

/** SSE with backoff. While the stream is down, TanStack Query keeps polling. */
export function LiveProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [paused, setPaused] = useState(false);
  const [mode, setMode] = useState<LiveMode>('poll');
  const [at, setAt] = useState(0);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  useEffect(() => {
    if (paused) {
      setMode('pause');
      return;
    }
    let stop = false;
    let es: EventSource | null = null;
    let timer = 0;
    let wait = 1000;
    const bump = () => {
      setAt(Date.now());
      void qc.invalidateQueries();
      window.dispatchEvent(new Event('omp-admin-live'));
    };
    const arm = () => {
      if (stop) return;
      es = new EventSource('/admin/api/events');
      es.onopen = () => {
        wait = 1000;
        setMode('live');
        setAt(Date.now());
      };
      es.onmessage = () => {
        setMode('live');
        bump();
      };
      es.onerror = () => {
        if (es) es.close();
        setMode('poll');
        if (stop) return;
        timer = window.setTimeout(arm, wait);
        wait = Math.min(15000, wait * 2);
      };
    };
    arm();
    return () => {
      stop = true;
      if (es) es.close();
      window.clearTimeout(timer);
    };
  }, [paused, qc]);

  useEffect(() => {
    if (paused) return;
    const timer = window.setInterval(() => {
      if (modeRef.current !== 'live') window.dispatchEvent(new Event('omp-admin-live'));
    }, 12000);
    return () => window.clearInterval(timer);
  }, [paused]);

  return <LiveContext.Provider value={{ paused, setPaused, mode, at }}>{children}</LiveContext.Provider>;
}

export function LiveBar() {
  const { paused, setPaused, mode, at } = useLive();
  const label = mode === 'pause' ? 'пауза' : mode === 'live' ? 'в эфире' : 'опрос';
  const when = at ? new Date(at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '-';
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className={mode === 'live' ? 'text-primary' : ''}>{label}</span>
      <span className="font-mono">{when}</span>
      <button type="button" className="rounded-md border border-border px-2 py-1 text-foreground" onClick={() => setPaused(!paused)}>
        {paused ? 'Продолжить' : 'Пауза'}
      </button>
    </div>
  );
}
