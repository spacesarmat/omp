import { useEffect, useRef, useState } from 'preact/hooks';
import { setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { FocusGroup, Focusable, Button } from './components';
import { useKeys } from './keys';
import { errorMessage } from '../api/http';
import { log } from '../lib/log';
import { markStep, markText, marksValid, stepMark, type MarkRow, type TvMarks } from '../lib/skipMarks';

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
  const [marks, setMarks] = useState<TvMarks>({ mi: p.prefs.mi, mc: p.prefs.mc });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const cur = useRef(marks);
  cur.current = marks;
  const focused = useRef<MarkRow | null>('from');
  const alive = useRef(true);

  useEffect(() => {
    setFocus('marks-from');
    return () => {
      alive.current = false;
    };
  }, []);

  const step = (row: MarkRow, dir: 1 | -1, repeat: boolean) => {
    if (busy) return;
    setError('');
    setMarks(stepMark(cur.current, row, dir, markStep(repeat)));
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
    if ((a === 'left' || a === 'right') && focused.current) {
      step(focused.current, a === 'right' ? 1 : -1, !!(e && e.repeat));
      return true;
    }
    return 'spatial';
  }, 50);

  const write = (m: TvMarks) => {
    if (busy) return;
    if (!marksValid(m)) {
      setError('Конец заставки должен быть позже начала');
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
    <div class="dialog-backdrop">
      <FocusGroup focusKey="MARKS-DIALOG" className="dialog marks-dialog" boundary>
        <div class="dialog-title" id="marks-title">Заставка и титры</div>
        <div class="marks-sub">{p.subtitle}</div>
        {ROWS.map((r) => (
          <Focusable
            key={r.row}
            focusKey={'marks-' + r.row}
            className="marks-row"
            onFocused={() => {
              focused.current = r.row;
            }}
          >
            <span class="marks-label">{r.label}</span>
            <span class="marks-step" role="button" aria-label="Меньше на 5 секунд" onClick={() => step(r.row, -1, false)}>◀</span>
            <span class="marks-value">{markText(marks, r.row)}</span>
            <span class="marks-step" role="button" aria-label="Больше на 5 секунд" onClick={() => step(r.row, 1, false)}>▶</span>
          </Focusable>
        ))}
        <div class="marks-hint">{MARKS_HINT}</div>
        {error && <div class="banner-error marks-error">{error}</div>}
        <div class="marks-actions">
          <Button
            focusKey="marks-reset"
            label="Сбросить"
            onPress={() => write({ mi: null, mc: null })}
            onFocused={() => {
              focused.current = null;
            }}
          />
          <Button
            focusKey="marks-save"
            className="primary"
            label={busy ? 'Сохраняю…' : 'Сохранить'}
            onPress={() => write(cur.current)}
            onFocused={() => {
              focused.current = null;
            }}
          />
        </div>
      </FocusGroup>
    </div>
  );
}
