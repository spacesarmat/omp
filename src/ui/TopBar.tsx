import { FocusGroup, Focusable, IconButton } from './components';
import { Icon } from './icons';
import { Logo } from './Logo';
import { navigate } from './nav';
import { t } from '../i18n';
import { tvLibraryTabs, LibraryTab, LibraryView, viewLabel } from '../lib/libraryView';
import { LibrarySort, sortLabel } from '../lib/librarySearch';
import { newsUnseen } from '../phone/monitor';
import { latestUpdate } from '../store/updates';
import { useEffect, useRef } from 'preact/hooks';
import { deviceName, loadDeviceName } from '../platform/deviceName';
import { tvGlyphs } from './tvText';
import { scrollToShow } from './focus';

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
  // «Обзор» and «Новое» have their own content under the header: no library search, view or sort
  const discover = p.tab === 'discover' || p.tab === 'news';
  const unseen = newsUnseen.value;
  useEffect(() => { void loadDeviceName(); }, []);
  const device = deviceName.value;
  const tabsRef = useRef<HTMLDivElement>(null);
  const showTab = (id: string) => {
    const box = tabsRef.current;
    const el = box ? (box.querySelector('[data-fk="tab-' + id + '"]') as HTMLElement | null) : null;
    if (!box || !el) return;
    box.scrollLeft = scrollToShow(box.scrollLeft, box.clientWidth, el.offsetLeft, el.offsetWidth, 24);
  };
  return (
    <FocusGroup focusKey="LIB-HEADER" className="topbar">
      <div class="topbar-home">
        <Logo size={52} />
        <span class="topbar-brand">OMP</span>
        {/* the TV's name under the logo: absolutely placed, so the bar keeps its height and the tabs their place */}
        {device && <span class="topbar-device" title={device}>{tvGlyphs(device)}</span>}
      </div>
      <div class="topbar-tabs" ref={tabsRef}>
        {tvLibraryTabs().map((tb) => (
          <Focusable
            key={tb.id}
            focusKey={'tab-' + tb.id}
            className={'tab' + (p.tab === tb.id ? ' active' : '')}
            onPress={() => p.onTab(tb.id)}
            onFocused={() => { showTab(tb.id); p.onTab(tb.id); p.onFocused(); }}
          >
            {tb.id === 'history' && <Icon name="history" size={24} class="tab-icon" />}
            {tb.label}
            {tb.id === 'news' && unseen > 0 && <span class="tab-badge">{unseen > 99 ? '99+' : String(unseen)}</span>}
          </Focusable>
        ))}
      </div>
      <div class="topbar-tools">
        <IconButton focusKey="lib-btn-search" icon="search" label={p.searchOpen ? t('tv.topbar.closeSearch') : t('tv.topbar.search')} onPress={p.onSearch} onFocused={p.onFocused} expand disabled={discover} />
        <IconButton focusKey="lib-btn-view" icon={listView ? 'list' : 'grid'} label={t('tv.topbar.view', { name: viewLabel(p.view) })} onPress={p.onView} onFocused={p.onFocused} expand disabled={p.tab === 'history' || discover} />
        <IconButton focusKey="lib-btn-sort" icon="sort" label={t('tv.topbar.sort', { name: sortLabel(p.sort) })} onPress={p.onSort} onFocused={p.onFocused} expand disabled={discover} />
        <IconButton focusKey="lib-btn-add" icon="plus" label={t('add.findRelease')} onPress={() => navigate({ name: 'add' })} onFocused={p.onFocused} expand />
        <IconButton focusKey="lib-btn-playlist" icon="playlist" label={t('tv.topbar.playlists')} onPress={() => navigate({ name: 'playlist' })} onFocused={p.onFocused} expand labelEdge="end" />
        <IconButton focusKey="lib-btn-settings" icon="settings" label={t('common.settings')} onPress={() => navigate({ name: 'settings' })} onFocused={p.onFocused} expand labelEdge="end" dot={!!latestUpdate.value} />
      </div>
    </FocusGroup>
  );
}
