import { signal, computed } from '@preact/signals';
import { getCurrentFocusKey, setFocus, doesFocusableExist } from '@noriginmedia/norigin-spatial-navigation';
import { FocusGroup, Focusable } from './components';
import { useKeys } from './keys';

interface DialogState {
  id: number;
  title: string;
  options: { label: string; value: unknown }[];
  current?: unknown;
  resolve: (v: unknown) => void;
  prevFocus?: string;
}

const dialog = signal<DialogState | null>(null);
/** True while a DialogHost dialog is open. */
export const dialogOpen = computed(() => dialog.value !== null);
let dialogSeq = 0;

export function choose<T>(title: string, options: { label: string; value: T }[], current?: T): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    if (dialog.value) dialog.value.resolve(null);
    dialog.value = {
      id: ++dialogSeq,
      title,
      options,
      current,
      resolve: resolve as (v: unknown) => void,
      prevFocus: getCurrentFocusKey() || undefined,
    };
  });
}

export function confirmDialog(text: string, okLabel = 'Да'): Promise<boolean> {
  return choose(text, [
    { label: okLabel, value: true },
    { label: 'Отмена', value: false },
  ]).then((v) => v === true);
}

function close(v: unknown) {
  const d = dialog.value;
  if (!d) return;
  dialog.value = null;
  if (d.prevFocus && doesFocusableExist(d.prevFocus)) setFocus(d.prevFocus);
  d.resolve(v);
}

export function DialogHost() {
  // highest priority: while a dialog is open, screens never see keys
  useKeys((a) => {
    if (!dialog.value) return false;
    if (a === 'back') {
      close(null);
      return true;
    }
    return 'spatial';
  }, 100);
  const d = dialog.value;
  if (!d) return null;
  let preferred: string | undefined;
  d.options.forEach((o, i) => { if (o.value === d.current) preferred = 'dialog-opt-' + i; });
  return (
    <div
      class="dialog-backdrop"
      onClick={(e) => {
        // a pointer click outside the box = Back; never reaches the screen's own click handler (player tap zones)
        if (e.target !== e.currentTarget) return;
        e.stopPropagation();
        close(null);
      }}
    >
      <FocusGroup key={d.id} focusKey={'DIALOG-' + d.id} className="dialog" boundary autoFocus preferredChildFocusKey={preferred}>
        <div class="dialog-title">{d.title}</div>
        {d.options.map((o, i) => (
          <Focusable
            key={i}
            focusKey={'dialog-opt-' + i}
            className={'dialog-option' + (o.value === d.current ? ' current' : '')}
            onPress={() => close(o.value)}
          >
            {o.label}
          </Focusable>
        ))}
      </FocusGroup>
    </div>
  );
}
