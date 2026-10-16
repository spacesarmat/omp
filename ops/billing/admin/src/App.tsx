import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { api, post, type Flash } from '@/lib/api';

function toast(text: string) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = text;
  el.style.display = 'block';
  window.clearTimeout((el as HTMLElement & { _t?: number })._t);
  (el as HTMLElement & { _t?: number })._t = window.setTimeout(() => {
    el.style.display = 'none';
  }, 1400);
}

function CopyBtn({ value }: { value?: string }) {
  if (!value) return null;
  return (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      className="ml-1 h-7 px-2 text-xs"
      onClick={() => void navigator.clipboard.writeText(value).then(() => toast('Скопировано'))}
    >
      copy
    </Button>
  );
}

function FlashBox({ flash }: { flash?: Flash }) {
  if (!flash) return null;
  if (flash.error) return <Alert variant="destructive">{flash.error}</Alert>;
  if (flash.code)
    return (
      <Alert variant="success">
        Код: <code className="font-mono tracking-wider">{flash.code}</code> <CopyBtn value={flash.code} />
      </Alert>
    );
  if (flash.promo)
    return (
      <Alert variant="success">
        Промо: <code className="font-mono">{flash.promo}</code> <CopyBtn value={flash.promo} />
      </Alert>
    );
  if (flash.text) return <Alert>{flash.text}</Alert>;
  return null;
}

function AlertItem({ a }: { a: { level: string; text: string; accountId?: string } }) {
  return (
    <Alert variant={a.level === 'bad' ? 'destructive' : 'warn'}>
      {a.accountId ? (
        <a className="underline underline-offset-2 hover:opacity-90" href={'/admin/?id=' + encodeURIComponent(a.accountId)}>
          {a.text}
        </a>
      ) : (
        a.text
      )}
    </Alert>
  );
}

function AlertsPanel({ alerts }: { alerts?: { level: string; text: string; accountId?: string }[] }) {
  const list = alerts || [];
  return (
    <Card id="alerts">
      <CardHeader>
        <CardTitle>Алерты {list.length > 0 ? <Badge className="ml-2 align-middle">{list.length}</Badge> : null}</CardTitle>
        {list.length === 0 ? <CardDescription>Алертов нет</CardDescription> : null}
      </CardHeader>
      {list.length > 0 ? (
        <CardContent className="space-y-2">
          {list.map((a, i) => (
            <AlertItem key={i} a={a} />
          ))}
        </CardContent>
      ) : null}
    </Card>
  );
}

function Logo({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" className={className} aria-hidden="true">
      <rect x="0" y="0" width="100" height="100" rx="20" fill="#181B22" />
      <g transform="translate(9 9) scale(0.82)">
        <rect x="14" y="22" width="72" height="56" rx="10" fill="none" stroke="#F5B700" strokeWidth="7" />
        <g fill="#F5B700">
          <rect x="23" y="29" width="6" height="5" rx="1.5" />
          <rect x="35" y="29" width="6" height="5" rx="1.5" />
          <rect x="47" y="29" width="6" height="5" rx="1.5" />
          <rect x="59" y="29" width="6" height="5" rx="1.5" />
          <rect x="71" y="29" width="6" height="5" rx="1.5" />
          <rect x="23" y="66" width="6" height="5" rx="1.5" />
          <rect x="35" y="66" width="6" height="5" rx="1.5" />
          <rect x="47" y="66" width="6" height="5" rx="1.5" />
          <rect x="59" y="66" width="6" height="5" rx="1.5" />
          <rect x="71" y="66" width="6" height="5" rx="1.5" />
        </g>
        <path d="M44 41 L59 50 L44 59 Z" fill="#E8EAF0" stroke="#E8EAF0" strokeWidth="4" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

function Brand({ subtitle }: { subtitle?: string }) {
  return (
    <div className="flex items-center gap-3">
      <Logo className="h-10 w-10 shrink-0" />
      <div>
        <h1 className="text-2xl font-bold leading-none">OMP Billing</h1>
        {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
    </div>
  );
}

function Login() {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [tg, setTg] = useState<{ token: string; deepLink: string } | null>(null);
  const [tgStatus, setTgStatus] = useState('');

  useEffect(() => {
    if (!tg?.token) return;
    let stop = false;
    const tick = async () => {
      const res = await api<{ ok?: boolean; status?: string }>('/admin/login/telegram/status?token=' + encodeURIComponent(tg.token));
      if (stop) return;
      if (res.status === 'ok' || res.ok) {
        location.href = '/admin/';
        return;
      }
      if (res.status === 'denied') {
        setErr('Этот Telegram не в списке adminTelegramIds');
        setTg(null);
        setTgStatus('');
        return;
      }
      if (res.status === 'expired') {
        setErr('Ссылка устарела — нажмите «Войти через Telegram» ещё раз');
        setTg(null);
        setTgStatus('');
        return;
      }
      setTgStatus('Ожидаю подтверждение в Telegram…');
    };
    void tick();
    const id = window.setInterval(() => void tick(), 2000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [tg?.token]);

  async function startTelegram() {
    setBusy(true);
    setErr('');
    setTgStatus('');
    const res = await api<{ ok?: boolean; error?: string; token?: string; deepLink?: string; status?: number }>(
      '/admin/login/telegram',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', Accept: 'application/json' },
        body: '{}',
      },
    );
    setBusy(false);
    if (res.status === 403) {
      setErr('Панель на NAS ещё не перезапущена — сервер не знает вход через Telegram.');
      return;
    }
    if (!res.ok || !res.token || !res.deepLink) {
      setErr(res.error || 'Не удалось начать вход через Telegram');
      return;
    }
    setTg({ token: res.token, deepLink: res.deepLink });
    window.open(res.deepLink, '_blank', 'noopener,noreferrer');
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    const res = await api<{ ok?: boolean; error?: string }>('/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ password }),
    });
    setBusy(false);
    if (res.ok) location.href = '/admin/';
    else setErr(res.error || 'Неверный пароль');
  }
  return (
    <main className="mx-auto max-w-sm px-4 py-16">
      <div className="mb-6">
        <Brand subtitle="Вход через Telegram из списка adminTelegramIds" />
      </div>
      {err ? <Alert variant="destructive" className="mb-4">{err}</Alert> : null}
      {tgStatus ? <Alert className="mb-4">{tgStatus}</Alert> : null}
      <Card>
        <CardContent className="space-y-4 pt-6">
          <Button className="w-full" disabled={busy} onClick={() => void startTelegram()}>
            {busy && !tg ? '…' : 'Войти через Telegram'}
          </Button>
          {tg?.deepLink ? (
            <p className="text-sm text-muted-foreground">
              Если бот не открылся:{' '}
              <a className="underline" href={tg.deepLink} target="_blank" rel="noreferrer">
                открыть ссылку
              </a>
            </p>
          ) : null}
          <button type="button" className="text-sm text-muted-foreground underline" onClick={() => setShowPass((v) => !v)}>
            {showPass ? 'Скрыть пароль' : 'Войти по паролю'}
          </button>
          {showPass ? (
            <form className="space-y-4" onSubmit={submit}>
              <div className="space-y-2">
                <Label htmlFor="password">Пароль</Label>
                <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? '…' : 'Войти'}
              </Button>
            </form>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}

type SupportThread = {
  telegramId: string;
  username?: string;
  name?: string;
  count: number;
  lastText: string;
  lastAt: number;
  lastDirection: string;
};

type SupportMsg = { id: string; text: string; direction: string; at: number; via?: string };

function sameMessages(a: SupportMsg[], b: SupportMsg[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].text !== b[i].text) return false;
  }
  return true;
}

function when(ms: number) {
  if (!ms) return '';
  const d = new Date(ms);
  const p = (n: number) => (n < 10 ? '0' : '') + n;
  return p(d.getDate()) + '.' + p(d.getMonth() + 1) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

function personLabel(id: string, username?: string, name?: string) {
  const nick = username ? '@' + username.replace(/^@/, '') : name || '';
  if (nick && id) return nick + ' · ' + id;
  return nick || id;
}

function SupportPanel({
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
  const [id, setId] = useState(initialTelegramId || threads[0]?.telegramId || '');
  const [messages, setMessages] = useState<SupportMsg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    if (initialTelegramId) setId(initialTelegramId);
  }, [initialTelegramId]);

  function scrollToEnd(force?: boolean) {
    if (!force && !stick.current) return;
    const el = box.current;
    const end = bottom.current;
    if (!el) return;
    // Double rAF: wait for layout after React commit so scrollHeight is final.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (end) end.scrollIntoView({ block: 'end' });
        else el.scrollTop = el.scrollHeight;
      });
    });
  }

  useEffect(() => {
    stick.current = true;
    if (!id) {
      setMessages([]);
      return;
    }
    let stop = false;
    async function pull() {
      const r = await api<{ messages?: SupportMsg[] }>('/admin/api/support?telegramId=' + encodeURIComponent(id));
      if (stop) return;
      const next = r.messages || [];
      setMessages((prev) => (sameMessages(prev, next) ? prev : next));
    }
    void pull();
    const timer = window.setInterval(() => void pull(), 2500);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [id]);

  useEffect(() => {
    scrollToEnd();
  }, [messages, id]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!id || !body || busy) return;
    setBusy(true);
    setErr('');
    const res = await post('/admin/support', csrf, { telegramId: id, text: body });
    setBusy(false);
    if (!res.ok || res.flash?.error) {
      setErr(res.flash?.error || 'Не отправилось');
      return;
    }
    setText('');
    stick.current = true;
    const r = await api<{ messages?: SupportMsg[] }>('/admin/api/support?telegramId=' + encodeURIComponent(id));
    setMessages(r.messages || []);
    onSent();
  }

  useEffect(() => {
    if (!id) return;
    if (threads.some((row) => row.telegramId === id)) return;
    // Keep a deep-linked telegram id even if the thread is not in the open list yet.
    if (initialTelegramId && id === initialTelegramId) return;
    setId(threads[0]?.telegramId || '');
  }, [threads, id, initialTelegramId]);

  async function closeDialog() {
    if (!id || busy) return;
    if (!window.confirm('Завершить диалог? Пользователь получит уведомление в боте.')) return;
    setBusy(true);
    setErr('');
    const res = await post('/admin/support-close', csrf, { telegramId: id });
    setBusy(false);
    if (!res.ok || res.flash?.error) {
      setErr(res.flash?.error || 'Не завершилось');
      return;
    }
    onSent();
  }

  const active = threads.find((row) => row.telegramId === id);

  return (
    <div className="grid gap-4 md:grid-cols-[240px_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Диалоги</CardTitle>
          <CardDescription>Сообщения из бота</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1">
          {threads.length === 0 && !(initialTelegramId && id === initialTelegramId) ? (
            <p className="text-sm text-muted-foreground">Пока пусто</p>
          ) : null}
          {initialTelegramId && id === initialTelegramId && !threads.some((row) => row.telegramId === id) ? (
            <button
              type="button"
              className="block w-full rounded-md bg-muted px-2 py-2 text-left text-sm"
              onClick={() => setId(initialTelegramId)}
            >
              <div className="font-medium">{initialTelegramId}</div>
              <div className="truncate text-xs text-muted-foreground">диалог из карточки пользователя</div>
            </button>
          ) : null}
          {threads.map((row) => (
            <button
              key={row.telegramId}
              type="button"
              className={
                'block w-full rounded-md px-2 py-2 text-left text-sm ' +
                (row.telegramId === id ? 'bg-muted' : 'hover:bg-muted/60')
              }
              onClick={() => setId(row.telegramId)}
            >
              <div className="font-medium">{personLabel(row.telegramId, row.username, row.name)}</div>
              <div className="truncate text-xs text-muted-foreground">{row.lastText}</div>
            </button>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{id ? personLabel(id, active?.username, active?.name) : 'Выберите диалог'}</CardTitle>
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
            {messages.length === 0 ? (
              <p className="text-sm text-muted-foreground">{id ? 'Пока нет сообщений' : 'Выберите диалог слева'}</p>
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
              <Button type="submit" disabled={busy || !id || !text.trim()}>
                {busy ? 'Отправляю…' : 'Ответить'}
              </Button>
              <Button type="button" variant="secondary" disabled={busy || !id} onClick={() => void closeDialog()}>
                Завершить диалог
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

type HomeData = {
  csrf: string;
  sessionId: string;
  flash?: Flash;
  stats?: { accounts: number; activeSubs: number; payments30: number; revenue30: number };
  alerts?: { level: string; text: string; accountId?: string }[];
  events?: { kind: string; text: string; accountId?: string }[];
  finance?: {
    summary?: { day?: { sum: number; count: number }; week?: { sum: number; count: number }; month?: { sum: number; count: number } };
    payments?: { at?: number; amount?: string; who?: string; accountId?: string; label?: string }[];
    problems?: { kind: string; text: string }[];
  };
  subscriptions?: {
    id: string;
    accountId: string;
    who: string;
    telegramId?: string;
    paidUntilText: string;
    bound: number;
    deviceLimit: number;
    active: boolean;
    status: string;
  }[];
  promos?: { id: string; code: string; days: number; uses: number; maxUses: number; revoked: boolean }[];
  fails?: { at?: number; atText: string; reason: string; deviceId: string }[];
  sessions?: { id: string; lastSeen?: number }[];
  support?: SupportThread[];
  audit?: { at?: number; action: string; detail: string }[];
  settings?: Record<string, string | number>;
  storage?: { engine: string; path: string; bytes: number };
};

type UserData = {
  csrf: string;
  flash?: Flash;
  account: { id: string; email: string; telegramId: string; telegramUsername?: string; telegramName?: string; createdText: string };
  subscription?: { paidUntilText: string; active: boolean; deviceLimit: number };
  codes?: { id: string; formatted?: string; bound: boolean; deviceId?: string; openUrl?: string }[];
};

export function App() {
  const [auth, setAuth] = useState<boolean | null>(null);
  const [data, setData] = useState<HomeData | null>(null);
  const [user, setUser] = useState<UserData | null>(null);
  const params = useMemo(() => new URLSearchParams(location.search), []);
  const [tab, setTab] = useState(() => params.get('tab') || 'home');
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [grantDays, setGrantDays] = useState('30');
  const [msg, setMsg] = useState('');
  const supportTg = params.get('tg') || '';

  async function reload() {
    const id = params.get('id');
    if (id) {
      const u = await api<UserData & { error?: string }>('/admin/api/user?id=' + encodeURIComponent(id));
      if (u.auth === false) {
        setAuth(false);
        return;
      }
      if (u.error) {
        setUser(null);
        setAuth(true);
        const home = await api<HomeData>('/admin/api/home');
        setData(home);
        return;
      }
      setUser(u);
      setAuth(true);
      return;
    }
    const home = await api<HomeData>('/admin/api/home');
    if (home.auth === false) {
      setAuth(false);
      return;
    }
    setData(home);
    setAuth(true);
  }

  useEffect(() => {
    void reload();
  }, []);

  useEffect(() => {
    if (auth !== true || tab !== 'support') return;
    let stop = false;
    const timer = window.setInterval(() => {
      void api<HomeData>('/admin/api/home').then((home) => {
        if (stop) return;
        if (home.auth === false) {
          setAuth(false);
          return;
        }
        setData((prev) => (prev ? { ...prev, support: home.support || [] } : prev));
      });
    }, 3000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [auth, tab]);

  async function run(path: string, fields: Record<string, unknown> = {}) {
    const csrf = user?.csrf || data?.csrf || '';
    const res = await post(path, csrf, fields);
    if (res.auth === false) {
      setAuth(false);
      return;
    }
    if (res.redirect) {
      location.href = res.redirect;
      return;
    }
    await reload();
    if (res.flash?.error) toast(res.flash.error);
    else if (res.flash?.text) toast(res.flash.text);
  }

  if (auth === null) return <main className="p-8 text-muted-foreground">Загрузка…</main>;
  if (auth === false) return <Login />;

  if (user) {
    const tg = user.account.telegramId || '';
    return (
      <main className="mx-auto max-w-3xl space-y-4 px-4 py-6">
        <Button variant="link" className="px-0" asChild>
          <a href="/admin/">← Назад</a>
        </Button>
        <h1 className="text-2xl font-bold">Пользователь</h1>
        <FlashBox flash={user.flash} />
        <Card>
          <CardContent className="space-y-2 pt-6 text-sm">
            <p>
              <span className="text-muted-foreground">id</span> {user.account.id} <CopyBtn value={user.account.id} />
            </p>
            <p>
              <span className="text-muted-foreground">Telegram</span>{' '}
              {tg ? (
                <>
                  <Badge variant="ok">{personLabel(tg, user.account.telegramUsername, user.account.telegramName)}</Badge>{' '}
                  <CopyBtn value={tg} />
                </>
              ) : (
                '—'
              )}
            </p>
            <p>
              <span className="text-muted-foreground">Email</span> {user.account.email || '—'}
            </p>
            <p>
              <span className="text-muted-foreground">Создан</span> {user.account.createdText}
            </p>
            {user.subscription ? (
              <p>
                Подписка до <b>{user.subscription.paidUntilText}</b> · устройств {user.subscription.deviceLimit} ·{' '}
                {user.subscription.active ? <Badge variant="ok">активна</Badge> : <Badge variant="bad">истекла</Badge>}
              </p>
            ) : (
              <p className="text-muted-foreground">Нет подписки</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Написать пользователю</CardTitle>
            <CardDescription>
              {tg
                ? 'Сообщение уйдёт в Telegram-бота и появится во вкладке «Поддержка».'
                : 'У аккаунта нет Telegram — сначала нужна привязка в боте.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {tg ? (
              <>
                <Textarea
                  value={msg}
                  onChange={(e) => setMsg(e.target.value)}
                  placeholder="Текст сообщения…"
                  rows={4}
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={!msg.trim()}
                    onClick={() => {
                      const text = msg.trim();
                      if (!text) return;
                      void run('/admin/message', { accountId: user.account.id, text }).then(() => setMsg(''));
                    }}
                  >
                    Отправить в Telegram
                  </Button>
                  <Button variant="secondary" asChild>
                    <a href={'/admin/?tab=support&tg=' + encodeURIComponent(tg)}>Открыть в поддержке</a>
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Привяжите Telegram в боте или через приложение OMP.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Выдать дни</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <select className="h-10 rounded-md border border-input bg-secondary px-3 text-sm" value={grantDays} onChange={(e) => setGrantDays(e.target.value)}>
              <option value="1">1</option>
              <option value="7">7</option>
              <option value="30">30</option>
              <option value="90">90</option>
            </select>
            <Button onClick={() => void run('/admin/grant', { accountId: user.account.id, days: grantDays })}>Выдать</Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Коды</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(user.codes || []).length === 0 ? <p className="text-muted-foreground">Нет кодов</p> : null}
            {(user.codes || []).map((c) => (
              <div key={c.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span>{c.formatted || (c.bound ? 'привязан · ' + c.deviceId : '—')}</span>
                <CopyBtn value={c.formatted} />
                {c.openUrl ? (
                  <Button size="sm" variant="link" asChild>
                    <a href={c.openUrl} target="_blank" rel="noreferrer">
                      OMP
                    </a>
                  </Button>
                ) : null}
                {c.bound ? (
                  <Button size="sm" variant="secondary" onClick={() => void run('/admin/unbind', { codeId: c.id, accountId: user.account.id })}>
                    Сбросить
                  </Button>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
        <div id="toast" className="fixed bottom-6 left-1/2 z-50 hidden -translate-x-1/2 rounded-md bg-primary px-4 py-2 font-bold text-primary-foreground" />
      </main>
    );
  }

  const d = data || ({} as HomeData);
  const subs = (d.subscriptions || []).filter((s) => filter === 'all' || s.status === filter || (filter === 'active' && s.active));

  return (
    <main className="mx-auto max-w-5xl space-y-4 px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <Brand
          subtitle={
            'React + shadcn · ' +
            (d.storage?.engine || '—') +
            (d.storage ? ' · ' + Math.round((d.storage.bytes || 0) / 1024) + ' КБ' : '')
          }
        />
        <Button variant="secondary" onClick={() => void run('/admin/logout')}>
          Выйти
        </Button>
      </header>
      <FlashBox flash={d.flash} />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="home">
            Главная
            {(d.alerts || []).length > 0 ? (
              <Badge variant="bad" className="ml-2">
                {(d.alerts || []).length}
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="support">
            Поддержка
            {(d.support || []).length > 0 ? (
              <Badge className="ml-2">{(d.support || []).length}</Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="subs">Подписки</TabsTrigger>
          <TabsTrigger value="finance">Финансы</TabsTrigger>
          <TabsTrigger value="promos">Промо</TabsTrigger>
          <TabsTrigger value="services">Сервисы</TabsTrigger>
          <TabsTrigger value="settings">Настройки</TabsTrigger>
          <TabsTrigger value="security">Доступ</TabsTrigger>
        </TabsList>

        <TabsContent value="support">
          <SupportPanel
            csrf={d.csrf}
            threads={d.support || []}
            onSent={() => void reload()}
            initialTelegramId={supportTg}
          />
        </TabsContent>

        <TabsContent value="home" className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              [d.stats?.accounts ?? 0, 'аккаунтов'],
              [d.stats?.activeSubs ?? 0, 'активных'],
              [d.stats?.payments30 ?? 0, 'оплат / 30 дн.'],
              [Math.round(d.stats?.revenue30 || 0), '₽ / 30 дн.'],
            ].map(([v, l]) => (
              <Card key={String(l)}>
                <CardContent className="pt-4">
                  <div className="text-2xl font-bold">{v}</div>
                  <div className="text-xs text-muted-foreground">{l}</div>
                </CardContent>
              </Card>
            ))}
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Найти</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                className="flex flex-col gap-2 sm:flex-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run('/admin/find', { q });
                }}
              >
                <Input placeholder="Telegram / email / код / id" value={q} onChange={(e) => setQ(e.target.value)} />
                <Button type="submit">Найти</Button>
              </form>
            </CardContent>
          </Card>
          <AlertsPanel alerts={d.alerts} />
          <Card>
            <CardHeader>
              <CardTitle>Быстрое промо</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button onClick={() => void run('/admin/promo', { days: 1, maxUses: 1 })}>1 день × 1</Button>
              <Button variant="secondary" onClick={() => void run('/admin/promo', { days: 7, maxUses: 10 })}>
                7 дней × 10
              </Button>
              <Button variant="secondary" onClick={() => void run('/admin/promo', { days: 30, maxUses: 1 })}>
                30 дней × 1
              </Button>
            </CardContent>
          </Card>
          <IssueCard run={run} />
          <Card>
            <CardHeader>
              <CardTitle>Лента</CardTitle>
            </CardHeader>
            <CardContent>
              {(d.events || []).length === 0 ? <p className="text-muted-foreground">Пока пусто</p> : null}
              <ul className="space-y-2 text-sm">
                {(d.events || []).slice(0, 20).map((e, i) => (
                  <li key={i}>
                    <Badge className="mr-2">{e.kind}</Badge>
                    {e.text}{' '}
                    {e.accountId ? (
                      <a className="text-primary" href={'/admin/?id=' + encodeURIComponent(e.accountId)}>
                        {e.accountId.slice(0, 8)}
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="subs">
          <Card>
            <CardHeader>
              <CardTitle>Подписки</CardTitle>
              <CardDescription>
                <span className="flex flex-wrap gap-1">
                  {[
                    ['all', 'Все'],
                    ['active', 'Активные'],
                    ['unbound', 'Без устройства'],
                    ['expired', 'Истекшие'],
                  ].map(([id, label]) => (
                    <Button key={id} size="sm" variant={filter === id ? 'default' : 'secondary'} onClick={() => setFilter(id)}>
                      {label}
                    </Button>
                  ))}
                </span>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Кто</TableHead>
                    <TableHead>До</TableHead>
                    <TableHead>Устр.</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {subs.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>
                        {s.who}
                        <CopyBtn value={s.telegramId} />
                      </TableCell>
                      <TableCell className={s.active ? 'text-emerald-400' : 'text-red-400'}>{s.paidUntilText}</TableCell>
                      <TableCell>
                        {s.bound}/{s.deviceLimit}
                      </TableCell>
                      <TableCell>
                        <a className="text-primary" href={'/admin/?id=' + encodeURIComponent(s.accountId)}>
                          карточка
                        </a>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="finance" className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {[
              [d.finance?.summary?.day, 'сегодня'],
              [d.finance?.summary?.week, 'неделя'],
              [d.finance?.summary?.month, 'месяц'],
            ].map(([row, label]) => (
              <Card key={String(label)}>
                <CardContent className="pt-4">
                  <div className="text-2xl font-bold">{Math.round((row as { sum?: number } | undefined)?.sum || 0)}</div>
                  <div className="text-xs text-muted-foreground">
                    ₽ {label} · {(row as { count?: number } | undefined)?.count || 0}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          <p>
            <a className="text-primary" href="/admin/finance.csv">
              Скачать CSV за 30 дней
            </a>
          </p>
          {(d.finance?.problems || []).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Проблемы</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1 text-sm text-red-300">
                  {d.finance!.problems!.map((p, i) => (
                    <li key={i}>
                      {p.kind}: {p.text}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle>Платежи</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Когда</TableHead>
                    <TableHead>Сумма</TableHead>
                    <TableHead>Кто</TableHead>
                    <TableHead>Label</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(d.finance?.payments || []).map((p, i) => (
                    <TableRow key={i}>
                      <TableCell>{p.at ? when(p.at) : '—'}</TableCell>
                      <TableCell>{p.amount}</TableCell>
                      <TableCell>
                        {p.accountId ? (
                          <a className="text-primary" href={'/admin/?id=' + encodeURIComponent(p.accountId)}>
                            {p.who || p.accountId.slice(0, 8)}
                          </a>
                        ) : (
                          p.who || '—'
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{p.label}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="promos">
          <PromoCard run={run} promos={d.promos || []} />
        </TabsContent>

        <TabsContent value="settings">
          <SettingsCard run={run} settings={d.settings || {}} storage={d.storage} />
        </TabsContent>

        <TabsContent value="services" className="space-y-4">
          <ServicesCard csrf={d.csrf} settings={d.settings || {}} onSaved={() => void reload()} />
        </TabsContent>

        <TabsContent value="security" className="space-y-4">
          <SecurityCard run={run} sessions={d.sessions || []} sessionId={d.sessionId} audit={d.audit || []} fails={d.fails || []} />
        </TabsContent>
      </Tabs>
      <div id="toast" className="fixed bottom-6 left-1/2 z-50 hidden -translate-x-1/2 rounded-md bg-primary px-4 py-2 font-bold text-primary-foreground" />
    </main>
  );
}

function IssueCard({ run }: { run: (p: string, f?: Record<string, unknown>) => Promise<void> }) {
  const [tg, setTg] = useState('');
  const [email, setEmail] = useState('');
  const [channel, setChannel] = useState('telegram');
  return (
    <Card>
      <CardHeader>
        <CardTitle>Выдать код</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-4">
        <Input placeholder="Telegram id" value={tg} onChange={(e) => setTg(e.target.value)} />
        <Input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <select className="h-10 rounded-md border border-input bg-secondary px-3 text-sm" value={channel} onChange={(e) => setChannel(e.target.value)}>
          <option value="telegram">Telegram</option>
          <option value="email">Email</option>
          <option value="none">Только показать</option>
        </select>
        <Button onClick={() => void run('/admin/issue', { telegramId: tg, email, channel })}>Выдать</Button>
      </CardContent>
    </Card>
  );
}

function PromoCard({
  run,
  promos,
}: {
  run: (p: string, f?: Record<string, unknown>) => Promise<void>;
  promos: NonNullable<HomeData['promos']>;
}) {
  const [code, setCode] = useState('');
  const [days, setDays] = useState('1');
  const [maxUses, setMaxUses] = useState('1');
  return (
    <Card>
      <CardHeader>
        <CardTitle>Промокоды</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-4">
          <Input placeholder="Код (пусто = сгенерировать)" value={code} onChange={(e) => setCode(e.target.value)} />
          <Input type="number" value={days} onChange={(e) => setDays(e.target.value)} />
          <Input type="number" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} />
          <Button onClick={() => void run('/admin/promo', { code, days, maxUses })}>Создать</Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Код</TableHead>
              <TableHead>Дни</TableHead>
              <TableHead>Uses</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {promos.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  <span className={p.revoked ? 'text-muted-foreground' : 'font-mono'}>{p.code}</span> <CopyBtn value={p.code} />
                </TableCell>
                <TableCell>{p.days}</TableCell>
                <TableCell>
                  {p.uses}/{p.maxUses}
                </TableCell>
                <TableCell>
                  {!p.revoked ? (
                    <Button size="sm" variant="secondary" onClick={() => void run('/admin/promo-revoke', { promoId: p.id })}>
                      Отозвать
                    </Button>
                  ) : (
                    <span className="text-muted-foreground">отозван</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

const SETTINGS_FIELDS: [string, string][] = [
  ['botToken', 'Токен бота'],
  ['botUsername', 'Username бота'],
  ['publicOrigin', 'Публичный URL'],
  ['adminTelegramIds', 'Telegram id админов'],
  ['yoomoneyWallet', 'ЮMoney кошелёк'],
  ['yoomoneySecret', 'ЮMoney секрет'],
  ['smtpHost', 'SMTP host'],
  ['smtpUser', 'SMTP user'],
  ['smtpPass', 'SMTP pass'],
  ['smtpFrom', 'SMTP from'],
  ['priceRub', 'Цена ₽'],
  ['periodDays', 'Период дней'],
  ['extraDeviceRub', 'Доп. устройство ₽'],
];

type ServiceProbe = {
  ok: boolean;
  status: number;
  latencyMs: number;
  error: string;
  checkedAt: number;
  enabled?: boolean;
  configured?: boolean;
  url?: string;
  note?: string;
};

type ServicesPayload = {
  jackett: ServiceProbe;
  jacred: ServiceProbe;
  torrserver: ServiceProbe;
  indexerUser?: string;
  indexerPassConfigured?: boolean;
};

function HealthBadge({ row }: { row?: ServiceProbe }) {
  if (!row) return <Badge variant="secondary">—</Badge>;
  if (!row.configured) return <Badge variant="secondary">не настроено</Badge>;
  if (row.ok) return <Badge variant="ok">ok · {row.latencyMs} мс</Badge>;
  return <Badge variant="bad">{row.error || 'down'}</Badge>;
}

function ServicesCard({
  csrf,
  settings,
  onSaved,
}: {
  csrf: string;
  settings: Record<string, string | number | boolean>;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    jackettUrl: String(settings.jackettUrl ?? ''),
    jackettApiKey: String(settings.jackettApiKey ?? ''),
    jackettEnabled: settings.jackettEnabled !== false,
    jacredUrl: String(settings.jacredUrl ?? ''),
    jacredApiKey: String(settings.jacredApiKey ?? ''),
    jacredEnabled: settings.jacredEnabled !== false,
    torrserverUrl: String(settings.torrserverUrl ?? ''),
    indexerUser: String(settings.indexerUser ?? ''),
    indexerPass: String(settings.indexerPass ?? ''),
  });
  const [services, setServices] = useState<ServicesPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    setForm({
      jackettUrl: String(settings.jackettUrl ?? ''),
      jackettApiKey: String(settings.jackettApiKey ?? ''),
      jackettEnabled: settings.jackettEnabled !== false,
      jacredUrl: String(settings.jacredUrl ?? ''),
      jacredApiKey: String(settings.jacredApiKey ?? ''),
      jacredEnabled: settings.jacredEnabled !== false,
      torrserverUrl: String(settings.torrserverUrl ?? ''),
      indexerUser: String(settings.indexerUser ?? ''),
      indexerPass: String(settings.indexerPass ?? ''),
    });
  }, [settings]);

  async function probe() {
    setBusy(true);
    setErr('');
    try {
      const res = await api<{ ok?: boolean; services?: ServicesPayload; auth?: boolean }>('/admin/api/services');
      if (res.auth === false) {
        setErr('Нужен вход');
        return;
      }
      setServices(res.services || null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'probe failed');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void probe();
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const res = await post('/admin/services', csrf, {
        ...form,
        jackettEnabled: form.jackettEnabled ? 'true' : 'false',
        jacredEnabled: form.jacredEnabled ? 'true' : 'false',
      });
      if (res.auth === false) {
        setErr('Нужен вход');
        return;
      }
      if (res.services) setServices(res.services as ServicesPayload);
      toast('Сервисы сохранены');
      onSaved();
      await probe();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'save failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>Сервисы VPS</CardTitle>
            <CardDescription>
              Ключи только на сервере. Телефон ходит через billing proxy при активной подписке. TorrServer на VPS — для JacRed
              (ops), не для пользователей.
            </CardDescription>
          </div>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => void probe()}>
            {busy ? '…' : 'Проверить сейчас'}
          </Button>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-md border border-border p-3">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="font-medium">Jackett</span>
              <HealthBadge row={services?.jackett} />
            </div>
            <div className="truncate text-xs text-muted-foreground">{services?.jackett?.url || form.jackettUrl || '—'}</div>
            <div className="text-xs text-muted-foreground">
              подписчикам: {form.jackettEnabled ? 'вкл' : 'выкл'}
            </div>
          </div>
          <div className="rounded-md border border-border p-3">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="font-medium">JacRed</span>
              <HealthBadge row={services?.jacred} />
            </div>
            <div className="truncate text-xs text-muted-foreground">{services?.jacred?.url || form.jacredUrl || '—'}</div>
            <div className="text-xs text-muted-foreground">
              подписчикам: {form.jacredEnabled ? 'вкл' : 'выкл'}
            </div>
          </div>
          <div className="rounded-md border border-border p-3">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="font-medium">TorrServer</span>
              <HealthBadge row={services?.torrserver} />
            </div>
            <div className="truncate text-xs text-muted-foreground">{services?.torrserver?.url || form.torrserverUrl || '—'}</div>
            <div className="text-xs text-muted-foreground">только мониторинг</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Настройки сервисов</CardTitle>
          <CardDescription>Пустой или маскированный секрет не перезаписывает текущий.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={(e) => void save(e)}>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="jackettUrl">Jackett URL</Label>
                <Input
                  id="jackettUrl"
                  value={form.jackettUrl}
                  onChange={(e) => setForm({ ...form, jackettUrl: e.target.value })}
                  placeholder="http://jackett:9117"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="jackettApiKey">Jackett API key</Label>
                <Input
                  id="jackettApiKey"
                  value={form.jackettApiKey}
                  onChange={(e) => setForm({ ...form, jackettApiKey: e.target.value })}
                  placeholder="••••••••"
                />
              </div>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input
                  type="checkbox"
                  checked={form.jackettEnabled}
                  onChange={(e) => setForm({ ...form, jackettEnabled: e.target.checked })}
                />
                Jackett доступен подписчикам
              </label>
              <div className="space-y-1">
                <Label htmlFor="jacredUrl">JacRed URL</Label>
                <Input
                  id="jacredUrl"
                  value={form.jacredUrl}
                  onChange={(e) => setForm({ ...form, jacredUrl: e.target.value })}
                  placeholder="http://jacred:9117"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="jacredApiKey">JacRed API key</Label>
                <Input
                  id="jacredApiKey"
                  value={form.jacredApiKey}
                  onChange={(e) => setForm({ ...form, jacredApiKey: e.target.value })}
                  placeholder="••••••••"
                />
              </div>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input
                  type="checkbox"
                  checked={form.jacredEnabled}
                  onChange={(e) => setForm({ ...form, jacredEnabled: e.target.checked })}
                />
                JacRed доступен подписчикам
              </label>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="torrserverUrl">TorrServer URL (VPS, ops)</Label>
                <Input
                  id="torrserverUrl"
                  value={form.torrserverUrl}
                  onChange={(e) => setForm({ ...form, torrserverUrl: e.target.value })}
                  placeholder="http://torrserver:8090"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="indexerUser">Basic-auth логин (Caddy)</Label>
                <Input
                  id="indexerUser"
                  value={form.indexerUser}
                  onChange={(e) => setForm({ ...form, indexerUser: e.target.value })}
                  placeholder="omp"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="indexerPass">Basic-auth пароль</Label>
                <Input
                  id="indexerPass"
                  value={form.indexerPass}
                  onChange={(e) => setForm({ ...form, indexerPass: e.target.value })}
                  placeholder="••••••••"
                />
              </div>
            </div>
            {err ? <Alert variant="destructive">{err}</Alert> : null}
            <Button type="submit" disabled={busy}>
              Сохранить
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function SettingsCard({
  run,
  settings,
  storage,
}: {
  run: (p: string, f?: Record<string, unknown>) => Promise<void>;
  settings: Record<string, string | number>;
  storage?: HomeData['storage'];
}) {
  const [form, setForm] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {};
    for (const [k] of SETTINGS_FIELDS) o[k] = String(settings[k] ?? '');
    return o;
  });
  useEffect(() => {
    const o: Record<string, string> = {};
    for (const [k] of SETTINGS_FIELDS) o[k] = String(settings[k] ?? '');
    setForm(o);
  }, [settings]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Настройки</CardTitle>
        <CardDescription>
          Хранилище: {storage?.engine} · {storage?.path}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run('/admin/settings', form);
          }}
        >
          {SETTINGS_FIELDS.map(([name, label]) => (
            <div key={name} className="space-y-1">
              <Label htmlFor={name}>{label}</Label>
              <Input id={name} value={form[name] || ''} onChange={(e) => setForm({ ...form, [name]: e.target.value })} />
            </div>
          ))}
          <Button type="submit">Сохранить</Button>
        </form>
      </CardContent>
    </Card>
  );
}

function SecurityCard({
  run,
  sessions,
  sessionId,
  audit,
  fails,
}: {
  run: (p: string, f?: Record<string, unknown>) => Promise<void>;
  sessions: NonNullable<HomeData['sessions']>;
  sessionId: string;
  audit: NonNullable<HomeData['audit']>;
  fails: NonNullable<HomeData['fails']>;
}) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [next2, setNext2] = useState('');
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Смена пароля</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-4">
          <Input type="password" placeholder="Текущий" value={current} onChange={(e) => setCurrent(e.target.value)} />
          <Input type="password" placeholder="Новый" value={next} onChange={(e) => setNext(e.target.value)} />
          <Input type="password" placeholder="Ещё раз" value={next2} onChange={(e) => setNext2(e.target.value)} />
          <Button onClick={() => void run('/admin/password', { current, next, next2 })}>Сменить</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Сессии</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Id</TableHead>
                <TableHead>Активность</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    {s.id.slice(0, 8)}…{s.id === sessionId ? ' (эта)' : ''}
                  </TableCell>
                  <TableCell>{s.lastSeen ? when(s.lastSeen) : '—'}</TableCell>
                  <TableCell>
                    {s.id !== sessionId ? (
                      <Button size="sm" variant="secondary" onClick={() => void run('/admin/session-revoke', { sessionId: s.id })}>
                        Завершить
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Аудит</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1 text-sm">
            {audit.map((a, i) => (
              <li key={i}>
                <span className="text-muted-foreground">{a.at ? when(a.at) : ''}</span>{' '}
                {a.action} {a.detail}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Отказы кода</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1 text-sm">
            {fails.map((f, i) => (
              <li key={i}>
                {f.at ? when(f.at) : f.atText} · {f.reason} · {f.deviceId}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
