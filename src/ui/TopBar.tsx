import { FocusGroup, Focusable, IconButton } from './components';
import { Icon } from './icons';
import { Logo } from './Logo';
import { navigate } from './nav';
import { t } from '../i18n';
import { libraryTabs, LibraryTab, LibraryView, viewLabel } from '../lib/libraryView';
import { LibrarySort, sortLabel } from '../lib/librarySearch';

export interface TopBarProps {
  tab: LibraryTab;
  onTab: (t: LibraryTab) => void;
  view: LibraryView;
  sort: LibrarySort;
  searchOpen: boolean;
  onSearch: () => void;
  onView: () => void;
  onSort: () => void;
  onFocused: () => void;
}

export function TopBar(p: TopBarProps) {
  const listView = p.view === 'list' || p.view === 'compact';
  return (
    <FocusGroup focusKey="LIB-HEADER" className="topbar">
      <Logo size={52} />
      <span class="topbar-brand">OMP</span>
      {libraryTabs().map((tb) => (
        <Focusable
          key={tb.id}
          focusKey={'tab-' + tb.id}
          className={'tab' + (p.tab === tb.id ? ' active' : '')}
          onPress={() => p.onTab(tb.id)}
          onFocused={() => { p.onTab(tb.id); p.onFocused(); }}
        >
          {tb.id === 'history' && <Icon name="history" size={24} class="tab-icon" />}
          {tb.label}
        </Focusable>
      ))}
      <div class="spacer" />
      <IconButton focusKey="lib-btn-search" icon="search" label={p.searchOpen ? t('tv.topbar.closeSearch') : t('tv.topbar.search')} onPress={p.onSearch} onFocused={p.onFocused} />
      <IconButton focusKey="lib-btn-view" icon={listView ? 'list' : 'grid'} label={t('tv.topbar.view', { name: viewLabel(p.view) })} onPress={p.onView} onFocused={p.onFocused} disabled={p.tab === 'history'} />
      <IconButton focusKey="lib-btn-sort" icon="sort" label={t('tv.topbar.sort', { name: sortLabel(p.sort) })} onPress={p.onSort} onFocused={p.onFocused} />
      <IconButton focusKey="lib-btn-add" icon="plus" label={t('common.add')} onPress={() => navigate({ name: 'add' })} onFocused={p.onFocused} />
      <IconButton focusKey="lib-btn-playlist" icon="playlist" label={t('tv.topbar.playlists')} onPress={() => navigate({ name: 'playlist' })} onFocused={p.onFocused} />
      <IconButton focusKey="lib-btn-settings" icon="settings" label={t('common.settings')} onPress={() => navigate({ name: 'settings' })} onFocused={p.onFocused} />
    </FocusGroup>
  );
}
