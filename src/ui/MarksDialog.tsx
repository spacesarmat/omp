import { useEffect, useRef, useState } from 'preact/hooks';
import { setFocus, getCurrentFocusKey } from '@noriginmedia/norigin-spatial-navigation';
import { FocusGroup, Focusable, Button } from './components';
import { useKeys } from './keys';
import { errorMessage } from '../api/http';
import { log } from '../lib/log';
import { clampMarks, holdStep, markText, marksValid, stepMark, type KeyTrack, type MarkRow, type TvMarks } from '../lib/skipMarks';

export const MARKS_HINT = '◀ ▶ — шаг 5 с, удерживайте для 30 с. Точнее — из плеера: меню → «Отметить начало заставки».';

const ROWS: { row: MarkRow; label: string }[] = [
  { row: 'from', label: 'Заставка с' },
  { row: 'to', label: 'Заставка до' },
  { row: 'last', label: 'Титры: последние' },
];

/**
 * «Заставка и титры» of the torrent card on LG and Android TV: the manual marks by the remote. ◀ ▶ on a row step it by
 * 5 s (30 s while the key is held), «Сохранить» writes the marks, «Сбросить» removes both, Back closes without saving.
 */
export function MarksDialog(p: { subtitle: string; prefs: TvMarks; onSave: (m: TvMarks) => Promise<unknown>; onClose: () => void }) {
  const [marks, setMarks] = useState<TvMarks>(() => clampMarks(p.prefs));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const cur = useRef(marks);
  cur.current = marks;
  const track = useRef<KeyTrack>({ dir: 0, at: -1e9, fastAt: -1e9 });
  const alive = useRef(true);

  useEffect(() => {
    setFocus('marks-from');
    return () => {
      alive.current = false;
    };
  }, []);

  const step = (row: MarkRow, dir: 1 | -1, amount: number) => {
    if (busy || amount <= 0) return;
    setError('');
    setMarks(stepMark(cur.current, row, dir, amount));
  };

  const focusedRow = (): MarkRow | null => {
    const k = getCurrentFocusKey() || '';
    return k === 'marks-from' ? 'from' : k === 'marks-to' ? 'to' : k === 'marks-last' ? 'last' : null;
  };

  const close = () => {
    if (!busy) p.onClose();
  };

  // above the screen, below DialogHost: ◀ ▶ step the focused row (a held key repeats), Back closes without saving
  useKeys((a, e) => {
    if (a === 'back') {
      close();
      return true;
    }
    // only while focus is on a row of this dialog (a pointer can move it behind the dialog)
    const row = focusedRow();
    if ((a === 'left' || a === 'right') && row) {
      const dir = a === 'right' ? 1 : -1;
      step(row, dir, holdStep(track.current, dir, !!(e && e.repeat), Date.now()));
      return true;
    }
    return 'spatial';
  }, 50);

  const write = (m: TvMarks) => {
    if (busy) return;
    if (!marksValid(m)) {
      setError('Отметки заданы неверно: конец заставки должен быть позже начала, значения — не больше 6 часов');
      return;
    }
    setBusy(true);
    setError('');
    let run: Promise<unknown>;
    try {
      run = p.onSave(m);
    } catch (e) {
      run = Promise.reject(e);
    }
    run.then(
      () => {
        if (alive.current) p.onClose();
      },
      (e) => {
        log('warn', 'tv', 'Не удалось сохранить отметки пропуска');
        if (!alive.current) return;
        setBusy(false);
        setError(errorMessage(e));
      },
    );
  };

  return (
    <div class="dialog-backdrop marks-backdrop">
      <FocusGroup focusKey="MARKS-DIALOG" className="dialog marks-dialog" boundary>
        <div class="dialog-title" id="marks-title">Заставка и титры</div>
        <div class="marks-sub">{p.subtitle}</div>
        {ROWS.map((r) => (
          <Focusable
            key={r.row}
            focusKey={'marks-' + r.row}
            className="marks-row"
            role="group"
            ariaLabel={r.label + ', ' + markText(marks, r.row)}
          >
            <span class="marks-label">{r.label}</span>
            <span class="marks-step" role="button" aria-label={r.label + ': меньше на 5 секунд'} onClick={() => step(r.row, -1, 5)}>◀</span>
            <span class="marks-value">{markText(marks, r.row)}</span>
            <span class="marks-step" role="button" aria-label={r.label + ': больше на 5 секунд'} onClick={() => step(r.row, 1, 5)}>▶</span>
          </Focusable>
        ))}
        <div class="marks-hint">{MARKS_HINT}</div>
        {error && <div class="banner-error marks-error">{error}</div>}
        <div class="marks-actions">
          <Button
            focusKey="marks-reset"
            label="Сбросить"
            onPress={() => write({ mi: null, mc: null })}
          />
          <Button
            focusKey="marks-save"
            className="primary"
            label={busy ? 'Сохраняю…' : 'Сохранить'}
            onPress={() => write(cur.current)}
          />
        </div>
      </FocusGroup>
    </div>
  );
}
