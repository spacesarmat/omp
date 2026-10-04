import { useEffect, useState } from 'preact/hooks';
import { Icon } from '../ui/Icon';
import { goBack } from '../nav';
import { DEVICES, FAQ, SECTIONS, itemFor, resolveFaqLink, type Device, type FaqItem, type FaqLine } from '../faq';
import { activeTv } from '../tv/tvStore';
import { loadJson, saveJson } from '../../../src/store/storage';

const DEVICE_KEY = 'tsp.faqDevice';
const deviceLabel = (d: Device) => DEVICES.find((x) => x.id === d)!.label;
const sectionLabel = (it: FaqItem) => SECTIONS.find((s) => s.id === it.section)!.label;
const isDevice = (v: unknown): v is Device => typeof v === 'string' && DEVICES.some((d) => d.id === v);

/** Lower case, ё = е. Stays 1:1 per character for Russian/Latin text. */
export function normalizeFaq(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е');
}

const lineText = (l: FaqLine) => (typeof l === 'string' ? l : l.text);

export interface FaqHit {
  item: FaqItem;
  device: Device;
}

/** Items matching every word of `query` in the question, short answer or details; each item once, under `prefer` when it matches there. */
export function searchFaq(query: string, prefer?: Device): FaqHit[] {
  const words = normalizeFaq(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hits: FaqHit[] = [];
  for (const item of FAQ) {
    const matching = item.devices.filter((d) => {
      const v = itemFor(item, d);
      const text = normalizeFaq([v.q, ...v.short.map(lineText), ...v.more.map(lineText)].join('\n'));
      return words.every((w) => text.includes(w));
    });
    if (!matching.length) continue;
    hits.push({ item, device: prefer && matching.includes(prefer) ? prefer : matching[0] });
  }
  return hits;
}

/** The question with the matches of the query words marked. */
export function highlightFaq(text: string, query: string): preact.ComponentChild[] {
  const words = normalizeFaq(query).split(/\s+/).filter(Boolean);
  const norm = normalizeFaq(text);
  if (!words.length || norm.length !== text.length) return [text];
  const mark = new Array<boolean>(text.length).fill(false);
  for (const w of words) {
    for (let i = norm.indexOf(w); i >= 0; i = norm.indexOf(w, i + 1)) for (let k = i; k < i + w.length; k++) mark[k] = true;
  }
  const out: preact.ComponentChild[] = [];
  let i = 0;
  while (i < text.length) {
    let j = i;
    while (j < text.length && mark[j] === mark[i]) j++;
    const part = text.slice(i, j);
    out.push(mark[i] ? <mark key={i}>{part}</mark> : part);
    i = j;
  }
  return out;
}

function initialDevice(link: { device: Device } | null): { device: Device; fromTv: boolean } {
  if (link) return { device: link.device, fromTv: false };
  const tv = activeTv.value;
  if (tv) return { device: tv.kind === 'atv' ? 'atv' : 'lg', fromTv: true };
  return { device: loadJson<Device>(DEVICE_KEY, 'phone', isDevice), fromTv: false };
}

function Lines(p: { lines: FaqLine[] }) {
  return (
    <>
      {p.lines.map((l, i) =>
        typeof l === 'string' ? (
          <p key={i}>{l}</p>
        ) : (
          <p key={i}>
            <button type="button" class="m-link" onClick={() => window.open(l.url, '_system')}>
              {l.text}
            </button>
          </p>
        ),
      )}
    </>
  );
}

/** `q`: a question to open and scroll to (an item id, or an old question text from the install assistant). */
export function Faq(p: { q?: string } = {}) {
  const link = resolveFaqLink(p.q);
  const [init] = useState(() => initialDevice(link));
  const [device, setDevice] = useState<Device>(init.device);
  const [fromTv, setFromTv] = useState(init.fromTv);
  const [query, setQuery] = useState('');
  // one answer open at a time
  const [open, setOpen] = useState<string | null>(link ? link.id : null);
  const [moreOpen, setMoreOpen] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    const el = document.querySelector('.m-faq-item.open');
    if (el && typeof (el as HTMLElement).scrollIntoView === 'function') (el as HTMLElement).scrollIntoView({ block: 'start' });
  }, []);

  const searching = query.trim() !== '';
  const hits = searching ? searchFaq(query, device) : [];

  const pick = (d: Device) => {
    setDevice(d);
    setFromTv(false);
    setOpen(null);
    setMoreOpen(null);
    saveJson(DEVICE_KEY, d);
  };

  const row = (it: FaqItem, d: Device, badge: boolean) => {
    const v = itemFor(it, d);
    const isOpen = open === it.id;
    return (
      <div class={'m-faq-item' + (isOpen ? ' open' : '')} key={it.id}>
        <button
          type="button"
          class="m-faq-q"
          aria-expanded={isOpen}
          onClick={() => {
            setOpen(isOpen ? null : it.id);
            setMoreOpen(null);
          }}
        >
          <span>
            {badge && (
              <span class="m-faq-where">
                <span class="m-faq-badge">{deviceLabel(d)}</span>
                <span class="m-faq-sec">{sectionLabel(it)}</span>
              </span>
            )}
            {badge ? highlightFaq(v.q, query) : v.q}
          </span>
          <Icon d={isOpen ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} size={18} />
        </button>
        {isOpen && (
          <div class="m-faq-a">
            <div class="m-faq-short">
              <Lines lines={v.short} />
            </div>
            {v.more.length > 0 && (
              <>
                <button type="button" class="m-faq-more" aria-expanded={moreOpen === it.id} onClick={() => setMoreOpen(moreOpen === it.id ? null : it.id)}>
                  Подробнее
                </button>
                {moreOpen === it.id && (
                  <div class="m-faq-detail">
                    <Lines lines={v.more} />
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  const shown = SECTIONS.map((s) => ({ s, items: FAQ.filter((it) => it.section === s.id && it.devices.includes(device)) })).filter((g) => g.items.length);
  const tvName = activeTv.value?.name;

  return (
    <div class="m-screen" data-route="faq">
      <div class="m-bar">
        <button type="button" class="m-icon-btn" aria-label="Назад" onClick={() => goBack()}>
          <Icon d="M15 5l-7 7 7 7" />
        </button>
        <h1 class="m-bar-title">Вопросы и ответы</h1>
      </div>
      <label class="m-faq-search">
        <Icon d="M20 20l-3.5-3.5M18 11a7 7 0 11-14 0 7 7 0 0114 0z" size={18} />
        <input
          type="text"
          aria-label="Поиск по вопросам"
          placeholder="Поиск: «нет звука», «обновить»…"
          value={query}
          onInput={(e) => {
            setQuery((e.target as HTMLInputElement).value);
            setOpen(null);
            setMoreOpen(null);
          }}
        />
      </label>
      {searching ? (
        <>
          <div class="m-faq-hint" role="status">
            {hits.length ? `Найдено ${hits.length} · во всех устройствах` : 'Ничего не найдено · во всех устройствах'}
          </div>
          <div class="m-faq-list">{hits.map((h) => row(h.item, h.device, true))}</div>
        </>
      ) : (
        <>
          <div class="m-faq-devices" role="group" aria-label="Устройство">
            {DEVICES.map((d) => (
              <button type="button" class={'m-chip' + (d.id === device ? ' on' : '')} aria-pressed={d.id === device} key={d.id} onClick={() => pick(d.id)}>
                {d.label}
              </button>
            ))}
          </div>
          {fromTv && tvName && <div class="m-faq-hint">Выбрано по подключённому телевизору · {tvName}</div>}
          {shown.map((g) => (
            <section class="m-set-group" key={g.s.id}>
              <div class="m-set-label">{g.s.label}</div>
              <div class="m-faq-list">{g.items.map((it) => row(it, device, false))}</div>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
