import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/chrome';
import { api, post } from '@/lib/api';
import { nextSupportSelection } from '@/lib/subs';
import { personLabel, when } from '@/lib/text';
import type { SupportMsg, SupportThread } from '@/lib/types';

function sameMessages(a: SupportMsg[], b: SupportMsg[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].text !== b[i].text) return false;
  }
  return true;
}

export function SupportPanel({
  csrf,
  threads,
  onSent,
  initialTelegramId,
}: {
  csrf: string;
  threads: SupportThread[];
  onSent: () => void;
  initialTelegramId?: string;
}) {
  const [picked, setPicked] = useState(initialTelegramId || '');
  const selected = picked || threads[0]?.telegramId || '';
  const [messages, setMessages] = useState<SupportMsg[]>([]);
  const [loadedFor, setLoadedFor] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    if (initialTelegramId) setPicked(initialTelegramId);
  }, [initialTelegramId]);

  useEffect(() => {
    const ids = threads.map((row) => row.telegramId);
    setPicked((current) => nextSupportSelection(current, ids, initialTelegramId || ''));
  }, [threads, initialTelegramId]);

  function scrollToEnd(force?: boolean) {
    if (!force && !stick.current) return;
    const el = box.current;
    const end = bottom.current;
    if (!el) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (end) end.scrollIntoView({ block: 'end' });
        else el.scrollTop = el.scrollHeight;
      });
    });
  }

  useEffect(() => {
    stick.current = true;
    if (!selected) {
      setMessages([]);
      setLoadedFor('');
      return;
    }
    let stop = false;
    async function pull() {
      const r = await api<{ messages?: SupportMsg[] }>('/admin/api/support?telegramId=' + encodeURIComponent(selected));
      if (stop) return;
      const next = r.messages || [];
      setMessages((prev) => (sameMessages(prev, next) ? prev : next));
      setLoadedFor(selected);
    }
    void pull();
    const timer = window.setInterval(() => void pull(), 2500);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [selected]);

  useEffect(() => {
    scrollToEnd();
  }, [messages, selected]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!selected || !body || busy) return;
    setBusy(true);
    setErr('');
    const res = await post('/admin/support', csrf, { telegramId: selected, text: body });
    setBusy(false);
    if (!res.ok || res.flash?.error) {
      setErr(res.flash?.error || 'Не отправилось');
      return;
    }
    setText('');
    stick.current = true;
    const r = await api<{ messages?: SupportMsg[] }>('/admin/api/support?telegramId=' + encodeURIComponent(selected));
    setMessages(r.messages || []);
    setLoadedFor(selected);
    onSent();
  }

  async function closeDialog() {
    if (!selected || busy) return;
    if (!window.confirm('Завершить диалог? Пользователь получит уведомление в боте.')) return;
    setBusy(true);
    setErr('');
    const res = await post('/admin/support-close', csrf, { telegramId: selected });
    setBusy(false);
    if (!res.ok || res.flash?.error) {
      setErr(res.flash?.error || 'Не завершилось');
      return;
    }
    onSent();
  }

  const active = threads.find((row) => row.telegramId === selected);
  const loading = !!selected && loadedFor !== selected;
  const orphan = !!initialTelegramId && selected === initialTelegramId && !threads.some((row) => row.telegramId === selected);

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Диалоги</CardTitle>
          <CardDescription>Сообщения из бота</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1">
          {threads.length === 0 && !orphan ? <p className="text-sm text-muted-foreground">Пока пусто</p> : null}
          {orphan ? (
            <button type="button" className="block w-full rounded-md bg-muted px-2 py-2 text-left text-sm" onClick={() => setPicked(initialTelegramId || '')}>
              <div className="font-medium">{initialTelegramId}</div>
              <div className="truncate text-xs text-muted-foreground">диалог из карточки пользователя</div>
            </button>
          ) : null}
          {threads.map((row) => (
            <button
              key={row.telegramId}
              type="button"
              className={'block w-full rounded-md px-2 py-2 text-left text-sm ' + (row.telegramId === selected ? 'bg-muted' : 'hover:bg-muted/60')}
              onClick={() => setPicked(row.telegramId)}
            >
              <div className="font-medium">{personLabel(row.telegramId, row.username, row.name)}</div>
              <div className="truncate text-xs text-muted-foreground">{row.lastText}</div>
            </button>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{selected ? personLabel(selected, active?.username, active?.name) : 'Выберите диалог'}</CardTitle>
          <CardDescription>Ответ уходит этому пользователю в бота. Ответ на уведомление в Telegram делает то же самое.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div
            ref={box}
            className="omp-scroll h-80 min-h-0 space-y-2 overflow-y-auto overscroll-contain rounded-md border border-border/60 bg-background/40 p-3"
            onScroll={() => {
              const el = box.current;
              if (!el) return;
              stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 64;
            }}
          >
            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-12 w-2/3" />
                <Skeleton className="ml-auto h-12 w-1/2" />
              </div>
            ) : null}
            {!loading && messages.length === 0 ? (
              <p className="text-sm text-muted-foreground">{selected ? 'Пока нет сообщений' : 'Выберите диалог слева'}</p>
            ) : null}
            {messages.map((m) => (
              <div key={m.id} className={m.direction === 'out' ? 'text-right' : ''}>
                <div className="text-xs text-muted-foreground">
                  {m.direction === 'out' ? 'Админ' : 'Пользователь'} · {when(m.at)}
                  {m.via === 'panel' ? ' · панель' : ''}
                </div>
                <div className="inline-block max-w-[90%] whitespace-pre-wrap rounded-md bg-muted px-3 py-2 text-sm">{m.text}</div>
              </div>
            ))}
            <div ref={bottom} className="h-px w-full shrink-0" aria-hidden />
          </div>
          {err ? <Alert variant="destructive">{err}</Alert> : null}
          <form className="shrink-0 space-y-2" onSubmit={(e) => void send(e)}>
            <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Ответ пользователю" rows={3} />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy || !selected || !text.trim()}>
                {busy ? 'Отправляю…' : 'Ответить'}
              </Button>
              <Button type="button" variant="secondary" disabled={busy || !selected} onClick={() => void closeDialog()}>
                Завершить диалог
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
