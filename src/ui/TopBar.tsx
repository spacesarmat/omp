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

export interface TabBox { left: number; width: number; }

/**
 * Scroll the focused tab fully into the strip, then hide every tab that is still not completely
 * inside the visible range. Chrome 53 does not count a flex end spacer in scrollWidth (the TV strip
 * is 1139px, the tabs 1215px, and the maximum scroll stays 76px), so padding cannot uncover a partial
 * tab. Hiding does not depend on that, and nothing here grows.
 */
export function tabStripPlan(o: {
  scrollLeft: number;
  clientWidth: number;
  scrollWidth: number;
  focus: TabBox | null;
  tabs: TabBox[];
}): { scrollLeft: number; hide: boolean[] } {
  const view = o.clientWidth;
  const max = Math.max(0, o.scrollWidth - view);
  let scroll = o.scrollLeft;
  if (o.focus && view > 0) {
    const left = o.focus.left;
    const right = left + o.focus.width;
    if (o.focus.width <= view) {
      if (left < scroll) scroll = left;
      else if (right > scroll + view) scroll = right - view;
    } else if (left < scroll || left > scroll + view) {
      scroll = left;
    }
  }
  if (scroll < 0) scroll = 0;
  if (scroll > max) scroll = max;
  const hide: boolean[] = [];
  for (let i = 0; i < o.tabs.length; i++) {
    const t = o.tabs[i];
    const right = t.left + t.width;
    const full = view > 0 && t.left >= scroll - 1 && right <= scroll + view + 1;
    const focused = !!o.focus && Math.abs(o.focus.left - t.left) < 2 && Math.abs(o.focus.width - t.width) < 2;
    hide.push(!full && !focused);
  }
  return { scrollLeft: scroll, hide: hide };
}

/** The focused tab is fully in the strip. Any tab that is only partly in view is hidden. */
export function alignTabStrip(box: HTMLElement, focusKey?: string): void {
  // A spacer left over from an older build must not keep growing. Chrome 53 ignores it anyway.
  const padEl = box.querySelector('.topbar-tabs-pad') as HTMLElement | null;
  if (padEl) {
    padEl.style.width = '0px';
    padEl.style.flexBasis = '0px';
  }
  const nodes = box.querySelectorAll('.tab');
  const tabs: TabBox[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i] as HTMLElement;
    tabs.push({ left: el.offsetLeft, width: el.offsetWidth });
  }
  const focusEl = (focusKey
    ? box.querySelector('[data-fk="' + focusKey + '"]')
    : box.querySelector('.tab.focused')) as HTMLElement | null;
  const plan = tabStripPlan({
    scrollLeft: box.scrollLeft,
    clientWidth: box.clientWidth,
    scrollWidth: box.scrollWidth,
    focus: focusEl ? { left: focusEl.offsetLeft, width: focusEl.offsetWidth } : null,
    tabs: tabs,
  });
  box.scrollLeft = plan.scrollLeft;
  for (let i = 0; i < nodes.length; i++) {
    (nodes[i] as HTMLElement).style.visibility = plan.hide[i] ? 'hidden' : '';
  }
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
    // Widths are 0 on the first paint. A second pass after layout scrolls the active tab fully into the strip.
    const run = () => {
      if (tabsRef.current) alignTabStrip(tabsRef.current, 'tab-' + p.tab);
    };
    run();
    const raf = requestAnimationFrame(run);
    return () => {
      cancelAnimationFrame(raf);
      armedTab = '';
    };
  }, [p.tab]);
  return (
    // No saved child: the first Up after launch would otherwise land on «История» (closest to the origin).
    <FocusGroup focusKey="LIB-HEADER" className="topbar" saveLastFocusedChild={false} preferredChildFocusKey={'tab-' + p.tab}>
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
