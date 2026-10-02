import type { ComponentChildren } from 'preact';

export type IconName =
  | 'play' | 'pause' | 'prev' | 'next' | 'back10' | 'fwd10' | 'tracks' | 'stats' | 'history' | 'search'
  | 'plus' | 'settings' | 'grid' | 'list' | 'check' | 'star' | 'chevronLeft' | 'chevronRight'
  | 'sort' | 'playlist' | 'pencil' | 'chevronDown' | 'chevronUp' | 'tv' | 'phone';

const LINE: any = { fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
const SOLID: any = { fill: 'currentColor', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linejoin': 'round' };

const BODIES: { [K in IconName]: () => ComponentChildren } = {
  play: () => <path d="M8 5l11 7-11 7z" {...SOLID}></path>,
  pause: () => <g fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"></rect><rect x="14" y="5" width="4" height="14" rx="1"></rect></g>,
  prev: () => <g {...SOLID}><path d="M18 6l-9 6 9 6z"></path><rect x="5" y="6" width="2" height="12" rx="1" stroke="none"></rect></g>,
  next: () => <g {...SOLID}><path d="M6 6l9 6-9 6z"></path><rect x="17" y="6" width="2" height="12" rx="1" stroke="none"></rect></g>,
  back10: () => <g {...LINE}><path d="M4 12a8 8 0 1 0 2.3-5.6"></path><path d="M4 4v4h4"></path></g>,
  fwd10: () => <g {...LINE}><path d="M20 12a8 8 0 1 1-2.3-5.6"></path><path d="M20 4v4h-4"></path></g>,
  tracks: () => <g {...LINE}><rect x="3" y="5" width="18" height="14" rx="3"></rect><path d="M7 10h4M14 10h3M7 14h10"></path></g>,
  stats: () => <path d="M5 19v-8M12 19V5M19 19v-6" {...LINE}></path>,
  history: () => <g {...LINE}><circle cx="12" cy="12" r="8"></circle><path d="M12 8v4l3 2"></path></g>,
  search: () => <g {...LINE}><circle cx="11" cy="11" r="6"></circle><path d="M20 20l-4.5-4.5"></path></g>,
  plus: () => <path d="M12 5v14M5 12h14" {...LINE}></path>,
  settings: () => <g {...LINE}><path d="M4 7h10M18 7h2M4 17h4M12 17h8"></path><circle cx="16" cy="7" r="2"></circle><circle cx="10" cy="17" r="2"></circle></g>,
  grid: () => <g {...LINE}><rect x="4" y="4" width="7" height="7" rx="1.5"></rect><rect x="13" y="4" width="7" height="7" rx="1.5"></rect><rect x="4" y="13" width="7" height="7" rx="1.5"></rect><rect x="13" y="13" width="7" height="7" rx="1.5"></rect></g>,
  list: () => <g {...LINE}><path d="M9 6h11M9 12h11M9 18h11"></path><circle cx="4.5" cy="6" r="1"></circle><circle cx="4.5" cy="12" r="1"></circle><circle cx="4.5" cy="18" r="1"></circle></g>,
  check: () => <path d="M5 12.5l4.5 4.5L19 7" {...LINE}></path>,
  star: () => <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" {...LINE}></path>,
  chevronLeft: () => <path d="M15 5l-7 7 7 7" {...LINE}></path>,
  chevronRight: () => <path d="M9 5l7 7-7 7" {...LINE}></path>,
  sort: () => <path d="M4 6h16M4 12h11M4 18h6" {...LINE}></path>,
  playlist: () => <g {...LINE}><path d="M4 6h11M4 12h11M4 18h7"></path><path d="M16 15l5 3-5 3z"></path></g>,
  pencil: () => <path d="M4 20h4L19 9l-4-4L4 16z" {...LINE}></path>,
  chevronDown: () => <path d="M6 9l6 6 6-6" {...LINE}></path>,
  chevronUp: () => <path d="M6 15l6-6 6 6" {...LINE}></path>,
  tv: () => <path d="M3 5h18v11H3zM8 20h8" {...LINE}></path>,
  phone: () => <path d="M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM11 18h2" {...LINE}></path>,
};

export const ICON_NAMES = Object.keys(BODIES) as IconName[];

export function Icon(p: { name: IconName; size?: number; class?: string }) {
  const s = p.size || 24;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" class={'icon' + (p.class ? ' ' + p.class : '')} aria-hidden="true">
      {BODIES[p.name]()}
    </svg>
  );
}

const KEY_COLORS = { red: '#E5484D', green: '#3FB950', yellow: '#F5C518', blue: '#3D8BFF' };

export function KeyDot(p: { color: 'red' | 'green' | 'yellow' | 'blue'; size?: number }) {
  const s = p.size || 22;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" class="keydot" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill={KEY_COLORS[p.color]}></circle>
    </svg>
  );
}
