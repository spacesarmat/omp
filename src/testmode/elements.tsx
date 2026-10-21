// Element codes for test mode: posters, cards, list rows, tabs, buttons, fields and rows of a screen.
// They are counted from the page in DOM order, so they follow the library: «S03.R2.P#4» is the fourth
// poster in the second row of S03 (or of the open dialog D12 / sheet PD07). An element outside a row
// is «S03.P#4». Controls that already have a fixed code (S05.3, P11.19) are skipped.
// The labels live in one overlay layer: they take no space, ignore the pointer and the remote,
// and the app's own markup is never changed.
import { useEffect, useRef } from 'preact/hooks';
import { testLabelSize, testLabels, TEST_LABEL_SIZES } from './active';

export interface ElementType {
  /** Letter in the code. */
  type: string;
  ru: string;
  en: string;
  /** Selectors in the TV web UI (S / D). */
  tv: string;
  /** Selectors in the phone app (P / PD). */
  phone: string;
  /** Where the label sits on the element. */
  place: 'top' | 'bottom' | 'above';
}

/** Order matters only for the docs. Do not change a letter: testers cite them across builds. */
export const ELEMENT_TYPES: ElementType[] = [
  {
    type: 'R',
    ru: 'Ряд, полка, сетка или список',
    en: 'Row, shelf, grid or list',
    tv: '.disc-results, .views-tiles, .views-rows, .tc-cast-row, .series-seasons-row, .series-episodes, .faq-chips, .topbar-tabs, .better-list, .src-list, .whatsnew-list',
    phone: '.m-disc-rail, .m-disc-grid, .m-grid, .m-art-grid, .m-list, .m-vlist, .m-clist, .m-results, .m-chips, .m-tabs, .m-tc-episodes, .m-series-rows, .m-now-ep-rail, .m-better-list, .m-srch-list',
    place: 'above',
  },
  {
    type: 'P',
    ru: 'Постер или обложка',
    en: 'Poster or cover',
    tv: '.art, .disc-poster, .series-poster, .person-photo',
    phone: '.m-poster, .m-disc-poster, .m-tc-poster, .m-srch-poster, .m-cal-poster, .m-sh-poster, .m-mini-poster, .m-rel-thumb, .m-now-poster',
    place: 'top',
  },
  {
    type: 'C',
    ru: 'Карточка (плитка)',
    en: 'Card (tile)',
    tv: '.tile, .disc-tile, .hcard, .news-card, .tc-person, .connect-card, .hist-card',
    phone: '.m-card, .m-disc-tile, .m-disc-rail-tile, .m-result-card, .m-ep-card, .m-tc-cast, .m-idx-card, .m-src-card',
    place: 'bottom',
  },
  {
    type: 'L',
    ru: 'Строка списка (раздача, файл, серия, результат поиска)',
    en: 'List row (torrent, file, episode, search hit)',
    tv: '.lrow, .crow, .file-row, .ep-row, .search-result, .better-row, .list-item, .src-row, .dialog-option',
    phone: '.m-crow, .m-hrow, .m-vrow, .m-srch-row, .m-cal-row, .m-tc-ep-row, .m-server-row, .m-result, .m-sheet-row, .m-log-row',
    place: 'top',
  },
  {
    type: 'T',
    ru: 'Вкладка или чип',
    en: 'Tab or chip',
    tv: '.tab, .season-chip, .search-chip, .faq-chip, .disc-kind',
    phone: '.m-tab, .m-chip, .m-seg-btn, .m-cal-chip',
    place: 'top',
  },
  {
    type: 'B',
    ru: 'Кнопка без своего кода',
    en: 'Button without its own code',
    tv: '.button, .icon-button, .player-btn, .disc-btn',
    phone: '.m-btn, .m-icon-btn, .m-iconbtn, .m-head-btn, .m-link-btn, .m-mini-btn, .m-rc-btn',
    place: 'top',
  },
  {
    type: 'I',
    ru: 'Поле ввода',
    en: 'Input field',
    tv: '.text-input',
    phone: '.m-input, .m-addr-input',
    place: 'top',
  },
  {
    type: 'G',
    ru: 'Полоса прогресса или перемотки',
    en: 'Progress or seek bar',
    tv: '.player-bar',
    phone: '.m-seek, .m-bar-track, .m-now-seek',
    place: 'top',
  },
];

export interface ElementLabel {
  code: string;
  el: Element;
  place: 'top' | 'bottom' | 'above';
  /** The row the element is in: a label outside the row's box (scrolled away) is not painted. */
  row?: Element;
}

function hasClass(el: Element, name: string): boolean {
  return !!el.classList && el.classList.contains(name);
}

/** A control with a fixed code already shows it; the element pass leaves it alone. */
function skip(el: Element, phone: boolean): boolean {
  if (hasClass(el, 'test-anchor') || hasClass(el, 'test-el')) return true;
  if (phone && el.hasAttribute('data-code')) return true;
  let p: Element | null = el;
  while (p) {
    if (hasClass(p, 'test-el-layer') || hasClass(p, 'test-screen-badge')) return true;
    p = p.parentElement;
  }
  return false;
}

const DIALOG_CODE = /^(D|PD|AD)[0-9]+$/;

/** Code of the dialog or sheet the element is in, or ''. */
function containerCode(el: Element, phone: boolean): string {
  let p: Element | null = el.parentElement;
  while (p) {
    if (phone) {
      const c = p.getAttribute('data-code');
      if (c && DIALOG_CODE.test(c)) return c;
    } else if (hasClass(p, 'dialog')) {
      for (let i = 0; i < p.children.length; i++) {
        const ch = p.children[i];
        if (hasClass(ch, 'test-badge')) {
          const c = (ch.textContent || '').trim();
          if (DIALOG_CODE.test(c)) return c;
        }
      }
      return '';
    }
    p = p.parentElement;
  }
  return '';
}

function toArray(list: NodeListOf<Element>): Element[] {
  const out: Element[] = [];
  for (let i = 0; i < list.length; i++) out.push(list[i]);
  return out;
}

/** A poster inside a poster (the `.art` fallback in `.series-poster`) is one poster. */
function insideSameType(el: Element, selector: string): boolean {
  let p: Element | null = el.parentElement;
  while (p) {
    if (matches(p, selector)) return true;
    p = p.parentElement;
  }
  return false;
}

function matches(el: Element, selector: string): boolean {
  const m = el.matches || (el as unknown as { webkitMatchesSelector?: (s: string) => boolean }).webkitMatchesSelector;
  return !!m && m.call(el, selector);
}

function closestIn(el: Element, set: Element[]): Element | null {
  let p: Element | null = el.parentElement;
  while (p) {
    if (set.indexOf(p) >= 0) return p;
    p = p.parentElement;
  }
  return null;
}

/**
 * Every element code on the page under `root`, in DOM order. `screen` is the open screen's code.
 * Pure DOM: the tests call it on a rendered screen.
 */
export function collectElementLabels(root: Element, screen: string, phone: boolean): ElementLabel[] {
  if (!screen) return [];
  const out: ElementLabel[] = [];
  const rowType = ELEMENT_TYPES[0];
  const rowSel = phone ? rowType.phone : rowType.tv;
  const rows = toArray(root.querySelectorAll(rowSel)).filter((el) => !skip(el, phone) && !insideSameType(el, rowSel));
  const rowCode: Element[] = [];
  const rowName: string[] = [];
  const counters: { [k: string]: number } = {};
  const next = (key: string): number => {
    counters[key] = (counters[key] || 0) + 1;
    return counters[key];
  };
  for (let i = 0; i < rows.length; i++) {
    const prefix = containerCode(rows[i], phone) || screen;
    const n = next(prefix + '.R');
    rowCode.push(rows[i]);
    rowName.push(prefix + '.R' + n);
    out.push({ code: prefix + '.R#' + n, el: rows[i], place: 'above' });
  }
  for (let t = 1; t < ELEMENT_TYPES.length; t++) {
    const type = ELEMENT_TYPES[t];
    const sel = phone ? type.phone : type.tv;
    const els = toArray(root.querySelectorAll(sel));
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      if (skip(el, phone) || insideSameType(el, sel)) continue;
      const row = closestIn(el, rowCode);
      const base = row ? rowName[rowCode.indexOf(row)] : containerCode(el, phone) || screen;
      out.push({ code: base + '.' + type.type + '#' + next(base + '.' + type.type), el: el, place: type.place, row: row || undefined });
    }
  }
  return out;
}

const MAX_LABELS = 400;

function screenCode(): string {
  const b = document.querySelector('.test-screen-badge .test-badge');
  return b ? (b.textContent || '').trim() : '';
}

/**
 * The open dialog or sheet, if any: only its elements are labelled, the page under it is covered.
 * The last one in the DOM is the one on top.
 */
export function activeWindow(root: Element, phone: boolean): Element | null {
  const list = root.querySelectorAll(phone ? '[role="dialog"]' : '.dialog');
  return list.length ? list[list.length - 1] : null;
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function box(el: Element): Box {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}

function overlaps(a: Box, b: Box): boolean {
  return a.right > b.left && a.bottom > b.top && a.left < b.right && a.top < b.bottom;
}

/**
 * Draws the labels for the visible elements into `layer`. All positions are read first and the
 * spans written after, with one shared label height, so an old TV lays the page out about once.
 */
export function paintElementLabels(layer: HTMLElement, phone: boolean): void {
  const root: Element | null = phone ? document.body : document.querySelector('.app');
  const win = root ? activeWindow(root, phone) : null;
  const labels = root ? collectElementLabels(win || root, screenCode(), phone) : [];
  // TV: the .app root is scaled to the panel (4K), the layer sits inside it in 1920 coordinates
  let ox = 0;
  let oy = 0;
  let scale = 1;
  if (!phone && root) {
    const r = root.getBoundingClientRect();
    const w = (root as HTMLElement).offsetWidth || r.width;
    ox = r.left;
    oy = r.top;
    scale = w > 0 && r.width > 0 ? r.width / w : 1;
  }
  const view: Box = { left: 0, top: 0, right: window.innerWidth || 0, bottom: window.innerHeight || 0 };
  // 1. read
  const rowBoxes: { el: Element; b: Box }[] = [];
  const rowBox = (row: Element): Box => {
    for (let i = 0; i < rowBoxes.length; i++) if (rowBoxes[i].el === row) return rowBoxes[i].b;
    const b = box(row);
    rowBoxes.push({ el: row, b: b });
    return b;
  };
  const shown: { code: string; place: string; b: Box }[] = [];
  for (let i = 0; i < labels.length && shown.length < MAX_LABELS; i++) {
    const b = box(labels[i].el);
    if (b.right - b.left <= 0 || b.bottom - b.top <= 0) continue;
    if (!overlaps(b, view)) continue;
    const row = labels[i].row;
    if (row && !overlaps(b, rowBox(row))) continue;
    shown.push({ code: labels[i].code, place: labels[i].place, b: b });
  }
  // 2. write the texts
  for (let i = 0; i < shown.length; i++) {
    let span = layer.children[i] as HTMLElement | undefined;
    if (!span) {
      span = document.createElement('span');
      span.className = 'test-el';
      layer.appendChild(span);
    }
    if (span.textContent !== shown[i].code) span.textContent = shown[i].code;
    span.setAttribute('data-place', shown[i].place);
  }
  while (layer.children.length > shown.length) layer.removeChild(layer.lastChild as Node);
  // 3. one height for all labels (same font), then 4. write the positions
  const first = layer.children[0] as HTMLElement | undefined;
  const h = first ? first.offsetHeight || 0 : 0;
  for (let i = 0; i < shown.length; i++) {
    const span = layer.children[i] as HTMLElement;
    const b = shown[i].b;
    const x = (b.left - ox) / scale;
    const top = (b.top - oy) / scale;
    const bottom = (b.bottom - oy) / scale;
    let y = top;
    if (shown[i].place === 'bottom') y = bottom - h;
    else if (shown[i].place === 'above') y = top - h >= 0 ? top - h : top;
    span.style.left = Math.round(x) + 'px';
    span.style.top = Math.round(y) + 'px';
  }
}

/** Paints `body.test-size-*` while labels are on: CSS picks the label size from it. */
export function syncSizeClass(on: boolean, size: string): void {
  const body = document.body;
  for (let i = 0; i < TEST_LABEL_SIZES.length; i++) {
    const s = TEST_LABEL_SIZES[i];
    body.classList.toggle('test-size-' + s, on && s === size);
  }
}

/** The overlay with element codes, and the size class. Mount once per app, inside `.app` on the TV. */
export function ElementLabelsHost(p: { phone?: boolean }) {
  const on = testLabels.value;
  const size = testLabelSize.value;
  const phone = !!p.phone;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    syncSizeClass(on, size);
    return () => syncSizeClass(false, size);
  }, [on, size]);
  useEffect(() => {
    if (!on) return undefined;
    let timer = 0;
    const run = () => {
      timer = 0;
      if (ref.current) paintElementLabels(ref.current, phone);
    };
    const schedule = () => {
      if (!timer) timer = window.setTimeout(run, 250);
    };
    let mo: MutationObserver | null = null;
    if (typeof MutationObserver !== 'undefined') {
      mo = new MutationObserver((records) => {
        const layer = ref.current;
        for (let i = 0; i < records.length; i++) {
          if (!layer || !layer.contains(records[i].target)) {
            schedule();
            return;
          }
        }
      });
      mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
    }
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    schedule();
    return () => {
      if (timer) window.clearTimeout(timer);
      if (mo) mo.disconnect();
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
    };
  }, [on, size, phone]);
  if (!on) return null;
  return <div class="test-el-layer" ref={ref} aria-hidden="true" />;
}

/** The element type table for docs/screen-codes.md. */
export function elementTypesDoc(): string[] {
  const lines = [
    '## Element codes',
    '',
    'Besides the fixed codes above, test mode labels the elements of a screen: posters, cards, list rows, tabs, buttons without their own code, fields and rows. They are counted on the page in screen order, so they follow the library and are meant for a report about what is on screen now.',
    '',
    '- `S03.P#4` - the fourth poster on screen S03 (outside any row).',
    '- `S03.R#2` - the second row (shelf, grid or list) on S03. Its label sits just above it.',
    '- `S03.R2.P#4` - the fourth poster in that row. `S03.R2.C#4` is the fourth card in it.',
    '- Inside an open dialog or sheet the dialog code replaces the screen: `D12.L#3`, `PD07.B#1`. While it is open, only its elements are labelled.',
    '- The element labels are blue, fixed codes stay dark. A control with a fixed code (`S05.3`, `P11.19`) gets no element label.',
    '- The size follows «Размер меток» / "Label size" (`S05.30`, `P11.20`). The native Android TV player (`A01`, `AD01`-`AD06`) has fixed codes only and uses the same size.',
    '',
    '| Type | Element (ru) | Element (en) |',
    '| --- | --- | --- |',
  ];
  for (let i = 0; i < ELEMENT_TYPES.length; i++) {
    const t = ELEMENT_TYPES[i];
    lines.push('| `' + t.type + '` | ' + t.ru + ' | ' + t.en + ' |');
  }
  lines.push('');
  return lines;
}
