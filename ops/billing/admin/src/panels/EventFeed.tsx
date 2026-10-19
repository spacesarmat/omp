import { useState } from 'react';
import { Ban, CreditCard, Repeat, Shield, Smartphone, Ticket } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Stamp } from '@/components/stamp';
import { Pager } from '@/components/chrome';
import { actorLine, eventKind } from '@/lib/text';
import { groupByDay } from '@/lib/time';
import type { FeedEvent } from '@/lib/types';

const selectClass = 'h-10 w-full rounded-md border border-input bg-secondary px-3 text-sm text-foreground sm:w-auto';

const KIND_ICON: Record<string, typeof CreditCard> = {
  pay: CreditCard,
  promo: Ticket,
  activate: Smartphone,
  fail: Ban,
  admin: Shield,
  device: Repeat,
};

function KindBadge({ kind }: { kind: string }) {
  const Icon = KIND_ICON[kind] || Shield;
  const variant = kind === 'fail' ? 'bad' : kind === 'pay' ? 'ok' : 'count';
  return (
    <Badge variant={variant} className="gap-1">
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {eventKind(kind)}
    </Badge>
  );
}

export function HomeFeed({ events }: { events: FeedEvent[] }) {
  const [kind, setKind] = useState('');
  const [page, setPage] = useState(1);
  const size = 15;
  const filtered = events.filter((e) => !kind || e.kind === kind);
  const pages = Math.max(1, Math.ceil(filtered.length / size));
  const slice = filtered.slice((page - 1) * size, page * size);
  const groups = groupByDay(slice);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Лента событий</CardTitle>
        <CardDescription className="space-y-2">
          <p>Время — МСК. Нажмите на часы, чтобы увидеть секунды.</p>
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
            <option value="admin">Админ</option>
            <option value="device">Смена устройства</option>
          </select>
        </CardDescription>
      </CardHeader>
      <CardContent>
        {slice.length === 0 ? <p className="text-muted-foreground">Пока пусто</p> : null}
        <div className="space-y-4">
          {groups.map((group) => (
            <section key={group.key}>
              <h3 className="sticky top-0 z-10 bg-card py-1 text-sm font-semibold">{group.title}</h3>
              <ol className="ml-2 border-l border-border">
                {group.items.map((e, i) => (
                  <li key={group.key + '-' + i} className="relative pb-4 pl-4">
                    <span className="absolute -left-[7px] top-1.5 h-3 w-3 rounded-full border-2 border-primary bg-card" aria-hidden />
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <Stamp ms={e.at} variant="time" />
                      <KindBadge kind={e.kind} />
                      <span className="text-sm font-medium">{actorLine(e.actor, { deviceId: e.deviceId, fallback: 'система' })}</span>
                    </div>
                    <p className="mt-1 text-sm">{e.text}</p>
                    {e.accountId ? (
                      <a className="text-sm text-primary" href={'/admin/?id=' + encodeURIComponent(e.accountId)}>
                        карточка
                      </a>
                    ) : null}
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
        <Pager page={page} pages={pages} total={filtered.length} onPage={setPage} />
      </CardContent>
    </Card>
  );
}
