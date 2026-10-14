import { useEffect, useMemo, useState, type FormEvent } from 'react';
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

function Login() {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
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
      <h1 className="mb-1 text-2xl font-bold">OMP Billing</h1>
      <p className="mb-6 text-muted-foreground">Вход в админ-панель</p>
      {err ? <Alert variant="destructive" className="mb-4">{err}</Alert> : null}
      <Card>
        <CardContent className="pt-6">
          <form className="space-y-4" onSubmit={submit}>
            <div className="space-y-2">
              <Label htmlFor="password">Пароль</Label>
              <Input id="password" type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? '…' : 'Войти'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
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
  fails?: { atText: string; reason: string; deviceId: string }[];
  sessions?: { id: string; lastSeen?: number }[];
  audit?: { at?: number; action: string; detail: string }[];
  settings?: Record<string, string | number>;
  storage?: { engine: string; path: string; bytes: number };
};

type UserData = {
  csrf: string;
  flash?: Flash;
  account: { id: string; email: string; telegramId: string; createdText: string };
  subscription?: { paidUntilText: string; active: boolean; deviceLimit: number };
  codes?: { id: string; formatted?: string; bound: boolean; deviceId?: string; openUrl?: string }[];
};

export function App() {
  const [auth, setAuth] = useState<boolean | null>(null);
  const [data, setData] = useState<HomeData | null>(null);
  const [user, setUser] = useState<UserData | null>(null);
  const [tab, setTab] = useState('home');
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [grantDays, setGrantDays] = useState('30');
  const [msg, setMsg] = useState('');
  const params = useMemo(() => new URLSearchParams(location.search), []);

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
              {user.account.telegramId ? (
                <>
                  <Badge variant="ok">{user.account.telegramId}</Badge> <CopyBtn value={user.account.telegramId} />
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
        {user.account.telegramId ? (
          <Card>
            <CardHeader>
              <CardTitle>Сообщение в Telegram</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Textarea value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Текст…" />
              <Button onClick={() => void run('/admin/message', { accountId: user.account.id, text: msg })}>Отправить</Button>
            </CardContent>
          </Card>
        ) : null}
        <div id="toast" className="fixed bottom-6 left-1/2 z-50 hidden -translate-x-1/2 rounded-md bg-primary px-4 py-2 font-bold text-primary-foreground" />
      </main>
    );
  }

  const d = data || ({} as HomeData);
  const subs = (d.subscriptions || []).filter((s) => filter === 'all' || s.status === filter || (filter === 'active' && s.active));

  return (
    <main className="mx-auto max-w-5xl space-y-4 px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">OMP Billing</h1>
          <p className="text-sm text-muted-foreground">
            React + shadcn · {d.storage?.engine || '—'} · {d.storage ? Math.round((d.storage.bytes || 0) / 1024) + ' КБ' : ''}
          </p>
        </div>
        <Button variant="secondary" onClick={() => void run('/admin/logout')}>
          Выйти
        </Button>
      </header>
      <FlashBox flash={d.flash} />
      {(d.alerts || []).length > 0 ? (
        <div className="space-y-2" aria-label="Алерты">
          {d.alerts!.map((a, i) => (
            <AlertItem key={i} a={a} />
          ))}
        </div>
      ) : null}

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
          <TabsTrigger value="subs">Подписки</TabsTrigger>
          <TabsTrigger value="finance">Финансы</TabsTrigger>
          <TabsTrigger value="promos">Промо</TabsTrigger>
          <TabsTrigger value="settings">Настройки</TabsTrigger>
          <TabsTrigger value="security">Доступ</TabsTrigger>
        </TabsList>

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
            <CardContent className="flex flex-col gap-2 sm:flex-row">
              <Input placeholder="Telegram / email / код / id" value={q} onChange={(e) => setQ(e.target.value)} />
              <Button onClick={() => void run('/admin/find', { q })}>Найти</Button>
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
                      <TableCell>{p.at ? new Date(p.at).toISOString().slice(0, 16).replace('T', ' ') : '—'}</TableCell>
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
  ['jackettUrl', 'Jackett URL'],
  ['jackettApiKey', 'Jackett API key'],
  ['smtpHost', 'SMTP host'],
  ['smtpUser', 'SMTP user'],
  ['smtpPass', 'SMTP pass'],
  ['smtpFrom', 'SMTP from'],
  ['priceRub', 'Цена ₽'],
  ['periodDays', 'Период дней'],
  ['extraDeviceRub', 'Доп. устройство ₽'],
];

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
                <TableHead>Last seen</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    {s.id.slice(0, 8)}…{s.id === sessionId ? ' (эта)' : ''}
                  </TableCell>
                  <TableCell>{s.lastSeen ? new Date(s.lastSeen).toISOString().slice(0, 16).replace('T', ' ') : '—'}</TableCell>
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
                <span className="text-muted-foreground">{a.at ? new Date(a.at).toISOString().slice(0, 16).replace('T', ' ') : ''}</span>{' '}
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
                {f.atText} · {f.reason} · {f.deviceId}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
