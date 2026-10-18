import { doesFocusableExist } from '@noriginmedia/norigin-spatial-navigation';
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
import { barArrow, stepKey } from './focus';

const ICON_KEYS = ['lib-btn-search', 'lib-btn-view', 'lib-btn-sort', 'lib-btn-add', 'lib-btn-playlist', 'lib-btn-settings'];

/** Tabs then icons, left to right. Geometry skips across the scroll clip; this order does not. */
export function topBarKeys(): string[] {
  return tvLibraryTabs().map((tb) => 'tab-' + tb.id).concat(ICON_KEYS);
}

function keyEnabled(key: string): boolean {
  if (!doesFocusableExist(key)) return false;
  const el = document.querySelector('[data-fk="' + key + '"]');
  return !el || !el.classList.contains('disabled');
}

/** Something under the bar can take Down. An empty tab has only the bar, and Down must stay there. */
function contentBelow(): boolean {
  const list = document.querySelectorAll('.screen [data-fk]');
  for (let i = 0; i < list.length; i++) {
    const el = list[i] as HTMLElement;
    if (typeof el.closest === 'function' && el.closest('.topbar')) continue;
    if (el.classList.contains('disabled')) continue;
    return true;
  }
  return false;
}

function syncFade(box: HTMLElement): void {
  const viewL = box.scrollLeft;
  let partial = false;
  const tabs = box.querySelectorAll('.tab');
  for (let i = 0; i < tabs.length; i++) {
    const el = tabs[i] as HTMLElement;
    const left = el.offsetLeft;
    const right = left + el.offsetWidth;
    if (right <= viewL + 1) continue;
    partial = left < viewL - 1;
    break;
  }
  box.classList.toggle('fade-left', partial);
  box.classList.toggle('fade-right', box.scrollLeft + box.clientWidth < box.scrollWidth - 2);
}

/**
 * The focused tab stays fully in the strip. Then scroll sits on a tab boundary, so the left edge
 * never shows a cut-off word («тория») beside the logo.
 */
export function alignTabStrip(box: HTMLElement, focusKey?: string): void {
  const focusEl = (focusKey
    ? box.querySelector('[data-fk="' + focusKey + '"]')
    : box.querySelector('.tab.focused')) as HTMLElement | null;
  const view = box.clientWidth;
  const max = Math.max(0, box.scrollWidth - view);
  let scroll = box.scrollLeft;
  if (focusEl && view > 0) {
    const left = focusEl.offsetLeft;
    const right = left + focusEl.offsetWidth;
    if (left < scroll) scroll = left;
    else if (right > scroll + view) scroll = Math.max(0, right - view);
  }
  const tabs = box.querySelectorAll('.tab');
  let boundary = scroll;
  for (let i = 0; i < tabs.length; i++) {
    const left = (tabs[i] as HTMLElement).offsetLeft;
    if (left + 1 < scroll) continue;
    boundary = left;
    break;
  }
  if (focusEl && boundary > focusEl.offsetLeft) boundary = focusEl.offsetLeft;
  if (boundary < 0) boundary = 0;
  if (boundary > max) boundary = max;
  box.scrollLeft = boundary;
  syncFade(box);
}

/** Set only when the remote or a click moves to a tab. A programmatic focus must not switch the library. */
let armedTab = '';

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
  const keys = topBarKeys();
  const arrow = (key: string) => {
    const inner = barArrow(keys, key, contentBelow, keyEnabled);
    return (dir: string) => {
      if (dir === 'left' || dir === 'right') {
        const next = stepKey(keys, key, dir === 'right' ? 1 : -1, keyEnabled);
        armedTab = next && next.indexOf('tab-') === 0 ? next : '';
      }
      return inner(dir);
    };
  };
  const showTab = (id: string) => {
    const box = tabsRef.current;
    if (box) alignTabStrip(box, 'tab-' + id);
  };
  useEffect(() => {
    if (tabsRef.current) alignTabStrip(tabsRef.current, 'tab-' + p.tab);
    return () => { armedTab = ''; };
  }, []);
  return (
    <FocusGroup focusKey="LIB-HEADER" className="topbar">
      <div class="topbar-home">
        <Logo size={52} />
        <span class="topbar-brand">OMP</span>
        {/* the TV's name under the logo: absolutely placed, so the bar keeps its height and the tabs their place */}
        {device && <span class="topbar-device" title={device}>{tvGlyphs(device)}</span>}
      </div>
      <div class="topbar-tabs-clip">
        <div class="topbar-tabs" ref={tabsRef}>
          {tvLibraryTabs().map((tb) => (
            <Focusable
              key={tb.id}
              focusKey={'tab-' + tb.id}
              className={'tab' + (p.tab === tb.id ? ' active' : '')}
            onPress={() => { armedTab = 'tab-' + tb.id; p.onTab(tb.id); }}
            onArrow={arrow('tab-' + tb.id)}
            onFocused={() => {
              const mine = 'tab-' + tb.id;
              const picked = armedTab === mine;
              if (picked) armedTab = '';
              // focusing «История» from a closed dialog must not leave «Все»
              if (picked) p.onTab(tb.id);
              if (picked || p.tab === tb.id) showTab(tb.id);
              p.onFocused();
            }}
            >
              {tb.id === 'history' && <Icon name="history" size={24} class="tab-icon" />}
              {tb.label}
              {tb.id === 'news' && unseen > 0 && <span class="tab-badge">{unseen > 99 ? '99+' : String(unseen)}</span>}
            </Focusable>
          ))}
          <span class="topbar-tabs-pad" />
        </div>
      </div>
      <div class="topbar-tools">
        <IconButton focusKey="lib-btn-search" icon="search" label={p.searchOpen ? t('tv.topbar.closeSearch') : t('tv.topbar.search')} onPress={p.onSearch} onFocused={p.onFocused} onArrow={arrow('lib-btn-search')} expand disabled={discover} />
        <IconButton focusKey="lib-btn-view" icon={listView ? 'list' : 'grid'} label={t('tv.topbar.view', { name: viewLabel(p.view) })} onPress={p.onView} onFocused={p.onFocused} onArrow={arrow('lib-btn-view')} expand disabled={p.tab === 'history' || discover} />
        <IconButton focusKey="lib-btn-sort" icon="sort" label={t('tv.topbar.sort', { name: sortLabel(p.sort) })} onPress={p.onSort} onFocused={p.onFocused} onArrow={arrow('lib-btn-sort')} expand disabled={discover} />
        <IconButton focusKey="lib-btn-add" icon="plus" label={t('add.findRelease')} onPress={() => navigate({ name: 'add' })} onFocused={p.onFocused} onArrow={arrow('lib-btn-add')} expand />
        <IconButton focusKey="lib-btn-playlist" icon="playlist" label={t('tv.topbar.playlists')} onPress={() => navigate({ name: 'playlist' })} onFocused={p.onFocused} onArrow={arrow('lib-btn-playlist')} expand labelEdge="end" />
        <IconButton focusKey="lib-btn-settings" icon="settings" label={t('common.settings')} onPress={() => navigate({ name: 'settings' })} onFocused={p.onFocused} onArrow={arrow('lib-btn-settings')} expand labelEdge="end" dot={!!latestUpdate.value} />
      </div>
    </FocusGroup>
  );
}
