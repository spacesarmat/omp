import { Icon } from './Icon';
import { switchTab } from '../nav';

export type Tab = 'library' | 'add' | 'remote' | 'settings';

const TABS: { id: Tab; label: string; d: string }[] = [
  { id: 'library', label: 'Каталог', d: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z' },
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

export function NavBar({ active }: { active: Tab }) {
  return (
    <nav class="m-nav" aria-label="Разделы">
      {TABS.map((t) => (
        <button
          type="button"
          key={t.id}
          class={'m-nav-item' + (t.id === active ? ' on' : '')}
          aria-current={t.id === active ? 'page' : undefined}
          onClick={() => switchTab({ name: t.id })}
        >
          <span class="m-nav-pill">
            <Icon d={t.d} />
          </span>
          {t.label}
        </button>
      ))}
    </nav>
  );
}
