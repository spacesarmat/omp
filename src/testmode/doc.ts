// Renders docs/screen-codes.md from the registry. Imported by tests only, so the FAQ texts stay out of the TV bundle.
import { FAQ_EN } from '../faq/faq.en';
import { FAQ_RU } from '../faq/faq.ru';
import { elementTypesDoc } from './elements';
import { dialogs, screens, type CodeOption, type RegItem } from './registry';

function clean(s: string): string {
  return s
    .replace(/\u2013/g, '-')
    .replace(/\u2014/g, '-')
    .replace(/\u2212/g, '-')
    .replace(/\|/g, '/')
    .replace(/\s+/g, ' ')
    .trim();
}

function faqRu(id: string): string {
  const row = FAQ_RU[id];
  return row && row.q ? clean(row.q) : id;
}

function faqEn(id: string): string {
  const row = FAQ_EN[id];
  return row && row.q ? clean(row.q) : id;
}

function itemRu(it: RegItem): string {
  return it.faqId ? faqRu(it.faqId) : clean(it.ru);
}

function itemEn(it: RegItem): string {
  return it.faqId ? faqEn(it.faqId) : clean(it.en);
}

interface Row {
  code: string;
  whereRu: string;
  whereEn: string;
  itemRu: string;
  itemEn: string;
}

function family(code: string): number {
  if (code.indexOf('PD') === 0) return 3;
  if (code.indexOf('AD') === 0) return 5;
  const c = code.charAt(0);
  if (c === 'S') return 0;
  if (c === 'D') return 1;
  if (c === 'P') return 2;
  if (c === 'A') return 4;
  return 9;
}

function parts(code: string): number[] {
  let rest = code;
  if (rest.indexOf('PD') === 0 || rest.indexOf('AD') === 0) rest = rest.slice(2);
  else rest = rest.slice(1);
  const raw = rest.split('.');
  const out: number[] = [];
  for (let i = 0; i < raw.length; i++) out.push(parseInt(raw[i], 10) || 0);
  return out;
}

function cmp(a: string, b: string): number {
  const ra = family(a);
  const rb = family(b);
  if (ra !== rb) return ra - rb;
  const pa = parts(a);
  const pb = parts(b);
  const n = pa.length > pb.length ? pa.length : pb.length;
  for (let i = 0; i < n; i++) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da !== db) return da - db;
  }
  return 0;
}

function pushItem(rows: Row[], whereRu: string, whereEn: string, it: RegItem): void {
  rows.push({ code: it.code, whereRu: whereRu, whereEn: whereEn, itemRu: itemRu(it), itemEn: itemEn(it) });
  const options: CodeOption[] = it.options || [];
  for (let i = 0; i < options.length; i++) {
    const o = options[i];
    rows.push({
      code: o.code,
      whereRu: whereRu,
      whereEn: whereEn,
      itemRu: clean(it.ru) + ' - ' + clean(o.ru),
      itemEn: clean(it.en) + ' - ' + clean(o.en),
    });
  }
}

function cell(s: string): string {
  return s.replace(/\|/g, '/');
}

/** The markdown table. Tests require docs/screen-codes.md to equal this string. */
export function renderScreenCodesDoc(): string {
  const rows: Row[] = [];
  const list = screens();
  for (let s = 0; s < list.length; s++) {
    const screen = list[s];
    rows.push({ code: screen.code, whereRu: clean(screen.ru), whereEn: clean(screen.en), itemRu: '', itemEn: '' });
    for (let i = 0; i < screen.items.length; i++) pushItem(rows, clean(screen.ru), clean(screen.en), screen.items[i]);
  }
  const ds = dialogs();
  for (let d = 0; d < ds.length; d++) {
    const dialog = ds[d];
    rows.push({ code: dialog.code, whereRu: clean(dialog.ru), whereEn: clean(dialog.en), itemRu: '', itemEn: '' });
    for (let i = 0; i < dialog.items.length; i++) pushItem(rows, clean(dialog.ru), clean(dialog.en), dialog.items[i]);
  }
  rows.sort((a, b) => cmp(a.code, b.code));

  const lines = [
    '# Screen codes',
    '',
    'Stable codes for test mode.',
    '',
    '- `S` / `D` - TV web UI on LG webOS and on Android TV (the shared WebView).',
    '- `P` / `PD` - the phone app: screens, and sheets or confirms.',
    '- `A` / `AD` - native Android TV surfaces outside the WebView: the player (`PlayerActivity`) and the Cloudflare / site-login dialog. The box WebView stays on `S` / `D`.',
    '',
    'A beta build (`x.y.z-beta.N`, `isBetaVersion` in `src/lib/version.ts`) shows the setting «Режим тестирования» / "Test mode" (`settings.testMode`) on the TV and on the phone. Labels appear only when that switch is on. A stable build hides the switch and every label, even if `testMode` was left on. The native player and the native Cloudflare dialog read the same switch and check the app version again. Sign-in in the browser uses that same dialog (`AD06` on the box, `PD53` on the phone).',
    '',
    'Codes are assigned in `src/testmode/registry.ts` (phone and native lists in `src/testmode/extra.ts`). Do not renumber an existing code. Append a new one.',
    '',
    'Posters, files, episodes, search hits, subscriptions, user servers and track lists have no fixed code: they change with the library. They get element codes instead (see «Element codes» below), counted on the page.',
    '',
    'Labels come in three sizes, «Маленький» / «Средний» / «Крупный» (`settings.testLabelSize`, beta only, next to the switch). TV web UI and the native Android TV player: 24 / 28 / 36 px (never under 24 px). Phone: 16 / 24 / 32 px.',
    '',
    '| Code | Where (ru) | Where (en) | Item (ru) | Item (en) |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    lines.push('| ' + [r.code, r.whereRu, r.whereEn, r.itemRu, r.itemEn].map(cell).join(' | ') + ' |');
  }
  lines.push('');
  const el = elementTypesDoc();
  for (let i = 0; i < el.length; i++) lines.push(el[i]);
  return lines.join('\n');
}
