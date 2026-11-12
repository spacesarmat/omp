import { useState } from 'react';
import { Modal } from '@/components/modal';
import { toast } from '@/components/chrome';
import { filterLogLines } from '@/lib/logText';

const fieldClass = 'h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm text-foreground';
const buttonClass = 'h-10 shrink-0 rounded-md bg-secondary px-3 text-sm font-semibold text-secondary-foreground disabled:opacity-50';

/** Scrollable monospace text over the page, with a line filter, optional refresh and copy. */
export function LogDialog({
  title,
  text,
  onClose,
  onRefresh,
  refreshing,
}: {
  title: string;
  text: string;
  onClose: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const [query, setQuery] = useState('');
  const shown = filterLogLines(text, query);
  return (
    <Modal title={title} onClose={onClose}>
      <div className="flex flex-wrap gap-2 border-b border-border px-4 py-3">
        <input
          className={fieldClass}
          value={query}
          aria-label="Фильтр"
          placeholder="Фильтр строк"
          autoComplete="off"
          onChange={(e) => setQuery(e.target.value)}
        />
        {onRefresh ? (
          <button type="button" className={buttonClass} disabled={refreshing} onClick={onRefresh}>
            {refreshing ? 'Обновление…' : 'Обновить'}
          </button>
        ) : null}
        <button
          type="button"
          className={buttonClass}
          onClick={() => {
            if (!shown) {
              toast('Пусто');
              return;
            }
            void navigator.clipboard.writeText(shown).then(
              () => toast('Скопировано'),
              () => toast('Не скопировалось'),
            );
          }}
        >
          Копировать
        </button>
      </div>
      <pre className="min-h-40 flex-1 overflow-auto whitespace-pre-wrap break-words bg-background p-4 font-mono text-xs" aria-busy={refreshing ? true : undefined}>
        {shown || (query.trim() ? 'Нет строк' : '')}
      </pre>
    </Modal>
  );
}
