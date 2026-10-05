import { FocusGroup, Focusable, IconButton } from './components';
import { Icon } from './icons';
import { Logo } from './Logo';
import { navigate } from './nav';
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
      {libraryTabs().map((t) => (
        <Focusable
          key={t.id}
          focusKey={'tab-' + t.id}
          className={'tab' + (p.tab === t.id ? ' active' : '')}
          onPress={() => p.onTab(t.id)}
          onFocused={() => { p.onTab(t.id); p.onFocused(); }}
        >
          {t.id === 'history' && <Icon name="history" size={24} class="tab-icon" />}
          {t.label}
        </Focusable>
      ))}
      <div class="spacer" />
      <IconButton focusKey="lib-btn-search" icon="search" label={p.searchOpen ? 'Закрыть поиск' : 'Поиск'} onPress={p.onSearch} onFocused={p.onFocused} />
      <IconButton focusKey="lib-btn-view" icon={listView ? 'list' : 'grid'} label={'Вид: ' + viewLabel(p.view)} onPress={p.onView} onFocused={p.onFocused} disabled={p.tab === 'history'} />
      <IconButton focusKey="lib-btn-sort" icon="sort" label={'Сортировка: ' + sortLabel(p.sort)} onPress={p.onSort} onFocused={p.onFocused} />
      <IconButton focusKey="lib-btn-add" icon="plus" label="Добавить" onPress={() => navigate({ name: 'add' })} onFocused={p.onFocused} />
      <IconButton focusKey="lib-btn-playlist" icon="playlist" label="Плейлисты" onPress={() => navigate({ name: 'playlist' })} onFocused={p.onFocused} />
      <IconButton focusKey="lib-btn-settings" icon="settings" label="Настройки" onPress={() => navigate({ name: 'settings' })} onFocused={p.onFocused} />
    </FocusGroup>
  );
}
