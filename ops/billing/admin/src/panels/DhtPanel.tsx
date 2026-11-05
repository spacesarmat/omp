import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/lib/api';
import { when } from '@/lib/text';

type DhtError = { at: number; status: number; reason: string };

type DhtPayload = {
  auth?: boolean;
  ok?: boolean;
  configured?: boolean;
  sidecar?: { configured?: boolean; ok?: boolean; dht?: string; rss?: number | null; latencyMs?: number };
  stats?: { requests24h?: number; withPeers24h?: number; peersSharePct?: number; avgMs?: number; errors?: DhtError[] };
};

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

export function DhtPanel() {
  const [data, setData] = useState<DhtPayload | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let stop = false;
    api<DhtPayload>('/admin/api/dht')
      .then((res) => {
        if (stop) return;
        if (res.auth === false) {
          setErr('Нужен вход');
          return;
        }
        setData(res);
      })
      .catch((e) => {
        if (!stop) setErr(e instanceof Error ? e.message : 'Не удалось загрузить DHT');
      });
    return () => {
      stop = true;
    };
  }, []);

  const stats = (data && data.stats) || {};
  const requests = stats.requests24h || 0;
  const withPeers = stats.withPeers24h || 0;
  const errors = stats.errors || [];
  const mem = data && data.sidecar ? memText(data.sidecar.rss) : '';
  const socket = data && data.sidecar && data.sidecar.ok ? socketText(data.sidecar.dht) : '';

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>DHT</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {err ? <p className="text-destructive">{err}</p> : null}
          {!data && !err ? <p className="text-muted-foreground">Загрузка…</p> : null}
          {data ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span>omp-dht-peers</span>
                {sidecarBadge(data)}
                {socket ? <span className="text-muted-foreground">{socket}</span> : null}
                {mem ? <span className="text-muted-foreground">память {mem}</span> : null}
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <div className="text-muted-foreground">Запросов за 24 ч</div>
                  <div className="text-lg font-semibold">{requests}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">С пирами</div>
                  <div className="text-lg font-semibold">
                    {requests ? stats.peersSharePct + '% (' + withPeers + ' из ' + requests + ')' : 'нет запросов'}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Среднее время</div>
                  <div className="text-lg font-semibold">{requests ? (stats.avgMs || 0) + ' мс' : '-'}</div>
                </div>
              </div>
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
