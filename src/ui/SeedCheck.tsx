// A manual «Проверить сиды» next to a tracker seed count. The «Актуальные сиды» setting does not gate it.
import { useRef, useState } from 'preact/hooks';
import { t, tp } from '../i18n';
import { probeSeeds, type ProbeResult } from '../sources/liveSeedsRun';
import type { SourceResult } from '../sources/types';
import { Focusable } from './components';

export function liveSeedLine(seeders: number, leechers: number): string {
  return tp('sources.seeds', seeders) + ' · ' + tp('sources.leechers', leechers) + ' · ' + t('sources.seedsNow');
}

export function probeMessage(r: ProbeResult): string {
  if (r.ok) return liveSeedLine(r.seeders, r.leechers);
  if (r.reason === 'timeout') return t('sources.seedsTimeout');
  return t('sources.seedsNoTracker');
}

export interface SeedProbe {
  phase: 'idle' | 'busy' | 'done' | 'err';
  line: string;
  run: () => void;
  /** The tracker line until a check answers, then the check's line. */
  text: (fallback: string) => string;
}

/** One manual check shared by a card and its sheet. */
export function useSeedProbe(r: SourceResult): SeedProbe {
  const [phase, setPhase] = useState<'idle' | 'busy' | 'done' | 'err'>('idle');
  const [line, setLine] = useState('');
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const run = () => {
    if (phaseRef.current === 'busy') return;
    setPhase('busy');
    probeSeeds(r).then((res) => {
      setLine(probeMessage(res));
      setPhase(res.ok ? 'done' : 'err');
    });
  };
  const text = (fallback: string) => (phase === 'done' || phase === 'err' ? line : fallback);
  return { phase, line, run, text };
}

/** Replaces the tracker seed text after a manual check. Hidden when the row has no seed count and has not been checked. */
export function SeedCheck(p: {
  r: SourceResult;
  fallback: string;
  tv?: boolean;
  testCode?: string;
  focusKey?: string;
  live?: boolean;
  /** Shared with another SeedCheck (the card and its sheet). */
  probe?: SeedProbe;
  /** The button only. The parent prints `probe.text` where the tracker count was. */
  buttonOnly?: boolean;
}) {
  const own = useSeedProbe(p.r);
  const probe = p.probe || own;
  const phase = probe.phase;
  if (!p.fallback && phase === 'idle') return null;
  const run = () => probe.run();
  const label = (phase === 'busy' ? t('news.checking') : t('sources.checkSeeds')) + ': ' + p.r.Title;
  const shown = probe.text(p.fallback);
  const btn = p.tv ? (
    <Focusable
      focusKey={p.focusKey || 'seed-check'}
      className="seed-check"
      role="button"
      ariaLabel={label}
      testCode={p.testCode || ''}
      isolateClick
      onPress={run}
    >
      {phase === 'busy' ? <span class="seed-spin" /> : t('sources.checkSeeds')}
    </Focusable>
  ) : (
    <button
      type="button"
      class="seed-check tm"
      data-code={p.testCode}
      data-seed-check=""
      aria-label={label}
      aria-busy={phase === 'busy'}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        run();
      }}
    >
      {phase === 'busy' ? (
        <span class="seed-spin" aria-hidden="true" />
      ) : (
        <>
          <span class="seed-check-long">{t('sources.checkSeeds')}</span>
          <span class="seed-check-short">{t('sources.checkSeedsShort')}</span>
        </>
      )}
    </button>
  );
  if (p.buttonOnly) return btn;
  return (
    <span class="seed-check-line" data-seed-phase={phase}>
      <span class={phase === 'err' ? 'seed-check-err' : phase === 'done' ? 'seed-fresh' : ''} data-seed-live={phase === 'done' ? '' : undefined}>{shown}</span>
      {(p.live && phase === 'idle') || phase === 'done' ? <span class="seed-live" aria-label={t('settings.liveSeedsLive')} /> : null}
      {btn}
    </span>
  );
}
