import { useEffect, useRef, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton, toast } from '@/components/chrome';
import { api, post } from '@/lib/api';
import { when } from '@/lib/text';

export type MonitorCheck = {
  id: string;
  group: string;
  name: string;
  path: string;
  target?: string;
  ok: boolean | null;
  detail: string;
  context?: string;
  ms: number;
  alert: boolean;
  alerted?: boolean;
  retried?: boolean;
  history: string;
  uptime: number | null;
};

export type MonitorData = {
  ok?: boolean;
  error?: string;
  auth?: boolean;
  intervalMin: number;
  scheduled: boolean;
  running: boolean;
  runningSince?: number;
  groups: { id: string; title: string }[];
  lastRun: { at: number; finishedAt: number; trigger: string; total: number; failed: number } | null;
  nextRunAt: number;
  checks: MonitorCheck[];
};

const PATH_TEXT: Record<string, string> = {
  direct: 'напрямую',
  warp: 'через WARP',
  jackett: 'через Jackett',
  internal: 'внутр. сеть',
};

export function StatusBadge({ ok, alerted }: { ok: boolean | null | undefined; alerted?: boolean }) {
  if (ok === true) return <Badge variant="ok">ок</Badge>;
  if (ok === false) return <Badge variant="bad">{alerted ? 'ошибка · в Telegram' : 'ошибка'}</Badge>;
  return <Badge variant="secondary">-</Badge>;
}

/** 168 hourly cells, oldest left: green all ok, red a failure in that hour, grey no data. */
export function HistoryStrip({ strip, uptime }: { strip: string; uptime: number | null }) {
  return (
    <div className="flex items-center gap-2" title="7 дней, по часам: зелёный - всё ок, красный - была ошибка, серый - нет данных">
      <div className="flex h-3.5 items-stretch overflow-hidden rounded-sm" data-testid="history-strip">
        {strip.split('').map((c, i) => (
          <span key={i} className={'w-[2px] ' + (c === 'g' ? 'bg-emerald-600' : c === 'r' ? 'bg-red-600' : 'bg-zinc-800')} />
        ))}
      </div>
      <span className="w-12 text-right text-xs text-muted-foreground">{uptime == null ? '-' : uptime + '%'}</span>
    </div>
  );
}

function PathBadge({ path }: { path: string }) {
  if (!path || !PATH_TEXT[path]) return null;
  return (
    <Badge variant="secondary" className="ml-2 align-middle">
      {PATH_TEXT[path]}
    </Badge>
  );
}

function Detail({ row }: { row?: MonitorCheck }) {
  if (!row) return <span className="text-muted-foreground">-</span>;
  return (
    <span className="text-xs">
      {row.detail || '-'}
      {row.ms ? <span className="text-muted-foreground"> · {row.ms} мс</span> : null}
      {row.retried && row.ok === false ? <span className="text-muted-foreground"> · повтор через 30 с</span> : null}
      {!row.alert && row.ok === false ? <span className="text-muted-foreground"> · без алерта</span> : null}
    </span>
  );
}

function PlainTable({ rows }: { rows: MonitorCheck[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-28">Статус</TableHead>
          <TableHead>Проверка</TableHead>
          <TableHead>Результат</TableHead>
          <TableHead className="w-[240px]">7 дней</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id} data-check={r.id}>
            <TableCell>
              <StatusBadge ok={r.ok} alerted={r.alerted} />
            </TableCell>
            <TableCell className="font-medium">
              {r.name}
              <PathBadge path={r.path} />
            </TableCell>
            <TableCell>
              <Detail row={r} />
              {r.context ? <div className="text-xs text-muted-foreground">{r.context}</div> : null}
            </TableCell>
            <TableCell>
              <HistoryStrip strip={r.history} uptime={r.uptime} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

type TrackerRow = { key: string; name: string; search?: MonitorCheck; direct?: MonitorCheck; warp?: MonitorCheck; site?: MonitorCheck };

/** Trackers: one line each, with the Jackett search (Jackett trackers), the site directly and through WARP. */
export function trackerRows(rows: MonitorCheck[]): { trackers: TrackerRow[]; other: MonitorCheck[] } {
  const map = new Map<string, TrackerRow>();
  const other: MonitorCheck[] = [];
  for (const r of rows) {
    const m = /^(.*):(direct|warp|site)$/.exec(r.id);
    const key = m ? m[1] : r.path === 'jackett' ? r.id : '';
    if (!key) {
      other.push(r);
      continue;
    }
    const row = map.get(key) || { key, name: r.name };
    if (r.path === 'jackett') row.search = r;
    else if (m && m[2] === 'direct') row.direct = r;
    else if (m && m[2] === 'warp') row.warp = r;
    else row.site = r;
    map.set(key, row);
  }
  return { trackers: Array.from(map.values()), other };
}

function Cell({ row }: { row?: MonitorCheck }) {
  if (!row) return <span className="text-xs text-muted-foreground">-</span>;
  return (
    <div className="space-y-1">
      <StatusBadge ok={row.ok} alerted={row.alerted} />
      <div className="max-w-[260px] text-xs text-muted-foreground">
        {row.detail}
        {row.ms ? ' · ' + row.ms + ' мс' : ''}
      </div>
    </div>
  );
}

function TrackerTable({ rows, withSearch }: { rows: TrackerRow[]; withSearch: boolean }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Трекер</TableHead>
          {withSearch ? <TableHead>Поиск через Jackett</TableHead> : null}
          <TableHead>Сайт напрямую</TableHead>
          <TableHead>Сайт через WARP</TableHead>
          <TableHead className="w-[240px]">7 дней</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((t) => {
          const main = t.search || t.warp || t.direct || t.site;
          return (
            <TableRow key={t.key} data-check={t.key}>
              <TableCell className="font-medium">
                {t.name}
                {t.direct?.target || t.warp?.target ? <div className="text-xs text-muted-foreground">{t.direct?.target || t.warp?.target}</div> : null}
              </TableCell>
              {withSearch ? (
                <TableCell>
                  <Cell row={t.search} />
                </TableCell>
              ) : null}
              <TableCell>{t.site ? <span className="text-xs text-muted-foreground">{t.site.detail}</span> : <Cell row={t.direct} />}</TableCell>
              <TableCell>{t.site ? null : <Cell row={t.warp} />}</TableCell>
              <TableCell>{main ? <HistoryStrip strip={main.history} uptime={main.uptime} /> : null}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function GroupCard({ title, id, rows }: { title: string; id: string; rows: MonitorCheck[] }) {
  const failed = rows.filter((r) => r.ok === false).length;
  const tracker = id === 'jackett' || id === 'jacred';
  const split = tracker ? trackerRows(rows) : null;
  return (
    <Card data-group={id}>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle>{title}</CardTitle>
        {failed ? <Badge variant="bad">ошибок: {failed}</Badge> : <Badge variant="ok">всё ок</Badge>}
      </CardHeader>
      <CardContent className="space-y-3">
        {split && split.other.length ? <PlainTable rows={split.other} /> : null}
        {split ? (
          split.trackers.length ? (
            <TrackerTable rows={split.trackers} withSearch={id === 'jackett'} />
          ) : null
        ) : (
          <PlainTable rows={rows} />
        )}
        {tracker ? (
          <p className="text-xs text-muted-foreground">
            {id === 'jackett'
              ? 'Поиск через Jackett - тот путь, которым идут пользователи (Jackett сам ходит через WARP и FlareSolverr). Сайт напрямую и через WARP показывает, какой путь закрыт. Алерт: поиск не работает, или сайт не открывается ни напрямую, ни через WARP.'
              : 'JacRed берёт базу с sync.jacred.stream, сам на трекеры не ходит. Строки трекеров показывают, открывается ли сайт напрямую и через WARP; алерт - только если ни так, ни так.'}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function MonitorView({
  data,
  busy,
  interval,
  setInterval,
  onRun,
  onSave,
}: {
  data: MonitorData | null;
  busy: boolean;
  interval: string;
  setInterval: (v: string) => void;
  onRun: () => void;
  onSave: () => void;
}) {
  const running = !!data?.running;
  const checks = data?.checks || [];
  const failed = checks.filter((c) => c.ok === false).length;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle>Мониторинг</CardTitle>
            <CardDescription>
              {data?.lastRun ? 'Последняя проверка: ' + when(data.lastRun.finishedAt) + (data.lastRun.trigger === 'manual' ? ' (вручную)' : '') + '.' : 'Проверок ещё не было.'}
              {data?.scheduled && data?.nextRunAt ? ' Следующая около ' + when(data.nextRunAt) + '.' : ''}
              {data && !data.scheduled ? ' Расписание на этом экземпляре выключено, работает только ручная проверка.' : ''}
            </CardDescription>
            <CardDescription>Перед алертом упавшая проверка повторяется через 30 с. Алерт приходит в Telegram один раз на проблему и ещё раз, когда починилось.</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {checks.length ? failed ? <Badge variant="bad">ошибок: {failed}</Badge> : <Badge variant="ok">всё ок</Badge> : null}
            <Button type="button" disabled={busy || running} onClick={onRun}>
              {running ? 'Проверка идёт…' : 'Проверить сейчас'}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              onSave();
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="monitorInterval">Интервал, минут (5-1440)</Label>
              <Input id="monitorInterval" className="w-32" inputMode="numeric" value={interval} onChange={(e) => setInterval(e.target.value)} />
            </div>
            <Button type="submit" variant="secondary" disabled={busy}>
              Сохранить
            </Button>
          </form>
        </CardContent>
      </Card>
      {data?.error ? <Alert variant="destructive">{data.error === 'read_only' ? 'Сервер в режиме только чтения: мониторинг не работает.' : 'Мониторинг недоступен на этом экземпляре.'}</Alert> : null}
      {!data && busy ? <Skeleton className="h-40" /> : null}
      {(data?.groups || []).map((g) => {
        const rows = checks.filter((c) => c.group === g.id);
        if (!rows.length) return null;
        return <GroupCard key={g.id} id={g.id} title={g.title} rows={rows} />;
      })}
    </div>
  );
}

export function MonitorPanel({ csrf }: { csrf: string }) {
  const [data, setData] = useState<MonitorData | null>(null);
  const [busy, setBusy] = useState(false);
  const [interval, setIntervalValue] = useState('');
  const [err, setErr] = useState('');
  const wasRunning = useRef(false);

  async function load() {
    let res: MonitorData & { auth?: boolean; error?: string };
    try {
      res = await api<MonitorData & { error?: string }>('/admin/api/monitor');
    } catch {
      setErr('Нет связи с сервером');
      return null;
    }
    if (res.auth === false) {
      setErr('Нужен вход');
      return null;
    }
    if (!res.ok) {
      setErr(res.error === 'read_only' ? 'Этот экземпляр только для чтения, мониторинг здесь не работает' : 'Мониторинг недоступен');
      return null;
    }
    setErr('');
    setData(res);
    setIntervalValue((cur) => cur || String(res.intervalMin || ''));
    if (wasRunning.current && !res.running) toast('Проверка завершена');
    wasRunning.current = !!res.running;
    return res;
  }

  useEffect(() => {
    setBusy(true);
    void load().finally(() => setBusy(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Every 3 s while a check runs, every minute otherwise, so a scheduled run shows up in an open tab.
    const timer = window.setInterval(() => void load(), data?.running ? 3000 : 60000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.running]);

  async function runNow() {
    setBusy(true);
    try {
      const res = (await post('/admin/monitor/run', csrf, {})) as { ok?: boolean; error?: string; auth?: boolean };
      if (res.auth === false) return setErr('Нужен вход');
      if (!res.ok) {
        toast(res.error || 'Не запущено, обновите страницу');
        return;
      }
      toast('Проверка запущена, займёт до нескольких минут');
      wasRunning.current = true;
      await load();
    } catch {
      toast('Нет связи с сервером');
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    try {
      const res = (await post('/admin/monitor/config', csrf, { intervalMin: interval })) as { ok?: boolean; error?: string; intervalMin?: number; auth?: boolean };
      if (res.auth === false) return setErr('Нужен вход');
      if (!res.ok) toast(res.error || 'Не сохранено');
      else {
        toast('Интервал: ' + res.intervalMin + ' мин');
        setIntervalValue(String(res.intervalMin));
        await load();
      }
    } catch {
      toast('Нет связи с сервером');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {err ? <Alert variant="destructive">{err}</Alert> : null}
      <MonitorView data={data} busy={busy} interval={interval} setInterval={setIntervalValue} onRun={() => void runNow()} onSave={() => void save()} />
    </>
  );
}
