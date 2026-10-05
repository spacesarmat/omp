import { Sheet } from './Sheet';
import type { PlayerState } from '../../../src/phone/protocol';
import { t } from '../../../src/i18n';

function Row({ name, on, onPick }: { name: string; on: boolean; onPick: () => void }) {
  return (
    <button type="button" class={'m-track' + (on ? ' on' : '')} aria-pressed={on} onClick={onPick}>
      <span class="m-track-dot">
        <span />
      </span>
      {name}
    </button>
  );
}

/** «Звук и субтитры»: pick an audio track and a subtitle track; closes on choice. */
export function TracksSheet({
  state,
  onAudio,
  onSubs,
  onClose,
}: {
  state: PlayerState;
  onAudio: (i: number) => void;
  onSubs: (value: string) => void;
  onClose: () => void;
}) {
  return (
    <Sheet onClose={onClose} label={t('remote.tracks.label')}>
      <div class="m-sheet-title">{t('remote.tracks.audio')}</div>
      {state.audio.list.length === 0 && <div class="m-track-none">{t('remote.tracks.none')}</div>}
      {state.audio.list.map((name, i) => (
        <Row key={i} name={name} on={i === state.audio.sel} onPick={() => onAudio(i)} />
      ))}
      <div class="m-sheet-title m-track-head">{t('common.subtitles')}</div>
      {state.subs.list.length === 0 && <div class="m-track-none">{t('remote.tracks.none')}</div>}
      {state.subs.list.map((s) => (
        <Row key={s.value} name={s.label} on={s.value === state.subs.sel} onPick={() => onSubs(s.value)} />
      ))}
    </Sheet>
  );
}
