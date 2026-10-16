import { useEffect, useState, type FormEvent } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CopyBtn, DayChart, Devices, Pager, Skeleton, SubStatus, toast } from '@/components/chrome';
import { api, post, type PostResult } from '@/lib/api';
import { auditAction, AUDIT_FILTERS, downloadCsv, eventKind, FAIL_FILTERS, failReason, problemKind, serviceError, when } from '@/lib/text';
import type { HomeData, PaymentRow, ProblemRow, SubRow } from '@/lib/types';

type Run = (path: string, fields?: Record<string, unknown>) => Promise<PostResult | undefined>;

const selectClass = 'h-10 rounded-md border border-input bg-secondary px-3 text-sm text-foreground';

export function IssueCard({ run }: { run: Run }) {
  const [tg, setTg] = useState('');
  const [email, setEmail] = useState('');
  const [channel, setChannel] = useState('telegram');
  const [days, setDays] = useState('30');
  const [count, setCount] = useState('1');
  return (
    <Card>
      <CardHeader>
        <CardTitle>Выдать код</CardTitle>
        <CardDescription>Дней — срок новой подписки. Если подписка уже есть, код добавляется к ней, дата окончания не меняется.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2 md:grid-cols-5">
          <Input placeholder="Telegram id" value={tg} onChange={(e) => setTg(e.target.value)} />
          <Input placeholder="Почта" value={email} onChange={(e) => setEmail(e.target.value)} />
          <select className={selectClass} value={channel} onChange={(e) => setChannel(e.target.value)} aria-label="Куда отправить">
            <option value="telegram">Telegram</option>
            <option value="email">Почта</option>
            <option value="none">Только показать</option>
          </select>
          <select className={selectClass} value={days} onChange={(e) => setDays(e.target.value)} aria-label="Дней">
            <option value="1">1 день</option>
            <option value="7">7 дней</option>
            <option value="30">30 дней</option>
            <option value="90">90 дней</option>
            <option value="365">365 дней</option>
          </select>
          <Button onClick={() => void run('/admin/issue', { telegramId: tg, email, channel, days })}>Выдать</Button>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Сколько кодов</span>
            <Input type="number" min={1} max={100} value={count} onChange={(e) => setCount(e.target.value)} />
          </label>
          <Button
            variant="secondary"
            onClick={() => {
              const n = Number(count) || 1;
              if (!window.confirm('Создать ' + n + ' новых кодов на ' + days + ' дн.?')) return;
              void run('/admin/issue-bulk', { count: n, days }).then((res) => {
                const codes = res?.extra?.codes || [];
                if (!codes.length) return;
                downloadCsv(
                  'omp-codes.csv',
                  [['код', 'аккаунт', 'до']].concat(codes.map((c) => [c.code, c.accountId || '', c.paidUntil ? new Date(c.paidUntil).toISOString().slice(0, 10) : ''])),
                );
                toast('CSV со кодами скачан');
              });
            }}
          >
            Создать пакетом
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function PromoCard({ run, promos }: { run: Run; promos: NonNullable<HomeData['promos']> }) {
  const [code, setCode] = useState('');
  const [days, setDays] = useState('1');
  const [maxUses, setMaxUses] = useState('1');
  const [count, setCount] = useState('1');
  return (
    <Card>
      <CardHeader>
        <CardTitle>Промокоды</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 md:grid-cols-5">
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Код</span>
            <Input placeholder="пусто = сгенерировать" value={code} onChange={(e) => setCode(e.target.value)} />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Дней</span>
            <Input type="number" value={days} onChange={(e) => setDays(e.target.value)} />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Активаций</span>
            <Input type="number" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Количество</span>
            <Input type="number" min={1} max={100} value={count} onChange={(e) => setCount(e.target.value)} />
          </label>
          <div className="flex items-end">
            <Button
              onClick={() => {
                const n = Number(count) || 1;
                void run('/admin/promo', { code, days, maxUses, count: n }).then((res) => {
                  const list = res?.extra?.promos || [];
                  if (list.length > 1) {
                    downloadCsv(
                      'omp-promos-new.csv',
                      [['код', 'дней', 'активаций']].concat(list.map((p) => [p.code, String(p.days), String(p.maxUses)])),
                    );
                  }
                });
              }}
            >
              Создать
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap gap-3 text-sm">
          <a className="text-primary" href="/admin/promos.csv">
            Скачать все промокоды (CSV)
          </a>
        </div>
        <Table className="min-w-[36rem]">
          <TableHeader>
            <TableRow>
              <TableHead>Код</TableHead>
              <TableHead>Дни</TableHead>
              <TableHead>Использования</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {promos.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-muted-foreground">
                  Нет промокодов
                </TableCell>
              </TableRow>
            ) : null}
            {promos.map((p) => {
              const exhausted = p.uses >= p.maxUses;
              return (
                <TableRow key={p.id}>
                  <TableCell>
                    <span className={p.revoked ? 'text-muted-foreground' : 'font-mono'}>{p.code}</span> <CopyBtn value={p.code} />
                  </TableCell>
                  <TableCell>{p.days}</TableCell>
                  <TableCell>
                    {p.uses}/{p.maxUses}
                  </TableCell>
                  <TableCell>
                    {p.revoked ? (
                      <span className="text-muted-foreground">отозван</span>
                    ) : exhausted ? (
                      <span className="text-muted-foreground">использован</span>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          if (!window.confirm('Отозвать промокод ' + p.code + '?')) return;
                          void run('/admin/promo-revoke', { promoId: p.id });
                        }}
                      >
                        Отозвать
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export function SubsPanel({
  subs,
  filter,
  setFilter,
  csrf,
}: {
  subs: SubRow[];
  filter: string;
  setFilter: (id: string) => void;
  csrf: string;
}) {
  const shown = subs.filter((s) => {
    if (filter === 'all') return true;
    if (filter === 'week') return s.status === 'soon' || s.status === 'expiring';
    if (filter === 'active') return s.active;
    return s.status === filter;
  });
  const expiring = subs.filter((s) => (s.status === 'soon' || s.status === 'expiring') && s.telegramId);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Подписки</CardTitle>
        <CardDescription>
          <span className="flex flex-wrap gap-1">
            {(
              [
                ['all', 'Все'],
                ['active', 'Активные'],
                ['week', 'Истекают за 7 дней'],
                ['unbound', 'Без устройства'],
                ['expired', 'Истекшие'],
              ] as const
            ).map(([id, label]) => (
              <Button key={id} size="sm" variant={filter === id ? 'default' : 'secondary'} onClick={() => setFilter(id)}>
                {label}
              </Button>
            ))}
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-3 text-sm">
          <a className="text-primary" href="/admin/subscriptions.csv">
            Скачать подписки (CSV)
          </a>
          <a className="text-primary" href="/admin/users.csv">
            Скачать пользователей (CSV)
          </a>
          <Button
            size="sm"
            variant="secondary"
            disabled={expiring.length === 0}
            onClick={() => {
              if (!expiring.length) return;
              if (!window.confirm('Отправить напоминание ' + expiring.length + ' пользователям в Telegram?')) return;
              const text = 'Подписка OMP скоро закончится. Продлить можно в боте кнопкой «Продлить».';
              void (async () => {
                let ok = 0;
                for (let i = 0; i < expiring.length; i++) {
                  const res = await post('/admin/message', csrf, { accountId: expiring[i].accountId, text, quiet: true });
                  if (res.ok) ok += 1;
                }
                toast('Отправлено: ' + ok + ' из ' + expiring.length);
              })();
            }}
          >
            Напомнить истекающим ({expiring.length})
          </Button>
        </div>
        <Table className="min-w-[40rem]">
          <TableHeader>
            <TableRow>
              <TableHead>Кто</TableHead>
              <TableHead>До</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead>Устройства</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground">
                  Нет подписок
                </TableCell>
              </TableRow>
            ) : null}
            {shown.map((s) => (
              <TableRow key={s.id}>
                <TableCell>
                  {s.who}
                  <CopyBtn value={s.telegramId} />
                </TableCell>
                <TableCell>{s.paidUntilText}</TableCell>
                <TableCell>
                  <SubStatus status={s.status} />
                </TableCell>
                <TableCell>
                  <Devices bound={s.bound} limit={s.deviceLimit} over={s.overLimit} />
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
  );
}

function ProblemList({ rows }: { rows: ProblemRow[] }) {
  if (!rows.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Проблемы</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3 text-sm">
          {rows.map((p, i) => {
            const bits = [p.amount ? p.amount + ' ₽' : '', p.label || '', p.operationId || ''].filter(Boolean);
            return (
              <li key={i} className="rounded-md border border-red-900/50 bg-red-950/30 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="bad">{problemKind(p.kind)}</Badge>
                  <span className="text-muted-foreground">{p.at ? when(p.at) : ''}</span>
                </div>
                <div className="mt-1 break-all text-zinc-100">{bits.length ? bits.join(' · ') : p.text || 'Нет подробностей'}</div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

export function FinancePanel({ home }: { home: HomeData }) {
  const [rows, setRows] = useState<PaymentRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [range, setRange] = useState('30');
  const [span, setSpan] = useState<30 | 90>(30);
  const limit = 20;

  useEffect(() => {
    let stop = false;
    const now = Date.now();
    const from = range === 'all' ? 0 : now - Number(range) * 24 * 60 * 60 * 1000;
    const params = new URLSearchParams({
      q,
      offset: String((page - 1) * limit),
      limit: String(limit),
    });
    if (from) params.set('from', String(from));
    void api<{ payments?: PaymentRow[]; total?: number; auth?: boolean }>('/admin/api/payments?' + params.toString()).then((r) => {
      if (stop || r.auth === false) return;
      setRows(r.payments || []);
      setTotal(r.total || 0);
    });
    return () => {
      stop = true;
    };
  }, [page, q, range]);

  const series = (home.series || []).slice(span === 30 ? -30 : -90);
  const pages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {(
          [
            [home.finance?.summary?.day, 'сегодня'],
            [home.finance?.summary?.week, 'неделя'],
            [home.finance?.summary?.month, 'месяц'],
          ] as const
        ).map(([row, label]) => (
          <Card key={label}>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold">{Math.round(row?.sum || 0)}</div>
              <div className="text-xs text-muted-foreground">
                ₽ {label} · {row?.count || 0}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle>Графики</CardTitle>
          <div className="flex gap-2">
            <Button size="sm" variant={span === 30 ? 'default' : 'secondary'} onClick={() => setSpan(30)}>
              30 дней
            </Button>
            <Button size="sm" variant={span === 90 ? 'default' : 'secondary'} onClick={() => setSpan(90)}>
              90 дней
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-6 lg:grid-cols-2">
          <DayChart rows={series} field="revenue" label="Выручка по дням, ₽" />
          <DayChart rows={series} field="subs" label="Новые подписки по дням" />
        </CardContent>
      </Card>
      <p>
        <a className="text-primary" href="/admin/finance.csv">
          Скачать CSV за 30 дней
        </a>
      </p>
      <ProblemList rows={home.finance?.problems || []} />
      <Card>
        <CardHeader>
          <CardTitle>Платежи</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Input
              className="max-w-xs"
              placeholder="Поиск: кто, метка, сумма"
              value={q}
              onChange={(e) => {
                setPage(1);
                setQ(e.target.value);
              }}
            />
            <select
              className={selectClass}
              value={range}
              aria-label="Период"
              onChange={(e) => {
                setPage(1);
                setRange(e.target.value);
              }}
            >
              <option value="7">7 дней</option>
              <option value="30">30 дней</option>
              <option value="90">90 дней</option>
              <option value="all">Все</option>
            </select>
          </div>
          {rows === null ? (
            <div className="space-y-2">
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
            </div>
          ) : (
            <Table className="min-w-[40rem]">
              <TableHeader>
                <TableRow>
                  <TableHead>Когда</TableHead>
                  <TableHead>Сумма</TableHead>
                  <TableHead>Кто</TableHead>
                  <TableHead>Метка</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-muted-foreground">
                      Нет платежей
                    </TableCell>
                  </TableRow>
                ) : null}
                {rows.map((p, i) => (
                  <TableRow key={(p.operationId || '') + i}>
                    <TableCell>{p.at ? when(p.at) : '—'}</TableCell>
                    <TableCell>{p.amount || '—'}</TableCell>
                    <TableCell>
                      {p.accountId ? (
                        <a className="text-primary" href={'/admin/?id=' + encodeURIComponent(p.accountId)}>
                          {p.who || p.accountId.slice(0, 8)}
                        </a>
                      ) : (
                        p.who || '—'
                      )}
                    </TableCell>
                    <TableCell className="break-all font-mono text-xs text-muted-foreground">{p.label || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <Pager page={page} pages={pages} total={total} onPage={setPage} />
        </CardContent>
      </Card>
    </div>
  );
}

export function HomeFeed({ events }: { events: NonNullable<HomeData['events']> }) {
  const [kind, setKind] = useState('');
  const [page, setPage] = useState(1);
  const size = 15;
  const filtered = events.filter((e) => !kind || e.kind === kind);
  const pages = Math.max(1, Math.ceil(filtered.length / size));
  const slice = filtered.slice((page - 1) * size, page * size);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Лента</CardTitle>
        <CardDescription>
          <select
            className={selectClass}
            value={kind}
            aria-label="Тип события"
            onChange={(e) => {
              setPage(1);
              setKind(e.target.value);
            }}
          >
            <option value="">Все события</option>
            <option value="pay">Оплата</option>
            <option value="promo">Промо</option>
            <option value="activate">Активация</option>
            <option value="fail">Отказ</option>
          </select>
        </CardDescription>
      </CardHeader>
      <CardContent>
        {slice.length === 0 ? <p className="text-muted-foreground">Пока пусто</p> : null}
        <ul className="space-y-2 text-sm">
          {slice.map((e, i) => (
            <li key={i}>
              <Badge variant="count" className="mr-2">
                {eventKind(e.kind)}
              </Badge>
              {e.text}{' '}
              {e.accountId ? (
                <a className="text-primary" href={'/admin/?id=' + encodeURIComponent(e.accountId)}>
                  карточка
                </a>
              ) : null}
            </li>
          ))}
        </ul>
        <Pager page={page} pages={pages} total={filtered.length} onPage={setPage} />
      </CardContent>
    </Card>
  );
}

const SETTING_GROUPS: { title: string; fields: [string, string][] }[] = [
  {
    title: 'Бот',
    fields: [
      ['botToken', 'Токен бота'],
      ['botUsername', 'Имя бота'],
      ['publicOrigin', 'Публичный адрес'],
      ['adminTelegramIds', 'Telegram id администраторов'],
    ],
  },
  {
    title: 'Платежи',
    fields: [
      ['yoomoneyWallet', 'Кошелёк ЮMoney'],
      ['yoomoneySecret', 'Секрет ЮMoney'],
    ],
  },
  {
    title: 'SMTP',
    fields: [
      ['smtpHost', 'SMTP-сервер'],
      ['smtpUser', 'SMTP-логин'],
      ['smtpPass', 'SMTP-пароль'],
      ['smtpFrom', 'SMTP-отправитель'],
    ],
  },
  {
    title: 'Цены',
    fields: [
      ['priceRub', 'Цена, ₽'],
      ['periodDays', 'Период, дней'],
      ['extraDeviceRub', 'Доп. устройство, ₽'],
    ],
  },
];

export function SettingsCard({ run, settings, storage }: { run: Run; settings: Record<string, string | number | boolean>; storage?: HomeData['storage'] }) {
  const [form, setForm] = useState<Record<string, string>>({});
  const [notify, setNotify] = useState(true);
  useEffect(() => {
    const o: Record<string, string> = {};
    for (const group of SETTING_GROUPS) {
      for (const [k] of group.fields) o[k] = String(settings[k] ?? '');
    }
    setForm(o);
    setNotify(settings.adminNotify !== false);
  }, [settings]);
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void run('/admin/settings', { ...form, adminNotify: notify ? 'true' : 'false' });
      }}
    >
      <p className="text-sm text-muted-foreground">
        Хранилище: {storage?.engine || '—'}
        {storage?.path ? ' · ' + storage.path : ''}
      </p>
      {SETTING_GROUPS.map((group) => (
        <Card key={group.title}>
          <CardHeader>
            <CardTitle>{group.title}</CardTitle>
            {group.title === 'Платежи' ? <CardDescription>Кошелёк показывается частично. Чтобы сменить, введите новый номер целиком.</CardDescription> : null}
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            {group.fields.map(([name, label]) => (
              <div key={name} className="space-y-1">
                <Label htmlFor={name}>{label}</Label>
                <Input id={name} value={form[name] || ''} onChange={(e) => setForm({ ...form, [name]: e.target.value })} />
              </div>
            ))}
            {group.title === 'Бот' ? (
              <label className="flex items-center gap-2 text-sm md:col-span-2">
                <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
                Уведомлять администраторов в Telegram (оплата, ошибка оплаты, падение сервиса, новое сообщение поддержки)
              </label>
            ) : null}
          </CardContent>
        </Card>
      ))}
      <Button type="submit">Сохранить</Button>
    </form>
  );
}

type ServiceProbe = {
  ok: boolean;
  status: number;
  latencyMs: number;
  error: string;
  checkedAt: number;
  enabled?: boolean;
  configured?: boolean;
  url?: string;
};

type ServicesPayload = {
  jackett: ServiceProbe;
  jacred: ServiceProbe;
  torrserver: ServiceProbe;
};

function HealthBadge({ row, checking }: { row?: ServiceProbe; checking?: boolean }) {
  if (checking && !row) return <Badge variant="secondary">проверка…</Badge>;
  if (!row) return <Badge variant="secondary">нет данных</Badge>;
  if (!row.configured) return <Badge variant="secondary">не настроено</Badge>;
  if (row.ok) return <Badge variant="ok">работает · {row.latencyMs} мс</Badge>;
  return <Badge variant="bad">{serviceError(row.error)}</Badge>;
}

export function ServicesCard({
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
  const [checkedAt, setCheckedAt] = useState(0);
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

  async function probe(silent?: boolean) {
    setBusy(true);
    setErr('');
    try {
      const res = await api<{ ok?: boolean; services?: ServicesPayload; auth?: boolean }>('/admin/api/services');
      if (res.auth === false) {
        setErr('Нужен вход');
        return;
      }
      setServices(res.services || null);
      const at = Date.now();
      setCheckedAt(at);
      if (!silent) toast('Сервисы проверены · ' + when(at));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось проверить сервисы');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void probe(false);
    // Probe once when the tab opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      toast('Сервисы сохранены');
      onSaved();
      await probe(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось сохранить');
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
              Ключи только на сервере. Телефон ходит через billing при активной подписке. TorrServer на VPS — для мониторинга, не для пользователей.
              {checkedAt ? ' Проверено ' + when(checkedAt) + '.' : ''}
            </CardDescription>
          </div>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => void probe(false)}>
            {busy ? 'Проверка…' : 'Проверить сейчас'}
          </Button>
        </CardHeader>
        <CardContent className="grid gap-3 lg:grid-cols-3">
          {busy && !services ? (
            <>
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
            </>
          ) : (
            <>
              <ServiceBox title="Jackett" row={services?.jackett} fallback={form.jackettUrl} note={'подписчикам: ' + (form.jackettEnabled ? 'вкл' : 'выкл')} checking={busy} />
              <ServiceBox title="JacRed" row={services?.jacred} fallback={form.jacredUrl} note={'подписчикам: ' + (form.jacredEnabled ? 'вкл' : 'выкл')} checking={busy} />
              <ServiceBox title="TorrServer" row={services?.torrserver} fallback={form.torrserverUrl} note="только мониторинг" checking={busy} />
            </>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Настройки сервисов</CardTitle>
          <CardDescription>Пустой или замаскированный секрет не перезаписывает текущий.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={(e) => void save(e)}>
            <div className="grid gap-3 md:grid-cols-2">
              <Field id="jackettUrl" label="Адрес Jackett" value={form.jackettUrl} onChange={(v) => setForm({ ...form, jackettUrl: v })} placeholder="http://jackett:9117" />
              <Field id="jackettApiKey" label="Ключ API Jackett" value={form.jackettApiKey} onChange={(v) => setForm({ ...form, jackettApiKey: v })} placeholder="••••••••" />
              <Check label="Jackett доступен подписчикам" checked={form.jackettEnabled} onChange={(v) => setForm({ ...form, jackettEnabled: v })} />
              <Field id="jacredUrl" label="Адрес JacRed" value={form.jacredUrl} onChange={(v) => setForm({ ...form, jacredUrl: v })} placeholder="http://jacred:9117" />
              <Field id="jacredApiKey" label="Ключ API JacRed" value={form.jacredApiKey} onChange={(v) => setForm({ ...form, jacredApiKey: v })} placeholder="••••••••" />
              <Check label="JacRed доступен подписчикам" checked={form.jacredEnabled} onChange={(v) => setForm({ ...form, jacredEnabled: v })} />
              <Field id="torrserverUrl" label="Адрес TorrServer (только мониторинг)" value={form.torrserverUrl} onChange={(v) => setForm({ ...form, torrserverUrl: v })} placeholder="http://torrserver:8090" wide />
              <Field id="indexerUser" label="Логин basic-авторизации" value={form.indexerUser} onChange={(v) => setForm({ ...form, indexerUser: v })} placeholder="omp" />
              <Field id="indexerPass" label="Пароль basic-авторизации" value={form.indexerPass} onChange={(v) => setForm({ ...form, indexerPass: v })} placeholder="••••••••" />
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

function ServiceBox({ title, row, fallback, note, checking }: { title: string; row?: ServiceProbe; fallback: string; note: string; checking: boolean }) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="font-medium">{title}</span>
        <HealthBadge row={row} checking={checking} />
      </div>
      <div className="truncate text-xs text-muted-foreground">{row?.url || fallback || '—'}</div>
      <div className="text-xs text-muted-foreground">{note}</div>
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  wide,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  wide?: boolean;
}) {
  return (
    <div className={'space-y-1 ' + (wide ? 'md:col-span-2' : '')}>
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm md:col-span-2">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function AuditPanel() {
  const [q, setQ] = useState('');
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<{ at?: number; action: string; detail: string }[] | null>(null);
  const [total, setTotal] = useState(0);
  const limit = 30;
  useEffect(() => {
    let stop = false;
    const params = new URLSearchParams({ q, action, offset: String((page - 1) * limit), limit: String(limit) });
    void api<{ audit?: { at?: number; action: string; detail: string }[]; total?: number; auth?: boolean }>('/admin/api/audit?' + params).then((r) => {
      if (stop || r.auth === false) return;
      setRows(r.audit || []);
      setTotal(r.total || 0);
    });
    return () => {
      stop = true;
    };
  }, [q, action, page]);
  const pages = Math.max(1, Math.ceil(total / limit));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Журнал</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Input
            className="max-w-xs"
            placeholder="Поиск"
            value={q}
            onChange={(e) => {
              setPage(1);
              setQ(e.target.value);
            }}
          />
          <select
            className={selectClass}
            value={action}
            aria-label="Действие"
            onChange={(e) => {
              setPage(1);
              setAction(e.target.value);
            }}
          >
            {AUDIT_FILTERS.map(([id, label]) => (
              <option key={id || 'all'} value={id}>
                {label}
              </option>
            ))}
          </select>
        </div>
        {rows === null ? (
          <Skeleton className="h-24" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Записей нет</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {rows.map((a, i) => (
              <li key={i}>
                <span className="text-muted-foreground">{a.at ? when(a.at) : ''}</span> {auditAction(a.action)}{' '}
                <span className="text-muted-foreground">{a.detail}</span>
              </li>
            ))}
          </ul>
        )}
        <Pager page={page} pages={pages} total={total} onPage={setPage} />
      </CardContent>
    </Card>
  );
}

export function FailsPanel() {
  const [reason, setReason] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<{ at?: number; reason: string; deviceId: string }[] | null>(null);
  const [total, setTotal] = useState(0);
  const limit = 30;
  useEffect(() => {
    let stop = false;
    const params = new URLSearchParams({ reason, q, offset: String((page - 1) * limit), limit: String(limit) });
    void api<{ fails?: { at?: number; reason: string; deviceId: string }[]; total?: number; auth?: boolean }>('/admin/api/fails?' + params).then((r) => {
      if (stop || r.auth === false) return;
      setRows(r.fails || []);
      setTotal(r.total || 0);
    });
    return () => {
      stop = true;
    };
  }, [reason, q, page]);
  const pages = Math.max(1, Math.ceil(total / limit));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Неудачные активации</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Input
            className="max-w-xs"
            placeholder="Устройство"
            value={q}
            onChange={(e) => {
              setPage(1);
              setQ(e.target.value);
            }}
          />
          <select
            className={selectClass}
            value={reason}
            aria-label="Причина"
            onChange={(e) => {
              setPage(1);
              setReason(e.target.value);
            }}
          >
            {FAIL_FILTERS.map(([id, label]) => (
              <option key={id || 'all'} value={id}>
                {label}
              </option>
            ))}
          </select>
        </div>
        {rows === null ? (
          <Skeleton className="h-24" />
        ) : (
          <Table className="min-w-[32rem]">
            <TableHeader>
              <TableRow>
                <TableHead>Когда</TableHead>
                <TableHead>Причина</TableHead>
                <TableHead>Устройство</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-muted-foreground">
                    Отказов нет
                  </TableCell>
                </TableRow>
              ) : null}
              {rows.map((f, i) => (
                <TableRow key={i}>
                  <TableCell>{f.at ? when(f.at) : '—'}</TableCell>
                  <TableCell>{failReason(f.reason)}</TableCell>
                  <TableCell className="font-mono text-xs">{f.deviceId ? f.deviceId.slice(0, 8) : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <Pager page={page} pages={pages} total={total} onPage={setPage} />
      </CardContent>
    </Card>
  );
}

export function SecurityCard({
  run,
  sessions,
  sessionId,
}: {
  run: Run;
  sessions: NonNullable<HomeData['sessions']>;
  sessionId: string;
}) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [next2, setNext2] = useState('');
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Смена пароля</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 md:grid-cols-4">
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
          <Table className="min-w-[28rem]">
            <TableHeader>
              <TableRow>
                <TableHead>Сессия</TableHead>
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
    </div>
  );
}
