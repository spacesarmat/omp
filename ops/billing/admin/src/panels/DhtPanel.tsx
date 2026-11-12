import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/lib/api';
import { createLoadGate } from '@/lib/dhtLoad';
import { LogDialog } from '@/components/logDialog';
import { probeText, type DhtProbeResult } from '@/lib/dhtProbe';
import { when } from '@/lib/text';

type DhtError = { at: number; status: number; reason: string };
type DhtPoint = { t: number; requests: number; errors: number };

type DhtStats = {
  requests24h?: number;
  withPeers24h?: number;
  peersSharePct?: number;
  avgMs?: number;
  errors24h?: number;
  errors4xx24h?: number;
  errors5xx24h?: number;
  p50Ms?: number;
  p95Ms?: number;
  series?: DhtPoint[];
  errors?: DhtError[];
};

type DhtPayload = {
  auth?: boolean;
  ok?: boolean;
  configured?: boolean;
  sidecar?: { configured?: boolean; ok?: boolean; dht?: string; rss?: number | null; latencyMs?: number };
  limit?: { perMinute?: number; windowSec?: number };
  stats?: DhtStats;
};

type ProbeResult = DhtProbeResult;

const REFRESH_MS = 20000;

function memText(rss?: number | null) {
  if (rss == null || rss < 0) return '';
  if (rss >= 1024 * 1024) return (Math.round((rss / (1024 * 1024)) * 10) / 10) + ' МБ';
  return Math.max(1, Math.round(rss / 1024)) + ' КБ';
}

function sidecarBadge(row: DhtPayload) {
  const side = row.sidecar;
  if (!row.configured && !(side && side.configured)) return <Badge variant="secondary">не настроен</Badge>;
  if (side && side.ok) return <Badge variant="ok">доступен · {side.latencyMs || 0} мс</Badge>;
  return <Badge variant="bad">не отвечает</Badge>;
}

function socketText(dht?: string) {
  if (dht === 'up') return 'сокет открыт';
  if (dht === 'idle') return 'сокет закрыт';
  return '';
}

function limitText(limit?: { perMinute?: number }) {
  const n = limit && typeof limit.perMinute === 'number' ? limit.perMinute : 30;
  if (n <= 0) return 'лимит выключен (0 в настройках)';
  return n + ' запросов в минуту на устройство';
}

/** Same bar row as the finance DayChart: one bar per 10-minute slot, gold or red. */
function Bars({ rows, field, label, color }: { rows: DhtPoint[]; field: 'requests' | 'errors'; label: string; color: string }) {
  const max = Math.max(1, ...rows.map((r) => r[field]));
  const first = rows[0] ? when(rows[0].t) : '';
  const last = rows.length ? when(rows[rows.length - 1].t) : '';
  return (
    <div>
      <div className="mb-2 text-sm text-muted-foreground">{label}</div>
      <div className="flex h-36 items-end gap-px overflow-x-auto">
        {rows.map((r) => (
          <div key={field + ':' + r.t} title={when(r.t) + ': ' + r[field]} className="flex h-full min-w-[4px] flex-1 flex-col justify-end">
            <div className="w-full rounded-sm" style={{ height: Math.max(2, Math.round((r[field] / max) * 128)) + 'px', background: color }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-xs text-muted-foreground">
        <span>{first}</span>
        <span>{last}</span>
      </div>
    </div>
  );
}

export function DhtPanel({ csrf }: { csrf: string }) {
  const [data, setData] = useState<DhtPayload | null>(null);
  const [err, setErr] = useState('');
  const [probeView, setProbeView] = useState<string | null>(null);
  const [probing, setProbing] = useState(false);
  const loads = useRef(createLoadGate());

  const load = useCallback(() => {
    const id = loads.current.next();
    return api<DhtPayload>('/admin/api/dht')
      .then((res) => {
        if (!loads.current.isCurrent(id)) return;
        if (res.auth === false) {
          setErr('Нужен вход');
          return;
        }
        setErr('');
        setData(res);
      })
      .catch((e) => {
        if (!loads.current.isCurrent(id)) return;
        setErr(e instanceof Error ? e.message : 'Не удалось загрузить DHT');
      });
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => {
      loads.current.next();
      window.clearInterval(timer);
    };
  }, [load]);

  async function onProbe() {
    setProbing(true);
    try {
      const res = await api<ProbeResult>('/admin/api/dht/probe', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ csrf }),
      });
      setProbeView(probeText(res) + '\n\n' + JSON.stringify(res, null, 2));
      await load();
    } catch (e) {
      const fail: ProbeResult = { ok: false, error: e instanceof Error ? e.message : 'проверка' };
      setProbeView(probeText(fail) + '\n\n' + JSON.stringify(fail, null, 2));
    } finally {
      setProbing(false);
    }
  }

  const stats = (data && data.stats) || {};
  const requests = stats.requests24h || 0;
  const withPeers = stats.withPeers24h || 0;
  const errors = stats.errors || [];
  const series = stats.series || [];
  const mem = data && data.sidecar ? memText(data.sidecar.rss) : '';
  const socket = data && data.sidecar && data.sidecar.ok ? socketText(data.sidecar.dht) : '';

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>DHT</CardTitle>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="secondary" onClick={() => void load()}>
                Обновить
              </Button>
              <Button type="button" size="sm" disabled={!csrf || probing} onClick={() => void onProbe()}>
                {probing ? 'Проверка...' : 'Проверить DHT'}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {err ? <p className="text-destructive">{err}</p> : null}
          {!data && !err ? <p className="text-muted-foreground">Загрузка...</p> : null}
          {data ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span>omp-dht-peers</span>
                {sidecarBadge(data)}
                {socket ? <span className="text-muted-foreground">{socket}</span> : null}
                {mem ? <span className="text-muted-foreground">память {mem}</span> : null}
              </div>
              <p className="text-muted-foreground">Лимит: {limitText(data.limit)}. Меняется в «Настройках». Обновление само, раз в 20 с.</p>
              {probeView != null ? <LogDialog title="Проверка DHT" text={probeView} onClose={() => setProbeView(null)} /> : null}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <div className="text-muted-foreground">Запросов за 24 ч</div>
                  <div className="text-lg font-semibold">{requests}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">С пирами</div>
                  <div className="text-lg font-semibold">
                    {requests ? stats.peersSharePct + '% (' + withPeers + ' из ' + requests + ')' : 'нет запросов'}
                  </div>
                  <div className="text-muted-foreground">
                    Ошибок за 24 ч: {stats.errors24h || 0} (4xx {stats.errors4xx24h || 0}, 5xx {stats.errors5xx24h || 0})
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Среднее время</div>
                  <div className="text-lg font-semibold">{requests ? (stats.avgMs || 0) + ' мс' : '-'}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">p50 / p95 за 24 ч</div>
                  <div className="text-lg font-semibold">{requests ? (stats.p50Ms || 0) + ' / ' + (stats.p95Ms || 0) + ' мс' : '-'}</div>
                </div>
              </div>
              <Bars rows={series} field="requests" label="Запросы за 24 ч, слот 10 мин" color="#f5b700" />
              <Bars rows={series} field="errors" label="Ошибки за 24 ч, слот 10 мин" color="#e11d48" />
              <p className="text-muted-foreground">
                429 и причина «лимит» - это лимит биллинга на запросы с устройства, а не сбой сети DHT. Панель не показывает названия торрентов и infohash.
                Счетчики за 24 часа лежат в Postgres и остаются после перезапуска. Токен, id устройства и infohash по-прежнему не пишутся.
                «Проверить DHT» зовет sidecar с постоянным тестовым хешем из нулей (это не торрент пользователя) и тоже попадает в счетчики. В таблице ошибок у такой проверки причина «проверка», без самого хеша.
              </p>
            </>
          ) : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Последние ошибки</CardTitle>
        </CardHeader>
        {errors.length === 0 ? (
          <CardContent className="text-sm text-muted-foreground">Ошибок нет</CardContent>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Время</TableHead>
                <TableHead>Код</TableHead>
                <TableHead>Причина</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {errors.map((e, i) => (
                <TableRow key={e.at + ':' + i}>
                  <TableCell>{when(e.at)}</TableCell>
                  <TableCell>{e.status}</TableCell>
                  <TableCell>{e.reason}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
