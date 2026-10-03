import { useEffect, useState } from 'preact/hooks';
import { Icon } from '../ui/Icon';
import { LaunchError } from '../ui/LaunchError';
import { SubSheet } from '../ui/SubSheet';
import { useResultRows } from '../ui/useResultRows';
import { goBack } from '../nav';
import { monitorVersion, reloadMonitor } from '../monitor/ui';
import { subRule } from '../monitor/text';
import { WatchPrompt } from './News';
import { shortTitle } from '../../../src/lib/libraryView';
import { findingsOf, getSubscription, markFindingsSeen, seenKeys } from '../../../src/monitor/subs';

const BACK = 'M15 5l-7 7 7 7';

/** Findings of one subscription, newest first; opening it marks them looked at. «Изменить» opens the subscription. */
export function SubFindings({ id, finding, watch }: { id: string; finding?: string; watch?: boolean }) {
  const v = monitorVersion.value;
  const sub = getSubscription(id);
  const list = findingsOf(id);
  const [fresh, setFresh] = useState<string[]>(() => list.filter((f) => !f.seen).map((f) => f.key));
  const [editing, setEditing] = useState(false);
  const [prompt, setPrompt] = useState(!!watch);
  const rows = useResultRows();

  useEffect(() => {
    const unseen = findingsOf(id).filter((f) => !f.seen);
    if (!unseen.length) return;
    // keep the «Новая» marks of this visit, then count them as looked at
    setFresh((old) => old.concat(unseen.map((f) => f.key).filter((k) => old.indexOf(k) < 0)));
    markFindingsSeen(id);
    reloadMonitor();
  }, [id, v]);
  useEffect(() => {
    const el = document.querySelector('[data-highlight]') as HTMLElement | null;
    if (finding && el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center' });
  }, [finding]);
  useEffect(() => setPrompt(!!watch), [finding, watch]);

  const target = finding ? list.filter((f) => f.key === finding)[0] : undefined;

  return (
    <div class="m-screen" data-route="subFindings">
      <div class="m-bar">
        <button type="button" class="m-icon-btn" aria-label="Назад" onClick={() => goBack()}>
          <Icon d={BACK} />
        </button>
        <h1 class="m-bar-title m-grow">{sub ? sub.query : 'Подписка'}</h1>
        {sub && (
          <button type="button" class="m-btn m-btn-secondary m-btn-sm" onClick={() => setEditing(true)}>
            Изменить
          </button>
        )}
      </div>
      {!sub ? (
        <div class="m-muted">Подписка удалена</div>
      ) : (
        <>
          <div class="m-muted m-small">{subRule(sub)}</div>
          {target && prompt && (
            <WatchPrompt title={shortTitle(target.result.Title)} onDismiss={() => setPrompt(false)} onWatch={() => void rows.add(target.result, true)} />
          )}
          {rows.error && <LaunchError message={rows.error} />}
          {list.length === 0 && (
            <div class="m-muted">
              {seenKeys(id) === null
                ? 'Подписка ещё не проверялась. Первая проверка только запомнит, что уже есть, — о новых раздачах OMP сообщит после неё.'
                : 'Новых раздач пока нет'}
            </div>
          )}
          <div class="m-results">
            {list.map((f) => rows.card(f.result, { flag: fresh.indexOf(f.key) >= 0 ? 'Новая' : undefined, highlight: f.key === finding }))}
          </div>
        </>
      )}
      {editing && sub && <SubSheet sub={sub} onClose={() => setEditing(false)} onDeleted={() => goBack()} />}
      {rows.sheets}
    </div>
  );
}
