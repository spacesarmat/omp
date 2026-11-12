import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useLive } from '@/lib/live';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable } from '@/components/data-table';
import { post } from '@/lib/api';
import type { DeskData, DeskDevice, DeskUser } from '@/lib/desk';
import { Stamp } from '@/components/stamp';
import { toast } from '@/components/chrome';
import { LogDialog } from '@/components/logDialog';
import { healthReport } from '@/lib/logText';
import type { HealthRow } from '@/lib/desk';

function Spark({ rows }: { rows?: { t: string | number; v: number }[] }) {
  const data = rows || [];
  if (!data.length) return <div className="text-xs text-muted-foreground">Нет точек</div>;
  return (
    <div className="h-16 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid stroke="#31342C" vertical={false} />
          <XAxis dataKey="t" hide />
          <YAxis hide />
          <Tooltip contentStyle={{ background: '#181A15', border: '1px solid #31342C', color: '#F2F2E9' }} />
          <Line type="monotone" dataKey="v" stroke="#F9C400" dot={false} strokeWidth={1.5} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/50" onClick={onClose}>
      <aside className="h-full w-full max-w-md overflow-auto border-l border-border bg-card p-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <Button variant="secondary" onClick={onClose}>
            Закрыть
          </Button>
        </div>
        {children}
      </aside>
    </div>
  );
}

export function DeskHome({ data, csrf }: { data?: DeskData; csrf: string }) {
  const health = data?.health || [];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-semibold">{data?.online ?? '-'}</div>
            <div className="text-xs text-muted-foreground">устройств онлайн</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-semibold">{data?.errors ?? '-'}</div>
            <div className="text-xs text-muted-foreground">ошибок за 24 ч</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-xs text-muted-foreground">оплаты, 24 ч</div>
            <Spark rows={data?.spark24} />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-xs text-muted-foreground">оплаты, 7 дн.</div>
            <Spark rows={data?.spark7} />
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Сервисы</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 md:grid-cols-2">
          {health.map((h) => (
            <div key={h.name} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <div>
                <div className="font-medium">{h.name}</div>
                <div className="font-mono text-xs text-muted-foreground">
                  {h.latencyMs} мс · успех {h.success == null ? '-' : h.success + '%'}
                  {h.lastError ? ' · ' + h.lastError : ''}
                </div>
              </div>
              <Badge variant={h.ok ? 'ok' : h.ok === false ? 'bad' : 'warn'}>{h.ok ? 'ок' : h.ok === false ? 'нет' : '-'}</Badge>
            </div>
          ))}
          <SourceCheck csrf={csrf} label="Проверить источники" />
        </CardContent>
      </Card>
    </div>
  );
}

export function UsersDesk({ users, go }: { users: DeskUser[]; go: (id: string) => void }) {
  const [row, setRow] = useState<DeskUser | null>(null);
  return (
    <>
      <DataTable
        name="omp-users-view"
        rows={users}
        search={(r, q) => (r.who + ' ' + r.telegramId + ' ' + r.email + ' ' + r.id).toLowerCase().indexOf(q) >= 0}
        onRow={setRow}
        bulk={[{ label: 'Открыть первого', run: (list) => list[0] && go(list[0].id) }]}
        columns={[
          { accessorKey: 'who', header: 'Кто' },
          { accessorKey: 'telegramId', header: 'Telegram', cell: ({ getValue }) => <span className="font-mono text-xs">{String(getValue() || '-')}</span> },
          { accessorKey: 'email', header: 'Почта' },
          { accessorKey: 'active', header: 'Подписка', cell: ({ getValue }) => (getValue() ? 'активна' : 'нет') },
        ]}
      />
      {row ? (
        <Drawer title={row.who} onClose={() => setRow(null)}>
          <p className="font-mono text-xs text-muted-foreground">{row.id}</p>
          <p className="mt-2">Telegram {row.telegramId || '-'}</p>
          <p>Почта {row.email || '-'}</p>
          <Button className="mt-3" onClick={() => go(row.id)}>
            Карточка
          </Button>
        </Drawer>
      ) : null}
    </>
  );
}

export function DevicesDesk({ rows }: { rows: DeskDevice[] }) {
  const [row, setRow] = useState<DeskDevice | null>(null);
  return (
    <>
      <DataTable
        name="omp-devices"
        rows={rows}
        search={(r, q) => (r.deviceId + ' ' + r.name + ' ' + r.who + ' ' + r.version).toLowerCase().indexOf(q) >= 0}
        onRow={setRow}
        columns={[
          { accessorKey: 'deviceId', header: 'ID', cell: ({ getValue }) => <span className="font-mono text-xs">{String(getValue() || '')}</span> },
          { accessorKey: 'name', header: 'Имя' },
          { accessorKey: 'who', header: 'Аккаунт' },
          { accessorKey: 'online', header: 'Сеть', cell: ({ getValue }) => (getValue() ? 'онлайн' : 'офлайн') },
          { accessorKey: 'version', header: 'Версия' },
          { accessorKey: 'platform', header: 'Платформа' },
          { accessorKey: 'lastSeenAt', header: 'Был', cell: ({ getValue }) => <Stamp ms={Number(getValue()) || 0} /> },
        ]}
      />
      {row ? (
        <Drawer title={row.name || row.deviceId} onClose={() => setRow(null)}>
          <p className="font-mono text-xs">{row.deviceId}</p>
          <p className="mt-2">{row.online ? 'Сейчас онлайн' : 'Офлайн'}</p>
          <p>
            Версия {row.version || '-'} · {row.platform || '-'}
          </p>
          {row.accountId ? (
            <Button className="mt-3" onClick={() => (location.href = '/admin/?id=' + encodeURIComponent(row.accountId))}>
              Аккаунт
            </Button>
          ) : null}
        </Drawer>
      ) : null}
    </>
  );
}

export function SourcesDesk({ data, csrf }: { data?: DeskData; csrf: string }) {
  const rows = data?.sources || [];
  return (
    <div className="space-y-2">
      {rows.map((s) => (
        <Card key={s.name}>
          <CardContent className="flex flex-wrap items-center justify-between gap-2 pt-4">
            <div>
              <div className="font-medium">{s.name}</div>
              <div className="font-mono text-xs text-muted-foreground">
                {s.latencyMs} мс · успех {s.success == null ? '-' : s.success + '%'} · проб {s.samples ?? 0}
                {s.lastError ? ' · ' + s.lastError : ''}
              </div>
            </div>
            <div className="flex gap-2">
              <Badge variant={s.ok ? 'ok' : 'bad'}>{s.enabled === false ? 'выкл' : s.ok ? 'ок' : 'нет'}</Badge>
              {s.name !== 'torrserver' ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    const next = s.enabled === false;
                    if (!next && !window.confirm('Выключить ' + s.name + '?')) return;
                    void post('/admin/api/sources/toggle', csrf, { source: s.name, enabled: next, confirm: next ? '' : 'yes' }).then(() => toast(next ? 'Включено' : 'Выключено'));
                  }}
                >
                  {s.enabled === false ? 'Включить' : 'Выключить'}
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ))}
      <SourceCheck csrf={csrf} label="Проверить сейчас" />
    </div>
  );
}

export function RankDesk({ data, csrf }: { data?: DeskData; csrf: string }) {
  const rank = data?.ranking;
  if (!rank || !rank.available) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Подбор раздач</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">{rank?.note || 'Нет данных'}</CardContent>
      </Card>
    );
  }
  return (
    <DataTable
      name="omp-rank"
      rows={rank.rows}
      search={(r, q) => (r.title + ' ' + r.winner + ' ' + r.infohash).toLowerCase().indexOf(q) >= 0}
      columns={[
        { accessorKey: 'title', header: 'Название' },
        { accessorKey: 'watches', header: 'Просмотры' },
        { accessorKey: 'winner', header: 'Раздача' },
        { accessorKey: 'why', header: 'Почему' },
        {
          id: 'act',
          header: 'Действие',
          cell: ({ row }) => (
            <span className="flex gap-1" onClick={(e) => e.stopPropagation()}>
              <Button
                variant="secondary"
                onClick={() =>
                  void post('/admin/api/rank/pin', csrf, { infohash: row.original.infohash, flag: 'pin', on: !row.original.pinned, confirm: 'yes' })
                }
              >
                {row.original.pinned ? 'Открепить' : 'Закрепить'}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  if (!window.confirm('Запретить раздачу?')) return;
                  void post('/admin/api/rank/pin', csrf, { infohash: row.original.infohash, flag: 'ban', on: !row.original.banned, confirm: 'yes' });
                }}
              >
                {row.original.banned ? 'Снять запрет' : 'Запретить'}
              </Button>
            </span>
          ),
        },
      ]}
    />
  );
}

export function FunnelDesk({ data }: { data?: DeskData }) {
  const steps = data?.funnel?.steps || [];
  const est = data?.funnel?.estimated;
  return (
    <div className="space-y-3">
      <div className="grid gap-2 md:grid-cols-5">
        {steps.map((s) => (
          <Card key={s.name}>
            <CardContent className="pt-4">
              <div className="text-xs text-muted-foreground">{s.label}</div>
              <div className="text-2xl font-semibold">{s.users}</div>
              <div className="text-xs text-muted-foreground">{s.conversion == null ? 'первый шаг' : s.conversion + '% от прошлого'}</div>
            </CardContent>
          </Card>
        ))}
      </div>
      {est ? (
        <Card>
          <CardHeader>
            <CardTitle>Оценка по биллингу</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {est.note}. Установки {est.install}, входы {est.login}, пробные {est.trial}, оплаты {est.payment}, продления {est.renewal}.
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

export function RevenueDesk({ data }: { data?: DeskData }) {
  const rev = data?.revenue;
  if (!rev) return null;
  return (
    <div className="space-y-3">
      <div className="grid gap-2 md:grid-cols-3">
        <Card>
          <CardContent className="pt-4">
            <div className="text-xs text-muted-foreground">30 дней</div>
            <div className="text-2xl font-semibold">{rev.monthSum} ₽</div>
            <div className="text-xs text-muted-foreground">{rev.monthN} оплат</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-xs text-muted-foreground">Отток 30 дней</div>
            <div className="text-2xl font-semibold">{rev.churn.rate}%</div>
            <div className="text-xs text-muted-foreground">
              истекло {rev.churn.expired}, ещё живы {rev.churn.active}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-xs text-muted-foreground">Продления на неделе</div>
            <div className="text-2xl font-semibold">{rev.forecast.due}</div>
            <div className="text-xs text-muted-foreground">
              около {rev.forecast.sum} ₽ при цене {rev.forecast.price} ₽
            </div>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>По дням</CardTitle>
        </CardHeader>
        <CardContent className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rev.byDay}>
              <CartesianGrid stroke="#31342C" />
              <XAxis dataKey="t" stroke="#B3B8A8" tick={{ fontSize: 11 }} />
              <YAxis stroke="#B3B8A8" tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={{ background: '#181A15', border: '1px solid #31342C' }} />
              <Line type="monotone" dataKey="v" stroke="#F9C400" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>По месяцам</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          {rev.byMonth.map((m) => (
            <div key={m.month} className="flex justify-between font-mono">
              <span>{m.month}</span>
              <span>
                {Math.round(m.sum)} ₽ · {m.n}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

type NucBox = {
  configured?: boolean;
  error?: string;
  host?: { cpus: number; mem: number } | null;
  containers?: { id: string; name: string; state: string; status: string; cpu: number | null; mem: number | null; restart: boolean }[];
  disk?: { path: string; ratio: number; free: number; total: number } | null;
  restart?: boolean;
};

function SourceCheck({ csrf, label }: { csrf: string; label: string }) {
  const [text, setText] = useState<string | null>(null);
  return (
    <>
      <Button
        variant="secondary"
        onClick={() =>
          void post('/admin/api/sources/check', csrf, {}).then((r) => {
            const health = (r as { health?: HealthRow[] }).health;
            if (!r.ok || !health) {
              toast(r.ok ? 'Проверено' : r.flash?.error || 'Не вышло');
              return;
            }
            setText(healthReport(health));
          })
        }
      >
        {label}
      </Button>
      {text != null ? <LogDialog title="Проверка источников" text={text} onClose={() => setText(null)} /> : null}
    </>
  );
}

type OpenLog = { name: string; text: string; refreshing: boolean };

export function NucDesk({ csrf }: { csrf: string }) {
  const { paused } = useLive();
  const [log, setLog] = useState<OpenLog | null>(null);
  const query = useQuery({
    queryKey: ['nuc'],
    refetchInterval: paused ? false : 15000,
    queryFn: () => api<NucBox>('/admin/api/nuc'),
  });
  const box = query.data;
  return (
    <div className="space-y-3">
      <Card>
        <CardHeader>
          <CardTitle>Хост</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {box?.disk ? (
            <p>
              Диск {box.disk.path}: свободно {box.disk.ratio}% ({Math.round(box.disk.free / 1024 / 1024 / 1024)} ГБ)
            </p>
          ) : (
            <p className="text-muted-foreground">Диск с этого контейнера не виден</p>
          )}
          {box?.host ? (
            <p>
              CPU {box.host.cpus} · RAM {Math.round(box.host.mem / 1024 / 1024 / 1024)} ГБ
            </p>
          ) : (
            <p className="text-muted-foreground">{box?.error || 'Сводка хоста недоступна'}</p>
          )}
        </CardContent>
      </Card>
      {(box?.containers || []).map((c) => (
        <Card key={c.id}>
          <CardContent className="flex flex-wrap items-center justify-between gap-2 pt-4">
            <div>
              <div className="font-medium">{c.name}</div>
              <div className="font-mono text-xs text-muted-foreground">
                {c.state} · {c.status} · CPU {c.cpu == null ? '-' : c.cpu + '%'} · RAM {c.mem == null ? '-' : Math.round(c.mem / 1024 / 1024) + ' МБ'}
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => void openLog(c.name)}>
                Лог
              </Button>
              {c.restart ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    if (!window.confirm('Перезапустить ' + c.name + '?')) return;
                    void post('/admin/api/nuc/restart', csrf, { name: c.name, confirm: 'yes' }).then((r) => toast(r.ok ? 'Перезапущен' : 'Не вышло'));
                  }}
                >
                  Перезапуск
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ))}
      {log ? (
        <LogDialog
          title={'Лог ' + log.name}
          text={log.text}
          refreshing={log.refreshing}
          onRefresh={() => void openLog(log.name)}
          onClose={() => setLog(null)}
        />
      ) : null}
    </div>
  );

  async function openLog(name: string) {
    setLog((cur) => ({ name, text: cur && cur.name === name ? cur.text : '', refreshing: true }));
    try {
      const res = await fetch('/admin/api/nuc/logs?name=' + encodeURIComponent(name), { credentials: 'same-origin' });
      const j = (await res.json()) as { lines?: string; error?: string };
      setLog({ name, text: j.lines || j.error || '', refreshing: false });
    } catch {
      setLog({ name, text: 'логи недоступны', refreshing: false });
    }
  }
}

export function RollbackCard({ rows, csrf }: { rows: { id: string; at: number }[]; csrf: string }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">Снимков настроек ещё нет. Они появятся после сохранения настроек.</p>;
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.id} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
          <span className="font-mono text-xs">
            {r.id.slice(0, 8)} · <Stamp ms={r.at} />
          </span>
          <Button
            variant="secondary"
            onClick={() => {
              if (!window.confirm('Откатить настройки к этому снимку? Секреты не меняются.')) return;
              void post('/admin/api/rollback', csrf, { id: r.id, confirm: 'yes' }).then((res) => toast(res.ok ? 'Откат выполнен' : 'Не вышло'));
            }}
          >
            Откатить
          </Button>
        </div>
      ))}
    </div>
  );
}
