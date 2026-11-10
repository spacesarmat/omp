import { useEffect, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/lib/api';
import { when } from '@/lib/text';

type CacheNode = {
  id: string;
  name: string;
  url: string;
  region: string;
  capacityBytes: number;
  prefixMb: number;
  prefixPercent: number;
  status: 'online' | 'offline' | 'disabled';
  disabled: boolean;
  hasToken: boolean;
  lastHeartbeat: number | null;
  diskUsedBytes: number;
  diskTotalBytes: number;
  torrserverOk: boolean;
};

type CacheAssignment = {
  id: string;
  nodeId: string;
  nodeName: string;
  infohash: string;
  title: string;
  status: string;
  pinned: boolean;
  source: string;
  prefixBytes: number;
  error: string;
  updatedAt: number;
};

type CachePayload = {
  auth?: boolean;
  enabled?: boolean;
  prefixMb?: number;
  prefixPercent?: number;
  nodes?: CacheNode[];
  assignments?: CacheAssignment[];
  csrf?: string;
};

type CachePost = {
  auth?: boolean;
  ok?: boolean;
  error?: string;
  token?: string;
  enabled?: boolean;
  created?: number;
  dropped?: number;
  skipped?: boolean;
  reason?: string;
};

const field = 'space-y-1';

function gb(bytes: number) {
  if (!bytes) return '0';
  const n = bytes / (1024 * 1024 * 1024);
  return (Math.round(n * 10) / 10).toString();
}

function mb(bytes: number) {
  if (!bytes) return '0 МБ';
  return Math.round(bytes / (1024 * 1024)) + ' МБ';
}

function statusBadge(node: CacheNode) {
  if (node.status === 'disabled') return <Badge variant="secondary">выключен</Badge>;
  if (node.status === 'online') return <Badge variant="ok">онлайн</Badge>;
  return <Badge variant="bad">нет ответа</Badge>;
}

async function send(path: string, csrf: string, fields: Record<string, unknown>) {
  return api<CachePost>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ csrf, ...fields }),
  });
}

export function CachePanel({ csrf }: { csrf: string }) {
  const [data, setData] = useState<CachePayload | null>(null);
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [region, setRegion] = useState('');
  const [capacityGb, setCapacityGb] = useState('500');
  const [prefixMb, setPrefixMb] = useState('0');
  const [prefixPercent, setPrefixPercent] = useState('0');
  const [flagMb, setFlagMb] = useState('512');
  const [flagPercent, setFlagPercent] = useState('0');
  const [pinHash, setPinHash] = useState('');
  const [pinTitle, setPinTitle] = useState('');
  const [pinNode, setPinNode] = useState('');
  const [pinMagnet, setPinMagnet] = useState('');

  async function load() {
    const row = await api<CachePayload>('/admin/api/cache');
    if (row.auth === false) return;
    setData(row);
    if (row.prefixMb !== undefined) setFlagMb(String(row.prefixMb));
    if (row.prefixPercent !== undefined) setFlagPercent(String(row.prefixPercent));
  }

  useEffect(() => {
    void load();
  }, []);

  async function act(path: string, fields: Record<string, unknown>) {
    setError('');
    const res = await send(path, data?.csrf || csrf, fields);
    if (res.auth === false) return;
    if (res.token) setToken(res.token);
    if (res.error) setError(res.error);
    await load();
  }

  const enabled = data?.enabled === true;
  const nodes = data?.nodes || [];
  const assignments = data?.assignments || [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Кэш популярных раздач</CardTitle>
          <CardDescription>
            Узлы держат начало популярных раздач, чтобы воспроизведение начиналось сразу. Пока переключатель выключен, приложение и расчет ничего не меняют.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {enabled ? <Badge variant="ok">включено</Badge> : <Badge variant="secondary">выключено</Badge>}
            <Button
              variant={enabled ? 'secondary' : 'default'}
              onClick={() => void act('/admin/cache/settings', { enabled: !enabled, prefixMb: flagMb, prefixPercent: flagPercent })}
            >
              {enabled ? 'Выключить' : 'Включить'}
            </Button>
            <Button variant="secondary" onClick={() => void act('/admin/cache/recalc', {})}>
              Пересчитать
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className={field}>
              <Label>Префикс, МБ (0 - брать проценты)</Label>
              <Input value={flagMb} onChange={(e) => setFlagMb(e.target.value)} />
            </div>
            <div className={field}>
              <Label>Префикс, %</Label>
              <Input value={flagPercent} onChange={(e) => setFlagPercent(e.target.value)} />
            </div>
          </div>
          <Button variant="secondary" onClick={() => void act('/admin/cache/settings', { enabled, prefixMb: flagMb, prefixPercent: flagPercent })}>
            Сохранить префикс
          </Button>
        </CardContent>
      </Card>

      {token ? (
        <Alert>
          Токен узла показывается один раз. Скопируйте его в конфиг сервера и закройте эту строку.
          <div className="mt-2 break-all font-mono text-sm">{token}</div>
          <Button className="mt-2" variant="secondary" onClick={() => setToken('')}>
            Скрыть
          </Button>
        </Alert>
      ) : null}
      {error ? <Alert>{error}</Alert> : null}

      <Card>
        <CardHeader>
          <CardTitle>Новый узел</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className={field}>
            <Label>Имя</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className={field}>
            <Label>Адрес TorrServer</Label>
            <Input value={url} placeholder="http://cache.example:8090" onChange={(e) => setUrl(e.target.value)} />
          </div>
          <div className={field}>
            <Label>Регион</Label>
            <Input value={region} onChange={(e) => setRegion(e.target.value)} />
          </div>
          <div className={field}>
            <Label>Емкость, ГБ</Label>
            <Input value={capacityGb} onChange={(e) => setCapacityGb(e.target.value)} />
          </div>
          <div className={field}>
            <Label>Свой префикс, МБ (0 - общий)</Label>
            <Input value={prefixMb} onChange={(e) => setPrefixMb(e.target.value)} />
          </div>
          <div className={field}>
            <Label>Свой префикс, %</Label>
            <Input value={prefixPercent} onChange={(e) => setPrefixPercent(e.target.value)} />
          </div>
          <Button
            onClick={() =>
              void act('/admin/cache/node', { name, url, region, capacityGb, prefixMb, prefixPercent })
            }
          >
            Добавить и выдать токен
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Узлы</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Имя</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Диск</TableHead>
                <TableHead>Heartbeat</TableHead>
                <TableHead>Токен</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {nodes.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6}>Узлов нет</TableCell>
                </TableRow>
              ) : (
                nodes.map((n) => (
                  <TableRow key={n.id}>
                    <TableCell>
                      <div className="font-medium">{n.name}</div>
                      <div className="text-xs text-muted-foreground">{n.url}</div>
                      <div className="text-xs text-muted-foreground">
                        {n.region || 'регион не задан'} - {gb(n.capacityBytes)} ГБ
                      </div>
                    </TableCell>
                    <TableCell>
                      {statusBadge(n)}
                      <div className="mt-1 text-xs text-muted-foreground">{n.torrserverOk ? 'TorrServer отвечает' : 'TorrServer молчит'}</div>
                    </TableCell>
                    <TableCell>
                      {gb(n.diskUsedBytes)} / {gb(n.diskTotalBytes)} ГБ
                    </TableCell>
                    <TableCell>{n.lastHeartbeat ? when(n.lastHeartbeat) : 'не было'}</TableCell>
                    <TableCell>{n.hasToken ? 'есть' : 'отозван'}</TableCell>
                    <TableCell className="space-x-2 space-y-2">
                      <Button variant="secondary" onClick={() => void act('/admin/cache/token', { id: n.id })}>
                        Новый токен
                      </Button>
                      <Button variant="secondary" onClick={() => void act('/admin/cache/token/revoke', { id: n.id })}>
                        Отозвать
                      </Button>
                      <Button variant="secondary" onClick={() => void act('/admin/cache/node/disable', { id: n.id, disabled: !n.disabled })}>
                        {n.disabled ? 'Включить узел' : 'Выключить узел'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Закрепить раздачу</CardTitle>
          <CardDescription>Пустой магнит означает раздачу по DHT. Ссылку с ключом трекера панель не сохранит.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className={field}>
            <Label>infohash</Label>
            <Input value={pinHash} onChange={(e) => setPinHash(e.target.value)} />
          </div>
          <div className={field}>
            <Label>Название</Label>
            <Input value={pinTitle} onChange={(e) => setPinTitle(e.target.value)} />
          </div>
          <div className={field}>
            <Label>Узел</Label>
            <select className="h-10 rounded-md border border-input bg-secondary px-3 text-sm" value={pinNode} onChange={(e) => setPinNode(e.target.value)}>
              <option value="">выберите</option>
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
            </select>
          </div>
          <div className={field}>
            <Label>Магнит</Label>
            <Input value={pinMagnet} onChange={(e) => setPinMagnet(e.target.value)} />
          </div>
          <Button onClick={() => void act('/admin/cache/pin', { infohash: pinHash, title: pinTitle, nodeId: pinNode, magnet: pinMagnet })}>
            Закрепить
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Назначения</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Раздача</TableHead>
                <TableHead>Узел</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Префикс</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assignments.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5}>Назначений нет</TableCell>
                </TableRow>
              ) : (
                assignments.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      <div>{a.title || a.infohash}</div>
                      <div className="font-mono text-xs text-muted-foreground">{a.infohash}</div>
                    </TableCell>
                    <TableCell>{a.nodeName}</TableCell>
                    <TableCell>
                      {a.status}
                      {a.pinned ? ' - закреплено' : ''}
                      {a.source === 'manual' ? ' - вручную' : ''}
                      {a.error ? ' - ' + a.error : ''}
                    </TableCell>
                    <TableCell>{mb(a.prefixBytes)}</TableCell>
                    <TableCell>
                      <Button variant="secondary" onClick={() => void act('/admin/cache/unpin', { id: a.id })}>
                        Снять
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
