import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api, post } from '@/lib/api';
import { useLive } from '@/lib/live';
import { toast } from '@/components/chrome';
import { Stamp } from '@/components/stamp';
import type { DeskData } from '@/lib/desk';

type Group = {
  id: string;
  status: string;
  count: number;
  devices: number;
  versions: string[];
  firstAt: number;
  lastAt: number;
  title: string;
  regression: boolean;
};

export function CrashesDesk({ csrf }: { csrf: string }) {
  const { paused } = useLive();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['crashes'],
    refetchInterval: paused ? false : 15000,
    queryFn: () => api<{ groups?: Group[] }>('/admin/api/crashes'),
  });
  const groups = q.data?.groups || [];
  return (
    <div className="space-y-2">
      {groups.length === 0 ? <p className="text-sm text-muted-foreground">Сбоев нет</p> : null}
      {groups.map((g) => (
        <Card key={g.id}>
          <CardContent className="space-y-2 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-medium">{g.title}</div>
                <div className="font-mono text-xs text-muted-foreground">
                  {g.id} · {g.count} · устройств {g.devices} · {g.status}
                  {g.regression ? ' · регрессия' : ''} · <Stamp ms={g.lastAt} />
                </div>
                <div className="text-xs text-muted-foreground">{(g.versions || []).join(', ')}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <a className="text-sm text-primary" href={'/admin/api/crashes/log?id=' + encodeURIComponent(g.id)}>
                  Лог
                </a>
                <Button
                  variant="secondary"
                  onClick={() =>
                    void api<{ text?: string }>('/admin/api/crashes/draft?id=' + encodeURIComponent(g.id)).then((r) => {
                      void navigator.clipboard.writeText(r.text || '');
                      toast('Текст issue скопирован');
                    })
                  }
                >
                  Текст issue
                </Button>
                {['progress', 'fixed', 'ignored'].map((status) => (
                  <Button
                    key={status}
                    variant="secondary"
                    onClick={() => {
                      if (!window.confirm('Поставить статус ' + status + '?')) return;
                      void post('/admin/api/crashes/status', csrf, { id: g.id, status, confirm: 'yes' }).then(() => qc.invalidateQueries({ queryKey: ['crashes'] }));
                    }}
                  >
                    {status === 'progress' ? 'В работе' : status === 'fixed' ? 'Исправлен' : 'Игнор'}
                  </Button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function BroadcastDesk({ csrf }: { csrf: string }) {
  const [text, setText] = useState('');
  const [segment, setSegment] = useState('all');
  const [preview, setPreview] = useState<{ id: string; count: number } | null>(null);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Рассылка в бот</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <textarea className="min-h-28 w-full rounded-md border border-border bg-background p-2 text-sm" value={text} onChange={(e) => setText(e.target.value)} placeholder="Текст сообщения" />
        <select className="h-10 rounded-md border border-border bg-secondary px-2" value={segment} onChange={(e) => setSegment(e.target.value)} aria-label="Кому">
          <option value="all">Все с Telegram</option>
          <option value="active">Активная подписка</option>
          <option value="lapsed">Без активной подписки</option>
        </select>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={() =>
              void post('/admin/api/broadcast/preview', csrf, { text, segment }).then((r) => {
                const extra = r as { id?: string; count?: number; ok?: boolean };
                if (!extra.ok || !extra.id) {
                  toast('Не удалось');
                  return;
                }
                setPreview({ id: extra.id, count: extra.count || 0 });
                toast('Получателей: ' + (extra.count || 0));
              })
            }
          >
            Предпросмотр
          </Button>
          <Button
            disabled={!preview}
            onClick={() => {
              if (!preview) return;
              if (!window.confirm('Отправить ' + preview.count + ' сообщений? Это нельзя отменить.')) return;
              void post('/admin/api/broadcast/send', csrf, { id: preview.id, confirm: 'yes' }).then((r) => {
                toast(r.ok ? 'Отправлено' : 'Не отправлено');
                setPreview(null);
              });
            }}
          >
            Отправить
          </Button>
        </div>
        {preview ? <p className="text-sm text-muted-foreground">Черновик на {preview.count}. Само по себе ничего не уходит.</p> : null}
      </CardContent>
    </Card>
  );
}

export function VersionsDesk({ data }: { data?: DeskData }) {
  const rows = data?.versions || [];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Версии приложений</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 text-sm">
        <p className="text-muted-foreground">Бета сейчас: {data?.betaPercent ?? 100}% устройств, которые сами включили бету.</p>
        {rows.length === 0 ? <p>Пока нет сигналов версии.</p> : null}
        {rows.map((r) => (
          <div key={r.label} className="flex justify-between font-mono">
            <span>{r.label}</span>
            <span>{r.count}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function LoginsDesk() {
  const q = useQuery({ queryKey: ['logins'], queryFn: () => api<{ rows?: { at: number; ip: string; ua: string; result: string; telegramId?: string }[] }>('/admin/api/logins') });
  const rows = q.data?.rows || [];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Входы в админку</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 text-sm">
        {rows.length === 0 ? <p className="text-muted-foreground">Записей нет</p> : null}
        {rows.map((r, i) => (
          <div key={i} className="font-mono text-xs">
            <Stamp ms={r.at} /> {r.result} {r.ip || '-'} {r.telegramId || ''} {r.ua || ''}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

