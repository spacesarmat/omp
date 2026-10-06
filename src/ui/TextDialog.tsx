import { useEffect, useState } from 'preact/hooks';
import { signal, computed } from '@preact/signals';
import { getCurrentFocusKey, setFocus, doesFocusableExist } from '@noriginmedia/norigin-spatial-navigation';
import { FocusGroup, Button, TextInput } from './components';
import { useKeys } from './keys';
import { t } from '../i18n';

interface TextState {
  id: number;
  title: string;
  initial: string;
  okLabel: string;
  resolve: (v: string | null) => void;
  prevFocus?: string;
}

const state = signal<TextState | null>(null);

/** True while the text dialog is on screen (the app's generic dialog flag does not cover it). */
export const textDialogOpen = computed(() => state.value !== null);
let seq = 0;

/** A modal with one text field: resolves the typed text on OK / Enter, null on Cancel / Back. Needs TextDialogHost mounted. */
export function askText(title: string, initial: string, okLabel?: string): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    if (state.value) state.value.resolve(null);
    state.value = {
      id: ++seq,
      title,
      initial,
      okLabel: okLabel || t('common.save'),
      resolve,
      prevFocus: getCurrentFocusKey() || undefined,
    };
  });
}

function close(v: string | null) {
  const d = state.value;
  if (!d) return;
  state.value = null;
  if (d.prevFocus && doesFocusableExist(d.prevFocus)) setFocus(d.prevFocus);
  d.resolve(v);
}

function Box({ d }: { d: TextState }) {
  const [text, setText] = useState(d.initial);
  useEffect(() => {
    setFocus('text-dialog-input');
  }, []);
  return (
    <FocusGroup focusKey={'TEXT-DIALOG-' + d.id} className="dialog text-dialog" boundary>
      <div class="dialog-title">{d.title}</div>
      <TextInput focusKey="text-dialog-input" value={text} onChange={setText} onSubmit={() => close(text)} />
      <div class="text-dialog-actions">
        <Button focusKey="text-dialog-ok" className="primary" label={d.okLabel} onPress={() => close(text)} />
        <Button focusKey="text-dialog-cancel" label={t('common.cancel')} onPress={() => close(null)} />
      </div>
    </FocusGroup>
  );
}

export function TextDialogHost() {
  useKeys((a) => {
    if (!state.value) return false;
    if (a === 'back') {
      close(null);
      return true;
    }
    return 'spatial';
  }, 100);
  const d = state.value;
  if (!d) return null;
  return (
    <div
      class="dialog-backdrop"
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        e.stopPropagation();
        close(null);
      }}
    >
      <Box key={d.id} d={d} />
    </div>
  );
}
