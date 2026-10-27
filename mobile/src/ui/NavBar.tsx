import { Icon } from './Icon';
import { switchTab } from '../nav';
import { newsBadge } from '../monitor/ui';
import { freshText } from '../monitor/text';
import { t } from '../../../src/i18n';
import { latestUpdate } from '../../../src/store/updates';
import { activeTv } from '../tv/tvStore';

export type Tab = 'library' | 'news' | 'add' | 'remote' | 'settings';

const TABS: { id: Tab; code: string; label: () => string; d: string }[] = [
  { id: 'library', code: 'P33.1', label: () => t('nav.library'), d: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z' },
  { id: 'news', code: 'P33.2', label: () => t('nav.news'), d: 'M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10 20a2 2 0 0 0 4 0' },
  // «Поиск» (route id stays 'add': deep links, saved tabs and the magnet intake keep working)
  { id: 'add', code: 'P33.3', label: () => t('nav.search'), d: 'M5 11a6 6 0 1 0 12 0 6 6 0 0 0-12 0zM21 21l-5-5' },
  {
    id: 'remote',
    code: 'P33.4',
    label: () => t('nav.remote'),
    d: 'M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM12 7a2 2 0 1 0 0 4a2 2 0 1 0 0-4M10 16h4',
  },
  {
    id: 'settings',
    code: 'P33.5',
    label: () => t('common.settings'),
    d: 'M4 7h10M18 7h2M4 17h4M12 17h8M14 7a2 2 0 1 0 4 0a2 2 0 1 0-4 0M8 17a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
  },
];

/** Ids of the bottom tabs, in order: every root screen, «Пульт» included. */
export const TAB_IDS: Tab[] = TABS.map((t) => t.id);

/** The tabs shown now (the swipe between tabs follows them): «Пульт» only once a TV is paired. */
export function visibleTabIds(): Tab[] {
  const tv = !!activeTv.value;
  return TAB_IDS.filter((id) => id !== 'remote' || tv);
}

export function NavBar({ active }: { active: Tab }) {
  // the bell: findings not looked at yet (subscriptions + new episodes)
  const badge = newsBadge();
  return (
    <nav class="m-nav" aria-label={t('nav.sections')}>
      {TABS.filter((x) => visibleTabIds().indexOf(x.id) >= 0).map((t) => {
        const n = t.id === 'news' ? badge : 0;
        return (
          <button
            type="button"
            key={t.id}
            class={'m-nav-item tm' + (t.id === active ? ' on' : '')}
            data-code={t.code}
            aria-current={t.id === active ? 'page' : undefined}
            aria-label={n ? t.label() + ', ' + freshText(n) : undefined}
            onClick={() => switchTab({ name: t.id })}
          >
            <span class="m-nav-pill">
              <Icon d={t.d} />
              {t.id === 'settings' && latestUpdate.value && <span class="m-nav-dot" aria-hidden="true" />}
              {n > 0 && (
                <span class="m-nav-badge" aria-hidden="true">
                  {n > 99 ? '99+' : n}
                </span>
              )}
            </span>
            {t.label()}
          </button>
        );
      })}
    </nav>
  );
}
