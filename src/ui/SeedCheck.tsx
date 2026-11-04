// A manual «Проверить» next to a tracker seed count. The «Актуальные сиды» setting does not gate it.
import { useState } from 'preact/hooks';
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

/** Replaces the tracker seed text after a manual check. Hidden when the row has no seed count. */
export function SeedCheck(p: {
  r: SourceResult;
  fallback: string;
  tv?: boolean;
  testCode?: string;
  focusKey?: string;
  live?: boolean;
}) {
  const [phase, setPhase] = useState<'idle' | 'busy' | 'done' | 'err'>('idle');
  const [line, setLine] = useState('');
  if (!p.fallback && phase === 'idle') return null;
  const run = () => {
    if (phase === 'busy') return;
    setPhase('busy');
    probeSeeds(p.r).then((res) => {
      setLine(probeMessage(res));
      setPhase(res.ok ? 'done' : 'err');
    });
  };
  const label = (phase === 'busy' ? t('news.checking') : t('sources.checkSeeds')) + ': ' + p.r.Title;
  const shown = phase === 'done' || phase === 'err' ? line : p.fallback;
  const btn = p.tv ? (
    <Focusable
      focusKey={p.focusKey || 'seed-check'}
      className="seed-check"
      role="button"
      ariaLabel={label}
      testCode={p.testCode || ''}
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
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        run();
      }}
    >
      {phase === 'busy' ? <span class="seed-spin" aria-hidden="true" /> : t('sources.checkSeeds')}
    </button>
  );
  return (
    <span class="seed-check-line" data-seed-phase={phase}>
      <span class={phase === 'err' ? 'seed-check-err' : phase === 'done' ? 'seed-fresh' : ''} data-seed-live={phase === 'done' ? '' : undefined}>{shown}</span>
      {p.live && phase === 'idle' ? <span class="seed-live" aria-label={t('settings.liveSeedsLive')} /> : null}
      {btn}
    </span>
  );
}
