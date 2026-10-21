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
import {
  buildView,
  FILTER_TEXT,
  loadPrefs,
  savePrefs,
  SORT_TEXT,
  type GroupView,
  type MonitorCheck,
  type MonitorFilter,
  type MonitorItem,
  type MonitorPrefs,
  type MonitorSort,
} from '@/lib/monitorView';

export type { MonitorCheck } from '@/lib/monitorView';

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

/** HH:MM:SS in Moscow time, when the check ran. */
function clock(at: number) {
  return new Date(at).toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour12: false });
}

function Detail({ row }: { row?: MonitorCheck }) {
  if (!row) return <span className="text-muted-foreground">-</span>;
  return (
    <span className="text-xs">
      {row.detail || '-'}
      {row.ms ? <span className="text-muted-foreground"> · {row.ms} мс</span> : null}
      {row.at ? <span className="text-muted-foreground"> · {clock(row.at)}</span> : null}
      {row.retried && row.ok === false ? <span className="text-muted-foreground"> · повтор через 30 с</span> : null}
      {!row.alert && row.ok === false ? <span className="text-muted-foreground"> · без алерта</span> : null}
    </span>
  );
}

/** localStorage, or null where the browser refuses access (blocked storage throws on the property itself). */
function browserStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
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
              {r.group === 'containers' ? null : <PathBadge path={r.path} />}
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

function Cell({ row }: { row?: MonitorCheck }) {
  if (!row) return <span className="text-xs text-muted-foreground">-</span>;
  return (
    <div className="space-y-1">
      <StatusBadge ok={row.ok} alerted={row.alerted} />
      <div className="max-w-[260px] text-xs text-muted-foreground">
        {row.detail}
        {row.ms ? ' · ' + row.ms + ' мс' : ''}
        {row.at ? ' · ' + clock(row.at) : ''}
      </div>
    </div>
  );
}

function TrackerTable({ rows, withSearch }: { rows: MonitorItem[]; withSearch: boolean }) {
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
          if (t.kind === 'check' && t.check) {
            const r = t.check;
            return (
              <TableRow key={t.key} data-check={r.id}>
                <TableCell className="font-medium">
                  {r.name}
                  <PathBadge path={r.path} />
                </TableCell>
                <TableCell colSpan={withSearch ? 3 : 2}>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge ok={r.ok} alerted={r.alerted} />
                    <Detail row={r} />
                  </div>
                  {r.context ? <div className="text-xs text-muted-foreground">{r.context}</div> : null}
                </TableCell>
                <TableCell>
                  <HistoryStrip strip={r.history} uptime={r.uptime} />
                </TableCell>
              </TableRow>
            );
          }
          const main = t.search || t.warp || t.direct || t.site;
          return (
            <TableRow key={t.key} data-check={t.key}>
              <TableCell className="font-medium">
                {t.name}
                {t.target ? <div className="text-xs text-muted-foreground">{t.target}</div> : null}
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

function GroupCard({ view, onToggle }: { view: GroupView; onToggle: (id: string, open: boolean) => void }) {
  const { id, title, items, failed } = view;
  const tracker = id === 'jackett' || id === 'jacred';
  const summary = title + ' ' + view.okCount + '/' + view.total + (view.skipped ? ', не проверено: ' + view.skipped : '');
  const badge = failed ? (
    <Badge variant="bad">ошибок: {failed}</Badge>
  ) : view.skipped ? (
    <Badge variant="warn">не проверено: {view.skipped}</Badge>
  ) : (
    <Badge variant="ok">всё ок</Badge>
  );
  if (view.folded) {
    return (
      <Card data-group={id} data-folded="1">
        <button type="button" className="flex w-full items-center justify-between gap-2 px-6 py-4 text-left" onClick={() => onToggle(id, true)} aria-expanded={false}>
          <span className="font-semibold">
            <span className="mr-2 text-muted-foreground">▸</span>
            {summary}
          </span>
          {badge}
        </button>
      </Card>
    );
  }
  // Trackers and plain checks of one group share a table, so the chosen sort order holds across both.
  const hasTrackers = items.some((it) => it.kind === 'tracker');
  const plain = items.map((it) => it.check as MonitorCheck);
  return (
    <Card data-group={id}>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <button type="button" className="text-left" onClick={() => onToggle(id, false)} aria-expanded>
          <CardTitle>
            <span className="mr-2 text-muted-foreground">▾</span>
            {summary}
          </CardTitle>
        </button>
        {badge}
      </CardHeader>
      <CardContent className="space-y-3">
        {hasTrackers ? <TrackerTable rows={items} withSearch={id === 'jackett'} /> : items.length ? <PlainTable rows={plain} /> : null}
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

const selectClass = 'h-10 rounded-md border border-input bg-secondary px-3 text-sm text-foreground';

function Toolbar({ prefs, setPrefs, shown }: { prefs: MonitorPrefs; setPrefs: (p: MonitorPrefs) => void; shown: number }) {
  return (
    <Card>
      <CardContent className="flex flex-wrap items-end gap-3 pt-6">
        <div className="space-y-1">
          <Label>Показать</Label>
          <div className="flex gap-1" role="group" aria-label="Фильтр">
            {(Object.keys(FILTER_TEXT) as MonitorFilter[]).map((f) => (
              <Button
                key={f}
                type="button"
                size="sm"
                className="h-10"
                variant={prefs.filter === f ? 'default' : 'outline'}
                aria-pressed={prefs.filter === f}
                title={f === 'noalert' ? 'Красные строки, по которым алерт не уходит (например, сайт закрыт только напрямую)' : undefined}
                onClick={() => setPrefs({ ...prefs, filter: f })}
              >
                {FILTER_TEXT[f]}
              </Button>
            ))}
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="monitorSearch">Поиск</Label>
          <Input id="monitorSearch" className="w-56" placeholder="название, адрес, ошибка" value={prefs.q} onChange={(e) => setPrefs({ ...prefs, q: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="monitorSort">Сортировка</Label>
          <div className="flex gap-1">
            <select id="monitorSort" className={selectClass} value={prefs.sort} onChange={(e) => setPrefs({ ...prefs, sort: e.target.value as MonitorSort })}>
              {(Object.keys(SORT_TEXT) as MonitorSort[]).map((k) => (
                <option key={k} value={k}>
                  {SORT_TEXT[k]}
                </option>
              ))}
            </select>
            <Button type="button" variant="outline" className="w-10 px-0" title={prefs.desc ? 'По убыванию' : 'По возрастанию'} aria-label={prefs.desc ? 'По убыванию' : 'По возрастанию'} onClick={() => setPrefs({ ...prefs, desc: !prefs.desc })}>
              {prefs.desc ? '↓' : '↑'}
            </Button>
          </div>
        </div>
        <div className="text-xs text-muted-foreground">Строк: {shown}</div>
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
  onRecheck,
  onSave,
  prefs,
  setPrefs,
}: {
  data: MonitorData | null;
  busy: boolean;
  interval: string;
  setInterval: (v: string) => void;
  onRun: () => void;
  onRecheck: () => void;
  onSave: () => void;
  prefs: MonitorPrefs;
  setPrefs: (p: MonitorPrefs) => void;
}) {
  const running = !!data?.running;
  const checks = data?.checks || [];
  const failed = checks.filter((c) => c.ok === false).length;
  const view = buildView(data?.groups || [], checks, prefs);
  const shown = view.reduce((n, g) => n + (g.folded ? 0 : g.items.length), 0);
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle>Мониторинг</CardTitle>
            <CardDescription>
              {data?.lastRun ? 'Последняя проверка: ' + when(data.lastRun.finishedAt) + (data.lastRun.trigger === 'manual' ? ' (вручную)' : data.lastRun.trigger === 'recheck' ? ' (перепроверка ошибок)' : '') + '.' : 'Проверок ещё не было.'}
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
            {failed ? (
              <Button type="button" variant="secondary" disabled={busy || running} onClick={onRecheck} title="Запустить заново только красные проверки, остальные сохраняют последний результат">
                Перепроверить все ошибки
              </Button>
            ) : null}
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
      {checks.length ? <Toolbar prefs={prefs} setPrefs={setPrefs} shown={shown} /> : null}
      {checks.length && !view.length ? <p className="text-sm text-muted-foreground">Ничего не найдено.</p> : null}
      {view.map((g) => (
        <GroupCard key={g.id} view={g} onToggle={(id, open) => setPrefs({ ...prefs, open: { ...prefs.open, [id]: open } })} />
      ))}
    </div>
  );
}

export function MonitorPanel({ csrf }: { csrf: string }) {
  const [data, setData] = useState<MonitorData | null>(null);
  const [busy, setBusy] = useState(false);
  const [interval, setIntervalValue] = useState('');
  const [err, setErr] = useState('');
  const wasRunning = useRef(false);
  const [prefs, setPrefsState] = useState<MonitorPrefs>(() => loadPrefs(browserStorage()));
  const setPrefs = (p: MonitorPrefs) => {
    setPrefsState(p);
    savePrefs(browserStorage(), p);
  };

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

  async function runNow(onlyFailed = false) {
    setBusy(true);
    try {
      const res = (await post('/admin/monitor/run', csrf, onlyFailed ? { only: 'failed' } : {})) as { ok?: boolean; error?: string; auth?: boolean };
      if (res.auth === false) return setErr('Нужен вход');
      if (!res.ok) {
        toast(res.error || 'Не запущено, обновите страницу');
        return;
      }
      toast(onlyFailed ? 'Перепроверяю красные проверки' : 'Проверка запущена, займёт до нескольких минут');
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
      <MonitorView data={data} busy={busy} interval={interval} setInterval={setIntervalValue} onRun={() => void runNow()}
        onRecheck={() => void runNow(true)}
        onSave={() => void save()}
        prefs={prefs}
        setPrefs={setPrefs}
      />
    </>
  );
}
