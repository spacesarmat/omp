import { useEffect, useState } from 'preact/hooks';
import { lang } from '../../../src/i18n';
import { switchTab } from '../nav';
import { Icon } from '../ui/Icon';
import { desktopNavItems, type Tab } from '../ui/NavBar';
import {
  nextSidebarMode,
  readSidebarMode,
  sidebarIsNarrow,
  sidebarShortcut,
  writeSidebarMode,
  type SidebarMode,
} from './sidebarState';

export function DesktopSidebar({ active }: { active: Tab }) {
  const [mode, setMode] = useState<SidebarMode>(() => readSidebarMode(typeof localStorage === 'undefined' ? null : localStorage));
  const [narrow, setNarrow] = useState(() => sidebarIsNarrow(typeof window === 'undefined' ? 1280 : window.innerWidth));

  const apply = (next: SidebarMode) => {
    setMode(next);
    writeSidebarMode(typeof localStorage === 'undefined' ? null : localStorage, next);
  };

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('is-expanded', 'is-rail', 'is-hidden', 'is-narrow');
    root.classList.add('is-' + mode);
    if (narrow) root.classList.add('is-narrow');
    const onResize = () => setNarrow(sidebarIsNarrow(window.innerWidth));
    const onKey = (event: KeyboardEvent) => {
      if (!sidebarShortcut(event)) return;
      event.preventDefault();
      apply(nextSidebarMode(mode));
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKey);
      root.classList.remove('is-expanded', 'is-rail', 'is-hidden', 'is-narrow');
    };
  }, [mode, narrow]);

  const en = lang.value === 'en';
  const label = mode === 'expanded'
    ? (en ? 'Icon rail' : 'Только значки')
    : mode === 'rail'
      ? (en ? 'Hide menu' : 'Скрыть меню')
      : (en ? 'Show menu' : 'Показать меню');

  return (
    <div class="omp-desk-chrome">
      {mode !== 'hidden' && narrow && (
        <button type="button" class="omp-desk-backdrop" aria-label={en ? 'Hide menu' : 'Скрыть меню'} onClick={() => apply('hidden')} />
      )}
      {mode !== 'hidden' && (
        <aside class={'omp-side is-' + mode} aria-label={en ? 'Main menu' : 'Основное меню'}>
          <div class="omp-side-brand">{mode === 'expanded' ? 'OMP' : 'O'}</div>
          <button type="button" class="omp-side-toggle" aria-label={label} onClick={() => apply(nextSidebarMode(mode))}>
            {mode === 'expanded' ? '<' : '>'}
          </button>
          <nav>
            {desktopNavItems().map((item) => (
              <button
                type="button"
                key={item.id}
                class={'omp-side-item' + (item.id === active ? ' is-on' : '')}
                aria-current={item.id === active ? 'page' : undefined}
                aria-label={item.label}
                title={item.label}
                onClick={() => {
                  switchTab({ name: item.id });
                  if (narrow) apply('hidden');
                }}
              >
                <Icon d={item.d} />
                {mode === 'expanded' && <span>{item.label}</span>}
              </button>
            ))}
          </nav>
        </aside>
      )}
      {mode === 'hidden' && (
        <button type="button" class="omp-side-reveal" aria-label={en ? 'Show menu' : 'Показать меню'} onClick={() => apply('expanded')}>
          {en ? 'Menu' : 'Меню'}
        </button>
      )}
    </div>
  );
}
