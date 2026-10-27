// Element codes for test mode: posters, cards, list rows, tabs, buttons, fields and rows of a screen.
// They are counted from the page in DOM order, so they follow the library: «S03.R2.P#4» is the fourth
// poster in the second row of S03 (or of the open dialog D12 / sheet PD07). An element outside a row
// is «S03.P#4». Controls that already have a fixed code (S05.3, P11.19) are skipped.
// The labels live in one overlay layer: they take no space, ignore the pointer and the remote,
// and the app's own markup is never changed.
import { useEffect, useRef } from 'preact/hooks';
import { testLabelPx, testLabels } from './active';

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
  if (phone) {
    paintPhonePositions(layer, shown, labels, h, view, win);
    return;
  }
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

/** Phone chrome that stays on screen over the scrolled page: the tab bar, the mini player, the keypad. */
export const PHONE_CHROME = '.m-nav, .m-mini, .m-keypad';
/** Phone controls a row label must not cover. A `[data-code]` control also has its own badge above its top edge. */
export const PHONE_CONTROLS = 'button, a[href], input, select, textarea, [role="button"], [role="tab"], [data-code]';

export interface PhoneLabelInput {
  /** The element's box (viewport px). */
  b: Box;
  place: 'top' | 'bottom' | 'above' | string;
  /** The label's own width. */
  w: number;
  /** Index of the chrome box the element itself is in, -1 when it is in the page. */
  inChrome: number;
}

/**
 * Phone label positions, null for a label that is not painted. Landscape leaves little room, so:
 * - a label is never painted over the tab bar, the mini player or the keypad unless its element is in it
 *   (an element scrolled under the tab bar keeps its label hidden);
 * - a row label (`R#`) goes above the row's left end, else above its right end, else inside the row's top or
 *   bottom right corner; the first spot that covers no control (and no control's own badge) wins. With no free
 *   spot the row label is not painted: its posters and chips still carry their codes.
 * Other labels stay on their own element (pulled into the screen at an edge). Pure: the tests call it with plain boxes.
 */
export function placePhoneLabels(items: PhoneLabelInput[], h: number, view: Box, chrome: Box[], controls: Box[]): ({ x: number; y: number } | null)[] {
  const out: ({ x: number; y: number } | null)[] = [];
  const free = (lb: Box, item: PhoneLabelInput, row: boolean): boolean => {
    if (lb.left < view.left || lb.top < view.top || lb.right > view.right || lb.bottom > view.bottom) return false;
    for (let c = 0; c < chrome.length; c++) if (c !== item.inChrome && overlaps(lb, chrome[c])) return false;
    if (row) for (let c = 0; c < controls.length; c++) if (overlaps(lb, controls[c])) return false;
    return true;
  };
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const b = it.b;
    const w = Math.max(0, it.w);
    const spots: { x: number; y: number }[] = [];
    if (it.place === 'above') {
      const right = Math.max(b.left, b.right - w);
      spots.push({ x: b.left, y: b.top - h }, { x: right, y: b.top - h }, { x: right, y: b.top }, { x: right, y: b.bottom - h });
    } else {
      // on its own element, pulled into the screen when the element is cut by an edge (a rail scrolled sideways)
      const y = it.place === 'bottom' ? b.bottom - h : b.top;
      spots.push({ x: Math.max(view.left, Math.min(b.left, view.right - w)), y: Math.max(view.top, Math.min(y, view.bottom - h)) });
    }
    let pick: { x: number; y: number } | null = null;
    for (let s = 0; s < spots.length && !pick; s++) {
      const p = spots[s];
      if (free({ left: p.x, top: p.y, right: p.x + w, bottom: p.y + h }, it, it.place === 'above')) pick = p;
    }
    out.push(pick);
  }
  return out;
}

function visibleBox(el: Element, view: Box): Box | null {
  const b = box(el);
  if (b.right - b.left <= 0 || b.bottom - b.top <= 0 || !overlaps(b, view)) return null;
  return b;
}

/** Phone pass of paintElementLabels: reads the chrome, the controls and the label widths, then places or drops each label. */
function paintPhonePositions(layer: HTMLElement, shown: { code: string; place: string; b: Box }[], labels: ElementLabel[], h: number, view: Box, win: Element | null): void {
  // An open sheet or dialog sits above the tab bar and covers the page: only its own controls count then,
  // not the backdrop button, the sheet box itself or the page under it.
  const chromeEls = win ? [] : toArray(document.querySelectorAll(PHONE_CHROME));
  const chrome: Box[] = [];
  const chromeOf: Element[] = [];
  for (let i = 0; i < chromeEls.length; i++) {
    const b = visibleBox(chromeEls[i], view);
    if (b) {
      chrome.push(b);
      chromeOf.push(chromeEls[i]);
    }
  }
  const controls: Box[] = [];
  const ctrlEls = toArray((win || document).querySelectorAll(PHONE_CONTROLS));
  // the fixed-code badge hangs above its control by about half a label (translateY(-55%) in mobile.css)
  const badge = Math.ceil(h * 0.6);
  if (win && win.hasAttribute('data-code')) {
    // the sheet's own code (PD21) sits on its top edge: keep that strip free, not the whole sheet
    const wb = visibleBox(win, view);
    if (wb) controls.push({ left: wb.left, top: wb.top - badge, right: wb.right, bottom: wb.top + h - badge });
  }
  for (let i = 0; i < ctrlEls.length; i++) {
    if (layer.contains(ctrlEls[i])) continue;
    const b = visibleBox(ctrlEls[i], view);
    if (!b) continue;
    if (ctrlEls[i].hasAttribute('data-code')) b.top -= badge;
    controls.push(b);
  }
  const byCode: { [code: string]: Element } = {};
  for (let i = 0; i < labels.length; i++) byCode[labels[i].code] = labels[i].el;
  const items: PhoneLabelInput[] = [];
  for (let i = 0; i < shown.length; i++) {
    const el = byCode[shown[i].code];
    let inChrome = -1;
    for (let c = 0; c < chromeOf.length && el; c++) if (chromeOf[c].contains(el)) inChrome = c;
    items.push({ b: shown[i].b, place: shown[i].place, w: (layer.children[i] as HTMLElement).offsetWidth || 0, inChrome: inChrome });
  }
  const spots = placePhoneLabels(items, h, view, chrome, controls);
  for (let i = spots.length - 1; i >= 0; i--) {
    const span = layer.children[i] as HTMLElement;
    const p = spots[i];
    if (!p) {
      layer.removeChild(span);
      continue;
    }
    span.style.left = Math.round(p.x) + 'px';
    span.style.top = Math.round(p.y) + 'px';
  }
}

const SIZE_STYLE_ID = 'test-label-size';

/** CSS for one label size. Added after the app styles, so it wins over the default size. */
export function labelSizeCss(px: number, phone: boolean): string {
  const rule = '{ font-size: ' + px + 'px; line-height: ' + (px + 4) + 'px; }';
  if (phone) {
    return 'body.test-labels [data-code]::after, .test-screen-badge .test-badge, .test-el ' + rule;
  }
  return '.test-badge, .test-screen-badge .test-badge, .test-el ' + rule;
}

/** Writes (or removes) the size rules in one <style> at the end of <head>. */
export function syncSizeStyle(on: boolean, px: number, phone: boolean): void {
  let el = document.getElementById(SIZE_STYLE_ID);
  if (!on) {
    if (el && el.parentNode) el.parentNode.removeChild(el);
    return;
  }
  if (!el) {
    el = document.createElement('style');
    el.id = SIZE_STYLE_ID;
    (document.head || document.body).appendChild(el);
  }
  const css = labelSizeCss(px, phone);
  if (el.textContent !== css) el.textContent = css;
}

/** The overlay with element codes, and the size style. Mount once per app, inside `.app` on the TV. */
export function ElementLabelsHost(p: { phone?: boolean }) {
  const phone = !!p.phone;
  const on = testLabels.value;
  const size = testLabelPx.value;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    syncSizeStyle(on, size, phone);
    return () => syncSizeStyle(false, size, phone);
  }, [on, size, phone]);
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
    '- The size follows the «Размер меток» / "Label size" slider (`S05.30`, `P11.20`). The native Android TV player (`A01`, `AD01`-`AD06`) has fixed codes only and gets the same px value.',
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
