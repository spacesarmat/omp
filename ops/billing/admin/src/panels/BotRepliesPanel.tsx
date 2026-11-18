import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { askConfirm } from '@/components/confirm';

type Variable = { key: string; label: string; sample: string; sampleEn?: string; samples?: Record<string, string> };
type Template = {
  id: string;
  category: string;
  title: string;
  body: string;
  bodyEn?: string;
  variables: Variable[];
  required: string[];
  fragment?: boolean;
  invoice?: boolean;
  saved?: { state: string; lang: string; updatedAt: number; author: string }[];
};
type Btn = { text: string; kind: 'url' | 'callback'; value: string };
type HistoryRow = { id: number; body: string; author: string; at: number; action: string; mediaKind: string; mediaUrl: string; buttons: Btn[][] | null };
type Detail = {
  template: Template;
  variant: { state: string; lang: string; body: string; mediaKind: string; mediaUrl: string; buttons: Btn[][] | null; customized: boolean };
  history: HistoryRow[];
  preview: string;
};

const STATES = [
  ['', 'По умолчанию'],
  ['active', 'Активна'],
  ['expired', 'Истекла'],
  ['trial', 'Пробная'],
] as const;
const LANGS = [
  ['', 'По умолчанию'],
  ['ru', 'RU'],
  ['en', 'EN'],
  ['uk', 'UK'],
  ['be', 'BE'],
  ['kk', 'KK'],
  ['ky', 'KY'],
  ['uz', 'UZ'],
  ['tg', 'TG'],
  ['tk', 'TK'],
  ['hy', 'HY'],
  ['az', 'AZ'],
  ['ka', 'KA'],
  ['ro', 'RO'],
] as const;
const EMOJI = ['✅', '⚠️', '⏳', '👋', '💳', '🎁', '📱', '💬', '⭐'];

function dashes(value: string) {
  return value.replace(/\u2014|\u2013/g, '-');
}

function knownKeys(template: Template) {
  return new Set((template.variables || []).map((item) => item.key));
}

function partsOf(body: string, template: Template) {
  const known = knownKeys(template);
  const out: { text: string; bad: boolean }[] = [];
  const re = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;
  let i = 0;
  let m = re.exec(body);
  while (m) {
    if (m.index > i) out.push({ text: body.slice(i, m.index), bad: false });
    out.push({ text: m[0], bad: !known.has(m[1]) });
    i = m.index + m[0].length;
    m = re.exec(body);
  }
  if (i < body.length) out.push({ text: body.slice(i), bad: false });
  return out;
}

type PreviewNode = { type: string; children: PreviewNode[]; text?: string; href?: string };

const PREVIEW_TAGS = new Set(['b', 'i', 'u', 's', 'code', 'pre', 'a']);

/** Parse the Telegram HTML subset into safe nodes; null when the markup is invalid (shown as plain text).
 * Mirrors markupError in ops/billing/src/botCopy.mjs. No raw HTML is ever inserted into the DOM. */
function parsePreview(src: string): PreviewNode[] | null {
  const root: PreviewNode[] = [];
  const stack: PreviewNode[][] = [root];
  const openTags: string[] = [];
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) {
      if (i < src.length) stack[stack.length - 1].push({ type: 'text', children: [], text: src.slice(i) });
      break;
    }
    if (lt > i) stack[stack.length - 1].push({ type: 'text', children: [], text: src.slice(i, lt) });
    const gt = src.indexOf('>', lt + 1);
    if (gt < 0) return null;
    const raw = src.slice(lt + 1, gt).trim();
    i = gt + 1;
    if (!raw) return null;
    const close = raw.charAt(0) === '/';
    const body = close ? raw.slice(1).trim() : raw;
    const tag = body.split(/\s+/)[0].toLowerCase();
    if (!PREVIEW_TAGS.has(tag)) return null;
    if (close) {
      if (body.toLowerCase() !== tag || !openTags.length || openTags.pop() !== tag) return null;
      stack.pop();
      continue;
    }
    const node: PreviewNode = { type: tag, children: [] };
    if (tag === 'a') {
      const href = /\bhref\s*=\s*"([^"]*)"/i.exec(body) || /\bhref\s*=\s*'([^']*)'/i.exec(body);
      if (!href) return null;
      if (!/^https?:\/\//i.test(href[1]) && !/^tg:\/\//i.test(href[1])) return null;
      const rest = body.replace(/^a\b/i, '').replace(href[0], '').trim();
      if (rest) return null;
      node.href = href[1];
    } else if (body.toLowerCase() !== tag) {
      return null;
    }
    stack[stack.length - 1].push(node);
    stack.push(node.children);
    openTags.push(tag);
  }
  if (openTags.length) return null;
  return root;
}

function renderNodes(nodes: PreviewNode[], prefix = ''): ReactNode[] {
  return nodes.map((node, i) => {
    const key = prefix + i;
    if (node.type === 'text') return <span key={key}>{node.text}</span>;
    const children = renderNodes(node.children, key + '-');
    switch (node.type) {
      case 'b':
        return <strong key={key}>{children}</strong>;
      case 'i':
        return <em key={key}>{children}</em>;
      case 'u':
        return <u key={key}>{children}</u>;
      case 's':
        return <s key={key}>{children}</s>;
      case 'code':
        return (
          <code key={key} className="rounded bg-black/30 px-1">
            {children}
          </code>
        );
      case 'pre':
        return (
          <pre key={key} className="whitespace-pre-wrap rounded bg-black/30 px-1">
            {children}
          </pre>
        );
      case 'a':
        return (
          <a key={key} href={node.href} target="_blank" rel="noreferrer" className="underline">
            {children}
          </a>
        );
      default:
        return <span key={key}>{children}</span>;
    }
  });
}

function Preview({ text, media, buttons }: { text: string; media: string; buttons: Btn[][] | null }) {
  const nodes = text ? parsePreview(text) : null;
  return (
    <div className="rounded-2xl bg-[#1d3346] px-3 py-2 text-sm text-white">
      {media ? <div className="mb-2 rounded bg-black/30 px-2 py-6 text-center text-xs">{media === 'video' ? 'Видео сверху' : 'Фото сверху'}</div> : null}
      <div className="whitespace-pre-wrap break-words">{text ? (nodes ? renderNodes(nodes) : text) : 'Пусто'}</div>
      {buttons && buttons.length ? (
        <div className="mt-2">
          {buttons.map((row, r) => (
            <div key={r} className="mt-1 flex flex-wrap">
              {row.map((btn, i) => (
                <span key={r + '-' + i} className="mb-1 mr-1 rounded bg-[#2b5278] px-2 py-1 text-xs">
                  {btn.text || 'Кнопка'}
                </span>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function BotRepliesPanel({ csrf }: { csrf: string }) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Template | null>(null);
  const [state, setState] = useState('');
  const [lang, setLang] = useState('');
  const [body, setBody] = useState('');
  const [mediaKind, setMediaKind] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [ownButtons, setOwnButtons] = useState(false);
  const [buttons, setButtons] = useState<Btn[][]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [linkUrl, setLinkUrl] = useState('https://');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const drag = useRef<{ r: number; i: number } | null>(null);
  const loadSeq = useRef(0);
  const selection = useRef({ id: '', state: '', lang: '' });
  selection.current = { id: open ? open.id : '', state, lang };

  async function loadList() {
    const data = await api<{ templates?: Template[]; auth?: boolean }>('/admin/api/bot-replies');
    if (data.auth === false) return;
    setTemplates(data.templates || []);
  }

  useEffect(() => {
    void loadList();
  }, []);

  async function loadVariant(template: Template, nextState: string, nextLang: string) {
    // A newer card or variant may open while this request is in flight: drop the stale answer,
    // otherwise saving would write the old text under the newly selected template.
    const seq = ++loadSeq.current;
    setLoading(true);
    try {
      const data = await api<Detail & { error?: string; auth?: boolean }>(
        '/admin/api/bot-replies?id=' + encodeURIComponent(template.id) + '&state=' + encodeURIComponent(nextState) + '&lang=' + encodeURIComponent(nextLang),
      );
      if (seq !== loadSeq.current) return;
      if (data.auth === false || data.error || !data.variant) {
        setError(data.error || 'Не удалось открыть шаблон');
        return;
      }
      setBody(data.variant.body || '');
      setMediaKind(data.variant.mediaKind || '');
      setMediaUrl(data.variant.mediaUrl || '');
      setOwnButtons(Array.isArray(data.variant.buttons));
      setButtons(Array.isArray(data.variant.buttons) ? data.variant.buttons : []);
      setHistory(data.history || []);
      setPreview(data.preview || '');
      setError('');
    } catch {
      if (seq === loadSeq.current) setError('Не удалось открыть шаблон');
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }

  async function openTemplate(template: Template) {
    setOpen(template);
    setState('');
    setLang('');
    setNote('');
    await loadVariant(template, '', '');
  }

  function insert(chunk: string) {
    const el = area.current;
    const value = dashes(body);
    if (!el) {
      setBody(value + chunk);
      return;
    }
    const start = el.selectionStart || 0;
    const end = el.selectionEnd || 0;
    const next = value.slice(0, start) + chunk + value.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + chunk.length;
      el.setSelectionRange(pos, pos);
    });
  }

  function wrap(tag: string) {
    const el = area.current;
    const value = dashes(body);
    const start = el ? el.selectionStart || 0 : value.length;
    const end = el ? el.selectionEnd || 0 : value.length;
    const selected = value.slice(start, end) || 'текст';
    const chunk = '<' + tag + '>' + selected + '</' + tag + '>';
    const next = value.slice(0, start) + chunk + value.slice(end);
    setBody(next);
  }

  function addLink() {
    const href = linkUrl.trim();
    if (!/^https?:\/\//i.test(href) && !/^tg:\/\//i.test(href)) {
      setError('Ссылка должна начинаться с http или tg://');
      return;
    }
    const el = area.current;
    const value = dashes(body);
    const start = el ? el.selectionStart || 0 : value.length;
    const end = el ? el.selectionEnd || 0 : value.length;
    const selected = value.slice(start, end) || 'ссылка';
    const chunk = '<a href="' + href.replace(/"/g, '') + '">' + selected + '</a>';
    setBody(value.slice(0, start) + chunk + value.slice(end));
    setError('');
  }

  function moveButton(from: { r: number; i: number }, to: { r: number; i: number }) {
    setButtons((rows) => {
      const next = rows.map((row) => row.slice());
      const [item] = next[from.r].splice(from.i, 1);
      if (!item) return rows;
      if (!next[from.r].length) next.splice(from.r, 1);
      const destRow = from.r < to.r && !rows[from.r].slice(1).length ? to.r - 1 : to.r;
      if (!next[destRow]) return rows;
      const destIndex = from.r === destRow && from.i < to.i ? to.i - 1 : to.i;
      next[destRow].splice(Math.max(0, destIndex), 0, item);
      return next.filter((row) => row.length);
    });
  }

  async function save() {
    if (!open || loading) return;
    const target = { id: open.id, state, lang };
    setBusy(true);
    setError('');
    try {
      const res = await api<{ ok?: boolean; error?: string; auth?: boolean }>('/admin/api/bot-replies/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          csrf,
          id: target.id,
          state: target.state,
          lang: target.lang,
          body: dashes(body),
          mediaKind,
          mediaUrl,
          buttons: ownButtons ? buttons : null,
        }),
      });
      if (res.auth === false) return;
      if (!res.ok) {
        setError(res.error || 'Не сохранилось');
        return;
      }
      setNote('Сохранено. Бот уже использует этот текст.');
      const cur = selection.current;
      if (cur.id === target.id && cur.state === target.state && cur.lang === target.lang) {
        await loadVariant(open, target.state, target.lang);
      }
      await loadList();
    } catch {
      setError('Сеть недоступна. Попробуйте ещё раз.');
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (!open || loading) return;
    const ok = await askConfirm({
      title: 'Текст по умолчанию',
      body: 'Сохранённый текст этого ответа будет забыт. Бот снова возьмёт текст из кода.',
      yes: 'Вернуть',
    });
    if (!ok) return;
    const target = { id: open.id, state, lang };
    setBusy(true);
    try {
      const res = await api<{ ok?: boolean; error?: string }>('/admin/api/bot-replies/reset', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ csrf, id: target.id, state: target.state, lang: target.lang }),
      });
      if (!res.ok) {
        setError(res.error || 'Не сбросилось');
        return;
      }
      setNote('Снова текст из кода.');
      const cur = selection.current;
      if (cur.id === target.id && cur.state === target.state && cur.lang === target.lang) {
        await loadVariant(open, target.state, target.lang);
      }
      await loadList();
    } catch {
      setError('Сеть недоступна. Попробуйте ещё раз.');
    } finally {
      setBusy(false);
    }
  }

  async function restore(row: HistoryRow) {
    if (!open || loading) return;
    const targetId = open.id;
    setBusy(true);
    try {
      const res = await api<{ ok?: boolean; error?: string; state?: string; lang?: string }>('/admin/api/bot-replies/restore', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ csrf, id: targetId, versionId: row.id }),
      });
      if (!res.ok) {
        setError(res.error || 'Не вернулось');
        return;
      }
      if (selection.current.id !== targetId) {
        await loadList();
        return;
      }
      const nextState = res.state || state;
      const nextLang = res.lang || lang;
      setState(nextState);
      setLang(nextLang);
      setNote('Версия восстановлена.');
      await loadVariant(open, nextState, nextLang);
      await loadList();
    } catch {
      setError('Сеть недоступна. Попробуйте ещё раз.');
    } finally {
      setBusy(false);
    }
  }

  async function sendSelf() {
    if (!open || loading) return;
    setBusy(true);
    setError('');
    try {
      const res = await api<{ ok?: boolean; error?: string }>('/admin/api/bot-replies/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          csrf,
          id: open.id,
          state,
          lang,
          body: dashes(body),
          mediaKind,
          mediaUrl,
          buttons: ownButtons ? buttons : null,
        }),
      });
      if (!res.ok) setError(res.error || 'Не отправилось');
      else setNote('Отправлено в ваш Telegram.');
    } catch {
      setError('Сеть недоступна. Попробуйте ещё раз.');
    } finally {
      setBusy(false);
    }
  }

  const groups = useMemo(() => {
    const query = q.trim().toLowerCase();
    const map = new Map<string, Template[]>();
    for (const row of templates) {
      if (query && (row.title + ' ' + row.id + ' ' + row.body).toLowerCase().indexOf(query) < 0) continue;
      const list = map.get(row.category) || [];
      list.push(row);
      map.set(row.category, list);
    }
    return Array.from(map.entries());
  }, [templates, q]);

  const limit = mediaKind ? 1024 : 4096;
  const highlights = open ? partsOf(body, open) : [];
  const livePreview = open
    ? body.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (_, key: string) => {
        const found = open.variables.find((item) => item.key === key);
        if (!found) return '{' + key + '}';
        if (lang === 'en' && found.sampleEn !== undefined) return found.sampleEn;
        if (found.samples && found.samples[lang] !== undefined) return found.samples[lang];
        return found.sample;
      })
    : preview;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Ответы бота</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">Пока шаблон не сохранён, бот шлёт текст из кода. Сохранение применяется сразу, без выкладки.</p>
          <Input placeholder="Найти ответ" value={q} onChange={(e) => setQ(e.target.value)} />
        </CardContent>
      </Card>
      {groups.map(([category, rows]) => (
        <section key={category}>
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">{category}</h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {rows.map((row) => (
              <button key={row.id} type="button" className="rounded-lg border border-border bg-card p-3 text-left" onClick={() => void openTemplate(row)}>
                <div className="font-medium">{row.title}</div>
                <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{row.body}</div>
                {(row.saved || []).length ? <div className="mt-2 text-xs text-primary">Изменён</div> : null}
              </button>
            ))}
          </div>
        </section>
      ))}
      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center" onClick={() => setOpen(null)}>
          <div className="max-h-[100dvh] w-full overflow-y-auto bg-card p-4 sm:max-h-[92vh] sm:max-w-5xl sm:rounded-lg" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-start justify-between">
              <div>
                <div className="text-lg font-semibold">{open.title}</div>
                <div className="text-xs text-muted-foreground">{open.category}</div>
              </div>
              <Button variant="secondary" onClick={() => setOpen(null)}>
                Закрыть
              </Button>
            </div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <label className="text-xs text-muted-foreground">
                    Подписка
                    <select
                      className="mt-1 block rounded-md border border-input bg-secondary px-2 py-1 text-sm"
                      value={state}
                      onChange={(e) => {
                        const next = e.target.value;
                        setState(next);
                        void loadVariant(open, next, lang);
                      }}
                    >
                      {STATES.map(([id, label]) => (
                        <option key={id} value={id}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs text-muted-foreground">
                    Язык
                    <select
                      className="mt-1 block rounded-md border border-input bg-secondary px-2 py-1 text-sm"
                      value={lang}
                      onChange={(e) => {
                        const next = e.target.value;
                        setLang(next);
                        void loadVariant(open, state, next);
                      }}
                    >
                      {LANGS.map(([id, label]) => (
                        <option key={id || 'default'} value={id}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="flex flex-wrap gap-1">
                  <Button type="button" variant="secondary" size="sm" onClick={() => wrap('b')}>
                    Жирный
                  </Button>
                  <Button type="button" variant="secondary" size="sm" onClick={() => wrap('i')}>
                    Курсив
                  </Button>
                  <Input className="h-8 w-40" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} aria-label="Адрес ссылки" />
                  <Button type="button" variant="secondary" size="sm" onClick={addLink}>
                    Ссылка
                  </Button>
                  {EMOJI.map((item) => (
                    <Button key={item} type="button" variant="ghost" size="sm" onClick={() => insert(item)}>
                      {item}
                    </Button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1">
                  {(open.variables || []).map((item) => (
                    <button key={item.key} type="button" className="rounded bg-secondary px-2 py-1 text-xs" onClick={() => insert('{' + item.key + '}')} title={item.label}>
                      {'{' + item.key + '}'}
                    </button>
                  ))}
                </div>
                <Textarea ref={area} className="min-h-40" value={body} onChange={(e) => setBody(dashes(e.target.value))} />
                <div className="whitespace-pre-wrap text-xs">
                  {highlights.map((part, i) =>
                    part.bad ? (
                      <mark key={i} className="bg-red-500/40">
                        {part.text}
                      </mark>
                    ) : (
                      <span key={i}>{part.text}</span>
                    ),
                  )}
                </div>
                <div className={body.length > limit ? 'text-xs text-red-400' : 'text-xs text-muted-foreground'}>
                  {body.length} / {limit}
                  {open.required && open.required.length ? '. Обязательные: ' + open.required.map((key) => '{' + key + '}').join(', ') : ''}
                </div>
                {open.fragment || open.invoice ? (
                  <p className="text-xs text-muted-foreground">
                    {open.invoice
                      ? 'Это счёт Telegram: текст уходит в описание счёта, свои кнопки и медиа не поддерживаются.'
                      : 'Этот шаблон - часть другого сообщения. Кнопки и медиа задаются в основном шаблоне.'}
                  </p>
                ) : (
                  <>
                <div className="flex flex-wrap gap-2">
                  <select className="rounded-md border border-input bg-secondary px-2 py-1 text-sm" value={mediaKind} onChange={(e) => setMediaKind(e.target.value)}>
                    <option value="">Без медиа</option>
                    <option value="photo">Фото сверху</option>
                    <option value="video">Видео сверху</option>
                  </select>
                  {mediaKind ? <Input placeholder="https:// ссылка" value={mediaUrl} onChange={(e) => setMediaUrl(e.target.value)} /> : null}
                </div>
                <label className="flex items-center text-sm">
                  <input type="checkbox" className="mr-2" checked={ownButtons} onChange={(e) => setOwnButtons(e.target.checked)} />
                  Свои кнопки. Иначе остаются кнопки из кода.
                </label>
                {ownButtons ? (
                  <div className="space-y-2">
                    {buttons.map((row, r) => (
                      <div key={r} className="flex flex-wrap gap-1">
                        {row.map((btn, i) => (
                          <div
                            key={r + '-' + i}
                            draggable
                            onDragStart={() => {
                              drag.current = { r, i };
                            }}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={() => {
                              if (drag.current) moveButton(drag.current, { r, i });
                              drag.current = null;
                            }}
                            className="rounded border border-border p-2"
                          >
                            <Input className="mb-1 h-8" value={btn.text} placeholder="Текст" onChange={(e) => setButtons((rows) => rows.map((line, ri) => (ri === r ? line.map((item, ii) => (ii === i ? { ...item, text: e.target.value } : item)) : line)))} />
                            <select
                              className="mb-1 w-full rounded border border-input bg-secondary px-1 py-1 text-xs"
                              value={btn.kind}
                              onChange={(e) => setButtons((rows) => rows.map((line, ri) => (ri === r ? line.map((item, ii) => (ii === i ? { ...item, kind: e.target.value === 'callback' ? 'callback' : 'url' } : item)) : line)))}
                            >
                              <option value="url">Ссылка</option>
                              <option value="callback">Команда</option>
                            </select>
                            <Input className="h-8" value={btn.value} placeholder={btn.kind === 'url' ? 'https://' : 'callback'} onChange={(e) => setButtons((rows) => rows.map((line, ri) => (ri === r ? line.map((item, ii) => (ii === i ? { ...item, value: e.target.value } : item)) : line)))} />
                            <button type="button" className="mt-1 text-xs text-red-400" onClick={() => setButtons((rows) => rows.map((line, ri) => (ri === r ? line.filter((_, ii) => ii !== i) : line)).filter((line) => line.length))}>
                              Убрать
                            </button>
                          </div>
                        ))}
                        <Button type="button" variant="secondary" size="sm" onClick={() => setButtons((rows) => rows.map((line, ri) => (ri === r ? line.concat([{ text: 'Кнопка', kind: 'url', value: 'https://omp-player.online' }]) : line)))}>
                          В ряд
                        </Button>
                      </div>
                    ))}
                    <Button type="button" variant="secondary" size="sm" onClick={() => setButtons((rows) => rows.concat([[{ text: 'Кнопка', kind: 'url', value: 'https://omp-player.online' }]]))}>
                      Новый ряд
                    </Button>
                  </div>
                ) : null}
                  </>
                )}
                {error ? <p className="text-sm text-red-400">{error}</p> : null}
                {note ? <p className="text-sm text-primary">{note}</p> : null}
                <div className="flex flex-wrap gap-2">
                  <Button type="button" disabled={busy || loading} onClick={() => void save()}>
                    Сохранить
                  </Button>
                  <Button type="button" variant="secondary" disabled={busy || loading} onClick={() => void sendSelf()}>
                    Отправить себе
                  </Button>
                  <Button type="button" variant="secondary" disabled={busy || loading} onClick={() => void reset()}>
                    По умолчанию
                  </Button>
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">История</div>
                  {history.length === 0 ? <div className="text-xs text-muted-foreground">Пока пусто</div> : null}
                  {history.map((row) => (
                    <div key={row.id} className="flex items-center justify-between gap-2 text-xs">
                      <span>
                        {new Date(row.at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })} {row.author} {row.action}
                      </span>
                      <Button type="button" variant="ghost" size="sm" disabled={busy || loading} onClick={() => void restore(row)}>
                        Вернуть
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-2 text-xs text-muted-foreground">Как в Telegram, на примерах</div>
                <Preview text={livePreview} media={mediaKind} buttons={ownButtons ? buttons : null} />
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
