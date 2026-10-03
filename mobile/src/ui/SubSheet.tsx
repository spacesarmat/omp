import { useState } from 'preact/hooks';
import { Sheet } from './Sheet';
import { Icon } from './Icon';
import { showToast } from './toast';
import { QUALITY_LABELS, gbText, plural } from '../monitor/text';
import { askNotifyOnce, reloadMonitor } from '../monitor/ui';
import { addSubscription, loadSubs, removeSubscription, updateSubscription } from '../../../src/monitor/subs';
import type { SubQuality, Subscription, SubscriptionInput } from '../../../src/monitor/types';
import { allSources } from '../../../src/sources/registry';
import { enabledSources } from '../../../src/sources/store';

const CHECK = 'M5 12l5 5l9-10';
const CHEVRON = 'M9 6l6 6-6 6';

/** Integer ≥ 1, or undefined for an empty field; null when invalid. */
export function parseSeeds(v: string): number | undefined | null {
  const s = v.trim();
  if (!s) return undefined;
  if (!/^\d+$/.test(s)) return null;
  const n = parseInt(s, 10);
  return n >= 1 ? n : null;
}

/** Number > 0 (comma or dot), or undefined for an empty field; null when invalid. */
export function parseGb(v: string): number | undefined | null {
  const s = v.trim().replace(',', '.');
  if (!s) return undefined;
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = parseFloat(s);
  return n > 0 ? n : null;
}

/**
 * «Подписка»: create (no `sub`; `initial` prefills, e.g. from the search) or edit / delete `sub`. Changing the query or
 * the filters makes the next check silent (it only remembers what is there), like the first one.
 */
export function SubSheet(p: {
  sub?: Subscription;
  initial?: Partial<SubscriptionInput>;
  onClose: () => void;
  onSaved?: (s: Subscription) => void;
  onDeleted?: () => void;
}) {
  const base: Partial<SubscriptionInput> = p.sub || p.initial || {};
  const [query, setQuery] = useState(base.query || '');
  const [quality, setQuality] = useState<SubQuality>(base.quality || '');
  const [seeds, setSeeds] = useState(base.minSeeds ? String(base.minSeeds) : '');
  const [size, setSize] = useState(base.maxSizeGb ? gbText(base.maxSizeGb) : '');
  const [sources, setSources] = useState<string[] | null>(base.sources === undefined ? null : base.sources);
  const [notify, setNotify] = useState(base.notify !== false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState('');

  const all = allSources();
  const enabledIds = enabledSources(all).map((s) => s.id);
  const selected = sources || enabledIds;
  const nameOf = (id: string) => (all.filter((s) => s.id === id)[0] || { name: id }).name;
  const sourcesLabel =
    sources === null ? 'все включённые' : sources.length <= 2 ? sources.map(nameOf).join(', ') || 'не выбраны' : sources.length + ' ' + plural(sources.length, 'источник', 'источника', 'источников');

  const toggleSource = (id: string) => {
    const next = selected.indexOf(id) >= 0 ? selected.filter((x) => x !== id) : selected.concat([id]);
    setSources(all.map((s) => s.id).filter((x) => next.indexOf(x) >= 0));
  };

  const save = () => {
    const q = query.replace(/\s+/g, ' ').trim();
    if (!q) return setError('Введите, что искать');
    const minSeeds = parseSeeds(seeds);
    if (minSeeds === null) return setError('Сидов — целое число от 1, или оставьте поле пустым');
    const maxSizeGb = parseGb(size);
    if (maxSizeGb === null) return setError('Размер — число больше нуля, например 20, или оставьте поле пустым');
    if (sources !== null && !sources.length) return setError('Выберите хотя бы один источник');
    setError('');
    const input: SubscriptionInput = { query: q, quality, sources, notify, minSeeds, maxSizeGb };
    let saved: Subscription | null;
    if (p.sub) {
      saved = updateSubscription(p.sub.id, input);
    } else {
      const first = loadSubs().length === 0;
      saved = addSubscription(input);
      if (saved && first) void askNotifyOnce().catch(() => {});
    }
    if (!saved) return setError('Не удалось сохранить подписку');
    reloadMonitor();
    showToast(p.sub ? 'Подписка сохранена' : 'Подписка создана');
    p.onSaved?.(saved);
    p.onClose();
  };

  const remove = () => {
    if (!p.sub) return;
    if (!window.confirm('Удалить подписку «' + p.sub.query + '»?')) return;
    removeSubscription(p.sub.id);
    reloadMonitor();
    showToast('Подписка удалена');
    p.onDeleted?.();
    p.onClose();
  };

  if (picking) {
    return (
      <Sheet label="Источники подписки" onClose={() => setPicking(false)}>
        <div class="m-sheet-title">Источники</div>
        <div class="m-sheet-scroll m-sub-pick">
          <button type="button" role="radio" aria-checked={sources === null} class="m-opt" onClick={() => setSources(null)}>
            <span class="m-opt-name m-grow">Все включённые</span>
            {sources === null && <Icon d={CHECK} size={20} />}
          </button>
          {all.map((s) => {
            const on = sources !== null && sources.indexOf(s.id) >= 0;
            return (
              <button
                key={s.id}
                type="button"
                role="checkbox"
                aria-checked={on}
                class="m-opt"
                onClick={() => (sources === null ? setSources([s.id]) : toggleSource(s.id))}
              >
                <span class="m-opt-name m-grow">{s.name}</span>
                {on && <Icon d={CHECK} size={20} />}
              </button>
            );
          })}
        </div>
        <button type="button" class="m-btn m-btn-primary" onClick={() => setPicking(false)}>
          Готово
        </button>
      </Sheet>
    );
  }

  return (
    <Sheet label="Подписка" onClose={p.onClose}>
      <div class="m-sheet-title">Подписка</div>
      <div class="m-sheet-scroll m-sub-form">
        <div class="m-field">
          <label for="m-sub-query">Что искать</label>
          <input id="m-sub-query" class="m-input" type="text" value={query} onInput={(e) => setQuery((e.target as HTMLInputElement).value)} />
        </div>
        <div class="m-muted m-small">Качество</div>
        <div class="m-chips" style={{ flexWrap: 'wrap' }}>
          {QUALITY_LABELS.map((q) => (
            <button
              key={q.id}
              type="button"
              class={'m-chip' + (quality === q.id ? ' on' : '')}
              aria-pressed={quality === q.id}
              onClick={() => setQuality(q.id)}
            >
              {q.label}
            </button>
          ))}
        </div>
        <div class="m-marks-pair">
          <div class="m-field">
            <label for="m-sub-seeds">Сидов не меньше</label>
            <input id="m-sub-seeds" class="m-input" type="text" inputMode="numeric" value={seeds} onInput={(e) => setSeeds((e.target as HTMLInputElement).value)} />
          </div>
          <div class="m-field">
            <label for="m-sub-size">Размер до, ГБ</label>
            <input
              id="m-sub-size"
              class="m-input"
              type="text"
              inputMode="decimal"
              placeholder="без ограничения"
              value={size}
              onInput={(e) => setSize((e.target as HTMLInputElement).value)}
            />
          </div>
        </div>
        <button type="button" class="m-set-row m-set-pick" aria-haspopup="dialog" onClick={() => setPicking(true)}>
          <span>Источники</span>
          <span class="m-muted">{sourcesLabel} ›</span>
        </button>
        <div class="m-skip-row">
          <span class="m-skip-text">
            Уведомлять
            <span class="m-muted m-small">о каждой новой раздаче</span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={notify}
            aria-label="Уведомлять"
            class={'m-switch' + (notify ? ' on' : '')}
            onClick={() => setNotify(!notify)}
          >
            <span class="m-switch-knob" />
          </button>
        </div>
        {p.sub && <div class="m-muted m-small">После изменения условий следующая проверка только запомнит, что уже есть.</div>}
      </div>
      {error && (
        <div class="m-error" role="alert">
          {error}
        </div>
      )}
      <div class="m-marks-actions">
        {p.sub ? (
          <button type="button" class="m-btn m-btn-secondary m-danger-text" onClick={remove}>
            Удалить
          </button>
        ) : (
          <button type="button" class="m-btn m-btn-secondary" onClick={p.onClose}>
            Отмена
          </button>
        )}
        <button type="button" class="m-btn m-btn-primary" onClick={save}>
          Сохранить
        </button>
      </div>
    </Sheet>
  );
}
