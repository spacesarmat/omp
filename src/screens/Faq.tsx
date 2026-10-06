import { useState } from 'preact/hooks';
import { FocusGroup, Focusable } from '../ui/components';
import { Qr } from '../ui/Qr';
import { platformKind } from '../platform/env';
import { FAQ, SECTIONS, itemFor, type Device, type FaqItem, type FaqLine } from '../faq/faq';
import { t } from '../i18n';

const URL_RE = /https?:\/\/[^\s)]+/;

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

export function FaqScreen() {
  const device = deviceNow();
  const items = FAQ.filter((it) => it.devices.indexOf(device) >= 0);
  const [cur, setCur] = useState<string>(items.length ? items[0].id : '');
  const sel: FaqItem | undefined = items.filter((it) => it.id === cur)[0] || items[0];
  const view = sel ? itemFor(sel, device) : null;
  const lines = view ? view.short.concat(view.more) : [];
  const url = firstUrl(lines);

  return (
    <FocusGroup focusKey="FAQ" className="screen faq">
      <h1>{t('common.faq')}</h1>
      <div class="faq-cols">
        <FocusGroup focusKey="FAQ-LIST" className="faq-list" autoFocus>
          {SECTIONS.map((s) => {
            const inSec = items.filter((it) => it.section === s.id);
            if (!inSec.length) return null;
            return (
              <div class="faq-section" key={s.id}>
                <h3>{s.label}</h3>
                {inSec.map((it) => (
                  <Focusable key={it.id} focusKey={'faq-' + it.id} className="list-item" onFocused={() => setCur(it.id)}>
                    <div class="title">{itemFor(it, device).q}</div>
                  </Focusable>
                ))}
              </div>
            );
          })}
        </FocusGroup>
        <div class="faq-answer">
          {view && (
            <div>
              <h2>{view.q}</h2>
              {view.short.map((l, i) => <p class="faq-line" key={'s' + i}>{lineText(l)}</p>)}
              {view.more.map((l, i) => <p class="faq-line faq-more" key={'m' + i}>{lineText(l)}</p>)}
              {url && (
                <div class="faq-qr">
                  <Qr text={url} size={220} />
                  <div class="muted">{t('faq.scanToOpen')}</div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <div class="hints">{t('faq.hintBack')}</div>
    </FocusGroup>
  );
}
