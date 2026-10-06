import { useEffect, useRef, useState } from 'preact/hooks';
import { setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { FocusGroup, Focusable } from '../ui/components';
import { Qr } from '../ui/Qr';
import { platformKind } from '../platform/env';
import { FAQ, SECTIONS, itemFor, type Device, type FaqItem, type FaqLine, type SectionId } from '../faq/faq';
import { t } from '../i18n';

const URL_RE = /https?:\/\/[^\s)]+/;
const STEP_RE = /^(\d+)\.\s+/;
/** Inner padding of the question panel: a focused row keeps this much room to the panel edge. */
export const LIST_PAD = 18;

function lineText(l: FaqLine): string {
  return typeof l === 'string' ? l : l.text + ' ' + l.url;
}

/** The first URL in the answer: an explicit link line, or a URL inside a text line. */
export function firstUrl(lines: FaqLine[]): string | null {
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (typeof l !== 'string') return l.url;
    const m = URL_RE.exec(l);
    if (m) return m[0].replace(/[.,;:!?)\]»”"']+$/, '');
  }
  return null;
}

function deviceNow(): Device {
  return platformKind() === 'androidtv' ? 'atv' : 'lg';
}

/** The TV's own device, plus general questions (but not phone features that only share the general tag). */
export function shownOnTv(it: FaqItem, device: Device): boolean {
  if (it.devices.indexOf(device) >= 0) return true;
  return it.devices.indexOf('common') >= 0 && it.devices.indexOf('phone') < 0;
}

/**
 * The list's scrollTop that shows the whole focused row with the panel padding around it, or the current one when
 * the row is already fully visible. The first row (at the padding) gives 0, so no half row sits above it.
 */
export function rowScrollTop(scrollTop: number, viewH: number, rowTop: number, rowH: number, pad: number): number {
  const top = rowTop - pad;
  if (top <= 0) return 0;
  if (top < scrollTop) return top;
  const bottom = rowTop + rowH + pad;
  if (bottom > scrollTop + viewH) return Math.max(0, bottom - viewH);
  return scrollTop;
}

type Block = { kind: 'p'; text: string } | { kind: 'ol'; start: number; items: string[] };

/** Numbered lines («1. …») become ordered lists that keep their numbers; other lines stay paragraphs. */
export function answerBlocks(lines: FaqLine[]): Block[] {
  const out: Block[] = [];
  for (let i = 0; i < lines.length; i++) {
    const text = lineText(lines[i]);
    const m = STEP_RE.exec(text);
    if (!m) {
      out.push({ kind: 'p', text: text });
      continue;
    }
    const n = parseInt(m[1], 10);
    const last = out.length ? out[out.length - 1] : null;
    const body = text.slice(m[0].length);
    if (last && last.kind === 'ol' && last.start + last.items.length === n) last.items.push(body);
    else out.push({ kind: 'ol', start: n, items: [body] });
  }
  return out;
}

function Blocks(p: { lines: FaqLine[]; cls: string; prefix: string }) {
  return (
    <div class={p.cls}>
      {answerBlocks(p.lines).map((b, i) =>
        b.kind === 'p'
          ? <p class="faq-line" key={p.prefix + i}>{b.text}</p>
          : <ol class="faq-steps" start={b.start} key={p.prefix + i}>{b.items.map((x, j) => <li key={j}>{x}</li>)}</ol>,
      )}
    </div>
  );
}

export function FaqScreen() {
  const device = deviceNow();
  const items = FAQ.filter((it) => shownOnTv(it, device));
  const sections = SECTIONS.filter((s) => items.some((it) => it.section === s.id));
  const [secId, setSecId] = useState<SectionId | ''>(sections.length ? sections[0].id : '');
  const inSec = items.filter((it) => it.section === secId);
  const [cur, setCur] = useState<string>(inSec.length ? inSec[0].id : '');
  const listRef = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);

  const sel: FaqItem | undefined = inSec.filter((it) => it.id === cur)[0] || inSec[0];
  const view = sel ? itemFor(sel, device) : null;
  const url = view ? firstUrl(view.short.concat(view.more)) : null;

  // a new section starts at its first question, with the list scrolled to the top
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const list = listRef.current;
    if (list) list.scrollTop = 0;
    if (inSec.length) setFocus('faq-' + inSec[0].id);
  }, [secId]);

  const switchSection = (step: number): void => {
    let i = -1;
    for (let k = 0; k < sections.length; k++) if (sections[k].id === secId) i = k;
    const next = sections[i + step];
    if (!next) return;
    const first = items.filter((it) => it.section === next.id)[0];
    setCur(first ? first.id : '');
    setSecId(next.id);
  };

  const onArrow = (dir: string): boolean => {
    if (dir === 'left') { switchSection(-1); return false; }
    if (dir === 'right') { switchSection(1); return false; }
    return true;
  };

  const showRow = (id: string): void => {
    const list = listRef.current;
    if (!list) return;
    const row = list.querySelector('[data-fk="faq-' + id + '"]') as HTMLElement | null;
    if (!row) return;
    list.scrollTop = rowScrollTop(list.scrollTop, list.clientHeight, row.offsetTop, row.offsetHeight, LIST_PAD);
  };

  return (
    <FocusGroup focusKey="FAQ" className="screen faq">
      <h1>{t('tvSettings.help')}</h1>
      <div class="faq-chips">
        {sections.map((s) => <span key={s.id} class={'faq-chip' + (s.id === secId ? ' on' : '')}>{s.label}</span>)}
        <span class="spacer"></span>
        <span class="faq-chips-hint">{t('faq.hintSection')}</span>
      </div>
      <div class="faq-list" ref={listRef}>
        <FocusGroup focusKey="FAQ-LIST" autoFocus>
          {inSec.map((it) => (
            <Focusable
              key={it.id}
              focusKey={'faq-' + it.id}
              className="faq-q"
              onArrow={onArrow}
              onFocused={() => { setCur(it.id); showRow(it.id); }}
            >
              {itemFor(it, device).q}
            </Focusable>
          ))}
        </FocusGroup>
      </div>
      <section class="faq-answer">
        {view && <h2>{view.q}</h2>}
        {view && (
          <div class="faq-body">
            <Blocks lines={view.short} cls="faq-short" prefix="s" />
            {view.more.length > 0 && <Blocks lines={view.more} cls="faq-more" prefix="m" />}
          </div>
        )}
        {view && url && (
          <div class="faq-qr">
            <Qr text={url} size={200} />
            <div class="faq-qr-text">
              <div class="faq-qr-title">{t('faq.qrCaption')}</div>
              <div class="faq-qr-sub">{t('faq.scanToOpen')}</div>
            </div>
          </div>
        )}
        {view && !url && <div class="faq-phone">{t('faq.fullOnPhone')}</div>}
      </section>
      <div class="hints">{t('faq.hintQuestion') + ' · ' + t('faq.hintSection') + ' · ' + t('faq.hintBack')}</div>
    </FocusGroup>
  );
}
