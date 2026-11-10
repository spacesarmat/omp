import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, post } from '@/lib/api';

type WatchRow = {
  infohash: string;
  fileIndex: number;
  deviceClass: string;
  titleKey: string;
  title: string;
  season: number;
  episode: number;
  samples: number;
  completed: number;
  switched: number;
  ttffMs: number;
  rebufferN: number;
  codecOk: number;
  codecFail: number;
  pinned: boolean;
  banned: boolean;
  note: string;
  score: number;
  reason: string;
};

type VoiceRow = { titleKey: string; voice: string; picks: number };
type CodecRow = { deviceClass: string; codec: string; reports: number };

type Payload = {
  auth?: boolean;
  ok?: boolean;
  enabled?: boolean;
  rows?: WatchRow[];
  voices?: VoiceRow[];
  codecs?: CodecRow[];
  error?: string;
};

function reasonText(reason: string) {
  if (reason === 'community') return 'зрители';
  if (reason === 'blend') return 'смесь';
  if (reason === 'pinned') return 'закреп';
  if (reason === 'banned') return 'запрет';
  return 'сиды';
}

export function WatchPanel({ csrf }: { csrf: string }) {
  const [q, setQ] = useState('');
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (query: string) => {
    const view = await api<Payload>('/admin/api/watch-rank?q=' + encodeURIComponent(query));
    setData(view);
  }, []);

  useEffect(() => {
    void load('');
  }, [load]);

  async function saveFlag(enabled: boolean) {
    setBusy(true);
    await post('/admin/watch-rank', csrf, { enabled });
    await load(q);
    setBusy(false);
  }

  async function saveMod(row: WatchRow, patch: { pinned?: boolean; banned?: boolean }) {
    setBusy(true);
    await post('/admin/watch-rank', csrf, {
      infohash: row.infohash,
      pinned: patch.pinned !== undefined ? patch.pinned : row.pinned,
      banned: patch.banned !== undefined ? patch.banned : row.banned,
      note: row.note,
    });
    await load(q);
    setBusy(false);
  }

  const rows = data && data.rows ? data.rows : [];
  const voices = data && data.voices ? data.voices : [];
  const codecs = data && data.codecs ? data.codecs : [];
  const on = !!(data && data.enabled);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Подбор раздач</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant={on ? 'ok' : 'secondary'}>{on ? 'ранжирование включено' : 'ранжирование выключено'}</Badge>
            <Button type="button" disabled={busy} onClick={() => void saveFlag(!on)}>
              {on ? 'Выключить' : 'Включить'}
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Пока нет оценок просмотра, поиск не меняет порядок. Закрепление и запрет действуют сразу. В общие таблицы попадают только хеши и счетчики.
          </p>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void load(q);
            }}
          >
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Название или infohash" />
            <Button type="submit">Найти</Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Раздачи</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Раздача</TableHead>
                <TableHead>Класс</TableHead>
                <TableHead>Оценка</TableHead>
                <TableHead>Сигналы</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.infohash + ':' + r.fileIndex + ':' + r.deviceClass}>
                  <TableCell>
                    <div>{r.title || r.titleKey || r.infohash}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.infohash.slice(0, 12)} · s{r.season}e{r.episode} · {reasonText(r.reason)}
                    </div>
                  </TableCell>
                  <TableCell>{r.deviceClass === 'tv' ? 'ТВ' : 'Телефон'}</TableCell>
                  <TableCell>{Math.round(r.score)}</TableCell>
                  <TableCell>
                    {r.samples} просм., {r.completed} до конца, {r.switched} уходов, кадр {r.ttffMs && r.samples ? Math.round(r.ttffMs / r.samples) : 0} мс, ребуфер {r.rebufferN}, кодек {r.codecOk}/{r.codecOk + r.codecFail}
                  </TableCell>
                  <TableCell className="space-x-2">
                    <Button type="button" disabled={busy} onClick={() => void saveMod(r, { pinned: !r.pinned, banned: false })}>
                      {r.pinned ? 'Открепить' : 'Закрепить'}
                    </Button>
                    <Button type="button" disabled={busy} onClick={() => void saveMod(r, { banned: !r.banned, pinned: false })}>
                      {r.banned ? 'Разрешить' : 'Запретить'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!rows.length ? (
                <TableRow>
                  <TableCell colSpan={5}>Пока нет сигналов</TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Озвучки и кодеки</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {voices.slice(0, 12).map((v) => (
            <div key={v.titleKey + ':' + v.voice}>
              {v.titleKey}: {v.voice} ({v.picks})
            </div>
          ))}
          {codecs.map((c) => (
            <div key={c.deviceClass + ':' + c.codec}>
              {c.deviceClass} {c.codec}: {c.reports}
            </div>
          ))}
          {!voices.length && !codecs.length ? <div>Пока пусто</div> : null}
        </CardContent>
      </Card>
    </div>
  );
}
