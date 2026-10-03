import { Icon } from './Icon';
import { switchTab } from '../nav';
import { newsBadge } from '../monitor/ui';
import { freshText } from '../monitor/text';

export type Tab = 'library' | 'news' | 'add' | 'remote' | 'settings';

const TABS: { id: Tab; label: string; d: string }[] = [
  { id: 'library', label: 'Каталог', d: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z' },
  { id: 'news', label: 'Новое', d: 'M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10 20a2 2 0 0 0 4 0' },
  { id: 'add', label: 'Добавить', d: 'M12 5v14M5 12h14' },
  {
    id: 'remote',
    label: 'Пульт',
    d: 'M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM12 7a2 2 0 1 0 0 4a2 2 0 1 0 0-4M10 16h4',
  },
  {
    id: 'settings',
    label: 'Настройки',
    d: 'M4 7h10M18 7h2M4 17h4M12 17h8M14 7a2 2 0 1 0 4 0a2 2 0 1 0-4 0M8 17a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
  },
];

/** Ids of the bottom tabs, in order (the swipe between tabs follows it). */
export const TAB_IDS: Tab[] = TABS.map((t) => t.id);

export function NavBar({ active }: { active: Tab }) {
  // the bell: findings not looked at yet (subscriptions + new episodes)
  const badge = newsBadge();
  return (
    <nav class="m-nav" aria-label="Разделы">
      {TABS.map((t) => {
        const n = t.id === 'news' ? badge : 0;
        return (
          <button
            type="button"
            key={t.id}
            class={'m-nav-item' + (t.id === active ? ' on' : '')}
            aria-current={t.id === active ? 'page' : undefined}
            aria-label={n ? t.label + ', ' + freshText(n) : undefined}
            onClick={() => switchTab({ name: t.id })}
          >
            <span class="m-nav-pill">
              <Icon d={t.d} />
              {n > 0 && (
                <span class="m-nav-badge" aria-hidden="true">
                  {n > 99 ? '99+' : n}
                </span>
              )}
            </span>
            {t.label}
          </button>
        );
      })}
    </nav>
  );
}
