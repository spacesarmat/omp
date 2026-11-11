import { useEffect, useState } from 'preact/hooks';
import { t } from '../../../src/i18n';
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

  const label = mode === 'expanded' ? t('nav.menuRail') : mode === 'rail' ? t('nav.menuHide') : t('nav.menuShow');

  return (
    <div class="omp-desk-chrome">
      {mode !== 'hidden' && narrow && (
        <button type="button" class="omp-desk-backdrop" aria-label={t('nav.menuHide')} onClick={() => apply('hidden')} />
      )}
      {mode !== 'hidden' && (
        <aside class={'omp-side is-' + mode} aria-label={t('nav.menuMain')}>
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
        <button type="button" class="omp-side-reveal" aria-label={t('nav.menuShow')} onClick={() => apply('expanded')}>
          {t('nav.menuButton')}
        </button>
      )}
    </div>
  );
}
