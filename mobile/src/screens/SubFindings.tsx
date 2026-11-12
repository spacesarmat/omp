import { useEffect, useState } from 'preact/hooks';
import { t } from '../../../src/i18n';
import { Icon } from '../ui/Icon';
import { LaunchError } from '../ui/LaunchError';
import { SubSheet } from '../ui/SubSheet';
import { useResultRows } from '../ui/useResultRows';
import { goBack, navigate } from '../nav';
import { monitorVersion, reloadMonitor } from '../monitor/ui';
import { checkSubNow, checkingSubs, loadSubsSort, sortFindings } from '../monitor/subsView';
import { WatchPrompt } from './News';
import { shortTitle } from '../../../src/lib/libraryView';
import { bestRelease } from '../../../src/monitor/bestRelease';
import { findingsOf, getSubscription, markFindingsSeen, removeSubscription, seenKeys, updateSubscription } from '../../../src/monitor/subs';
import { FREE_SUBS_MAX, isSubPaused } from '../../../src/monitor/limit';
import { qualityLabels, seriesSubLine, subRule, whenText } from '../monitor/text';
import { checkCount, checkTimes, isSubHeld, setSubHeld } from '../monitor/subHold';
import { phoneCatalog } from '../catalog/phoneCatalog';
import { askConfirm } from '../ui/confirm';
import { ICONS } from '../ui/Icon';

function SeriesNote({ kind, id }: { kind: 'movie' | 'tv'; id: number }) {
  const [line, setLine] = useState('');
  useEffect(() => {
    if (kind !== 'tv') {
      setLine('');
      return;
    }
    let live = true;
    phoneCatalog()
      .then((c) => c.card('tv', id))
      .then(
        (card) => {
          if (live) setLine(seriesSubLine(card));
        },
        () => {
          if (live) setLine('');
        },
      );
    return () => {
      live = false;
    };
  }, [kind, id]);
  if (!line) return null;
  return <p class="m-small m-muted" data-sub-series>{line}</p>;
}

const BACK = 'M15 5l-7 7 7 7';
const PEN = 'M4 16.5V20h3.5L18 9.5 14.5 6 4 16.5zM13.8 6.7l3.5 3.5';

/** Findings of one subscription, newest first; opening it marks them looked at. «Изменить» opens the subscription. */
export function SubFindings({ id, finding, watch }: { id: string; finding?: string; watch?: boolean }) {
  const v = monitorVersion.value;
  const sub = getSubscription(id);
  const list = sortFindings(findingsOf(id), loadSubsSort(), sub ? [sub] : []);
  const [fresh, setFresh] = useState<string[]>(() => list.filter((f) => !f.seen).map((f) => f.key));
  const [editing, setEditing] = useState(false);
  const [prompt, setPrompt] = useState(!!watch);
  const rows = useResultRows({ seedCode: 'P04.2' });
  const busy = checkingSubs.value.indexOf(id) >= 0;
  const paused = !!sub && isSubPaused(id);

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
  const held = !!sub && isSubHeld(id);
  const poster = sub ? (sub.catalog && sub.catalog.poster) || sub.poster || '' : '';
  const checks = checkCount(id);
  const remove = async () => {
    if (!sub) return;
    if (!(await askConfirm(t('monitor.sub.deleteAsk', { query: sub.query }), t('common.delete'), { destructive: true }))) return;
    removeSubscription(id);
    reloadMonitor();
    goBack();
  };

  return (
    <div class="m-screen" data-route="subFindings">
      <div class="m-bar">
        <button type="button" class="m-icon-btn tm" data-code="P04.1" aria-label={t('common.back')} onClick={() => goBack()}>
          <Icon d={BACK} />
        </button>
        <span class="m-grow" />
        {sub && (
          <>
            <button type="button" class="m-icon-btn m-sub-tool" aria-label={t('connect.edit')} onClick={() => setEditing(true)}>
              <Icon d={PEN} size={20} />
            </button>
            <button
              type="button"
              class="m-icon-btn m-sub-tool"
              aria-label={held ? t('monitor.sub.resume') : t('monitor.sub.pause')}
              aria-pressed={held}
              data-sub-pause
              onClick={() => {
                setSubHeld(id, !held);
                reloadMonitor();
              }}
            >
              <Icon d={held ? ICONS.play : ICONS.pause} size={20} />
            </button>
            <button type="button" class="m-icon-btn m-sub-tool" aria-label={t('common.delete')} onClick={() => void remove()}>
              <Icon d={ICONS.trash} size={20} />
            </button>
          </>
        )}
      </div>
      <h1 class="m-sub-page-title">{sub ? sub.query : t('monitor.sub.title')}</h1>
      {!sub ? (
        <div class="m-muted">{t('monitor.sub.deleted')}</div>
      ) : (
        <>
          {poster ? <img class="m-sub-hero" data-sub-poster src={poster} alt="" /> : null}
          <div class="m-sub-chips">
            {qualityLabels().map((q) => (
              <button
                key={q.id || 'any'}
                type="button"
                class={'m-chip' + (sub.quality === q.id ? ' on' : '')}
                data-sub-chip
                aria-pressed={sub.quality === q.id}
                onClick={() => {
                  updateSubscription(id, { quality: q.id });
                  reloadMonitor();
                }}
              >
                {q.label}
              </button>
            ))}
          </div>
          <div class="m-muted m-small">{subRule(sub)}</div>
          <div class="m-skip-row">
            <span class="m-skip-text">{t('monitor.sub.notify')}</span>
            <button
              type="button"
              role="switch"
              aria-checked={sub.notify}
              aria-label={t('monitor.sub.notify')}
              class={'m-switch' + (sub.notify ? ' on' : '')}
              data-sub-notify
              onClick={() => {
                updateSubscription(id, { notify: !sub.notify });
                reloadMonitor();
              }}
            >
              <span class="m-switch-knob" />
            </button>
          </div>
          <div class="m-skip-row">
            <span class="m-skip-text">
              {t('monitor.sub.telegram')}
              <span class="m-muted m-small">{t('monitor.sub.telegramHint')}</span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={sub.notifyTelegram === true}
              aria-label={t('monitor.sub.telegram')}
              class={'m-switch' + (sub.notifyTelegram ? ' on' : '')}
              data-sub-telegram
              onClick={() => {
                updateSubscription(id, { notifyTelegram: sub.notifyTelegram !== true });
                reloadMonitor();
              }}
            >
              <span class="m-switch-knob" />
            </button>
          </div>
          {sub.catalog && (
            <button
              type="button"
              class="m-btn m-btn-secondary m-btn-sm"
              data-sub-card
              onClick={() => navigate({ name: 'title', kind: sub.catalog!.kind, id: sub.catalog!.id })}
            >
              {t('monitor.sub.openCard')}
            </button>
          )}
          {sub.catalog && <SeriesNote kind={sub.catalog.kind} id={sub.catalog.id} />}
          {checks > 0 && <p class="m-small m-muted" data-sub-checks>{t('monitor.sub.checks', { n: checks })}</p>}
          {checkTimes(id).length > 0 && (
            <ul class="m-sub-log" data-sub-log>
              {checkTimes(id).map((at, i) => (
                <li key={at + ':' + i}>{whenText(at, Date.now())}</li>
              ))}
            </ul>
          )}
          {held ? (
            <div class="m-small m-sub-paused-note" data-sub-hold>
              {t('monitor.sub.held')}
            </div>
          ) : paused ? (
            <>
              <div class="m-small m-sub-paused-note" data-sub-paused>
                {t('monitor.limit.pausedCheck', { n: FREE_SUBS_MAX })}
              </div>
              <button type="button" class="m-btn m-btn-primary m-btn-sm m-sub-check" onClick={() => navigate({ name: 'account' })}>
                {t('monitor.limit.go')}
              </button>
            </>
          ) : (
            <button type="button" class="m-btn m-btn-primary m-btn-sm m-sub-check" data-check-sub disabled={busy} onClick={() => void checkSubNow(id)}>
              {busy ? t('news.checking') : t('news.checkNow')}
            </button>
          )}
          {target && prompt && (
            <WatchPrompt title={shortTitle(target.result.Title)} onDismiss={() => setPrompt(false)} onWatch={() => void rows.add(target.result, true)} />
          )}
          {rows.error && <LaunchError message={rows.error} />}
          {(() => {
            const best = bestRelease(id);
            if (!best || list.some((f) => f.result.Title === best.Title)) return null;
            return (
              <div data-sub-best>
                <p class="m-small m-muted">{t('monitor.sub.bestBelow')}</p>
                {rows.card(best)}
              </div>
            );
          })()}
          {list.length === 0 && (
            <div class="m-muted">
              {seenKeys(id) === null
                ? t('news.subNeverChecked')
                : t('news.subNoFindings')}
            </div>
          )}
          <div class="m-results">
            {list.map((f) => rows.card(f.result, { flag: fresh.indexOf(f.key) >= 0 ? t('monitor.replaceSheet.fresh') : undefined, highlight: f.key === finding }))}
          </div>
        </>
      )}
      {editing && sub && <SubSheet sub={sub} onClose={() => setEditing(false)} onDeleted={() => goBack()} />}
      {rows.sheets}
    </div>
  );
}
