import { Sheet } from './Sheet';
import type { PlayerState } from '../../../src/phone/protocol';

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
    <Sheet onClose={onClose} label="Звук и субтитры">
      <div class="m-sheet-title">Звук</div>
      {state.audio.list.map((name, i) => (
        <Row key={i} name={name} on={i === state.audio.sel} onPick={() => onAudio(i)} />
      ))}
      <div class="m-sheet-title m-track-head">Субтитры</div>
      {state.subs.list.map((s) => (
        <Row key={s.value} name={s.label} on={s.value === state.subs.sel} onPick={() => onSubs(s.value)} />
      ))}
    </Sheet>
  );
}
