import { useState, type ReactNode } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Stamp } from '@/components/stamp';
import type { PostResult } from '@/lib/api';
import { purchaseKind } from '@/lib/text';
import { listStamp } from '@/lib/time';
import type { DeviceRow, PendingPayment, UserData } from '@/lib/types';

type Run = (path: string, fields?: Record<string, unknown>) => Promise<PostResult | undefined>;

const DAY = 24 * 60 * 60 * 1000;

/**
 * Two-step button: the first click shows the question and «Да», nothing is sent before that.
 * The server also refuses these actions without confirm=yes.
 */
export function ConfirmAction({
  label,
  question,
  yes,
  onYes,
  variant = 'secondary',
  disabled,
}: {
  label: string;
  question: ReactNode;
  yes: string;
  onYes: () => void;
  variant?: 'secondary' | 'destructive' | 'default';
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Button size="sm" variant={variant} disabled={disabled} onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2 rounded-md border border-amber-700/60 bg-amber-950/30 px-2 py-1 text-sm">
      <span>{question}</span>
      <Button
        size="sm"
        variant="destructive"
        onClick={() => {
          setOpen(false);
          onYes();
        }}
      >
        {yes}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
        Отмена
      </Button>
    </span>
  );
}

function SeenCell({ ms }: { ms?: number }) {
  if (!ms) return <span className="text-muted-foreground">не было</span>;
  return <Stamp ms={ms} />;
}

/** Over-limit warning for the user card. */
export function OverLimitAlert({ user }: { user: UserData }) {
  const sub = user.subscription;
  if (!sub || !sub.overLimit) return null;
  return (
    <Alert variant="warn">
      Устройств больше лимита: привязано {sub.bound} при лимите {sub.deviceLimit}. Устройства сверх лимита (привязанные последними) не
      работают. Отзовите лишнее или поднимите лимит.
    </Alert>
  );
}

export function DevicesCard({ user, run }: { user: UserData; run: Run }) {
  const sub = user.subscription;
  const devices: DeviceRow[] = user.devices || [];
  const swaps = sub?.swaps;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Устройства{' '}
          {sub ? (
            <Badge variant={sub.overLimit ? 'warn' : 'count'} className="ml-2 align-middle">
              {devices.length} из {sub.deviceLimit}
            </Badge>
          ) : null}
        </CardTitle>
        <CardDescription>
          «Последний раз» - поиск, скачивание или проверка подписки с этого устройства (обновляется не чаще раза в 10 минут). IP хранится
          без последней части. «Отозвать» отвязывает устройство и сразу гасит его токен, для слота выпускается новый код, пользователю
          уходит сообщение в Telegram.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {devices.length === 0 ? <p className="text-sm text-muted-foreground">Привязанных устройств нет</p> : null}
        {devices.length > 0 ? (
          <Table className="min-w-[40rem]">
            <TableHeader>
              <TableRow>
                <TableHead>Устройство</TableHead>
                <TableHead>Привязано, МСК</TableHead>
                <TableHead>Последний раз, МСК</TableHead>
                <TableHead>IP</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {devices.map((d) => (
                <TableRow key={d.id || d.codeId}>
                  <TableCell className="font-mono">
                    {d.name ? <span className="font-sans">{d.name} </span> : null}
                    {d.deviceId}…{' '}
                    {d.overLimit ? (
                      <Badge variant="warn" className="ml-1">
                        сверх лимита, не работает
                      </Badge>
                    ) : null}
                    {d.cloneAt ? (
                      <Badge variant="warn" className="ml-1" title="Использованный ключ этого устройства пришёл повторно. Если это не потеря сети - отзовите устройство.">
                        возможен клон{d.cloneCount && d.cloneCount > 1 ? ' ×' + d.cloneCount : ''}
                      </Badge>
                    ) : null}
                    <div className="font-sans text-xs text-muted-foreground">
                      {d.auth === 'refresh' ? 'новые токены' : 'старый токен'}
                      {d.cloneAt ? (
                        <>
                          {' · клон: '}
                          <Stamp ms={d.cloneAt} />
                        </>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <Stamp ms={d.boundAt} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <SeenCell ms={d.lastSeenAt} />
                  </TableCell>
                  <TableCell className="font-mono text-xs">{d.lastIp || '-'}</TableCell>
                  <TableCell>
                    <ConfirmAction
                      label="Отозвать"
                      variant="destructive"
                      question={<>Отозвать {d.deviceId}…? Поиск на нём перестанет работать сразу, пользователь получит сообщение в Telegram.</>}
                      yes="Да, отозвать"
                      onYes={() => void run('/admin/device-revoke', { accountId: user.account.id, deviceRowId: d.id || '', codeId: d.codeId, confirm: 'yes' })}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
        {swaps ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>
              Смены устройства в боте: {swaps.used} из {swaps.limit} за 30 дней
              {swaps.left < 1 && swaps.nextAt ? <> · следующая с {listStamp(swaps.nextAt)} МСК</> : null}
              {swaps.resetAt ? (
                <span className="text-muted-foreground">
                  {' '}
                  · сброшен <Stamp ms={swaps.resetAt} />
                </span>
              ) : null}
            </span>
            <ConfirmAction
              label="Сбросить счётчик"
              question="Разрешить пользователю ещё 2 смены прямо сейчас?"
              yes="Да, сбросить"
              disabled={swaps.used === 0}
              onYes={() => void run('/admin/swaps-reset', { accountId: user.account.id })}
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function LimitCard({ user, run }: { user: UserData; run: Run }) {
  const sub = user.subscription;
  const [own, setOwn] = useState(sub?.limitOverride ? String(sub.limitOverride) : '');
  const [extra, setExtra] = useState(String(sub?.extraSlots ?? 0));
  const [bonusCount, setBonusCount] = useState('1');
  const [bonusDays, setBonusDays] = useState('');
  const [reason, setReason] = useState('');
  if (!sub) return null;
  const globalBase = sub.globalBase ?? 2;
  const activeBonus = sub.bonusSlots ?? 0;
  const nextTotal = (own.trim() ? Number(own) || 0 : globalBase) + activeBonus + (Number(extra) || 0);
  const lowering = nextTotal < (sub.bound || 0);
  const bonus = sub.bonus || [];
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Лимит устройств{' '}
          <Badge variant="count" className="ml-2 align-middle">
            {sub.deviceLimit}
          </Badge>
          {sub.limitOverride ? (
            <Badge variant="warn" className="ml-2 align-middle">
              индивидуальный лимит
            </Badge>
          ) : null}
        </CardTitle>
        <CardDescription>
          Сейчас: {sub.limitText || sub.deviceLimit}
          {sub.extraSlots ? ', купленные до ' + listStamp(sub.extraUntil || 0) + ' МСК' : ''}. Лимит = база + бонусные + купленные. База -
          общая из настроек ({globalBase}), если не задан индивидуальный лимит: он заменяет базу и не меняется, когда меняют общую. Бонусные -
          бесплатно, навсегда или до даты, в цену продления не входят. Купленные (доп.) - помесячные: выданные здесь действуют до конца
          оплаченного периода и дальше продлеваются вместе с подпиской.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">Индивидуальный лимит</span>
            <Input
              className="w-40"
              type="number"
              min={1}
              max={20}
              placeholder={'пусто = общий (' + globalBase + ')'}
              value={own}
              onChange={(e) => setOwn(e.target.value)}
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">Купленные (доп.)</span>
            <Input className="w-24" type="number" min={0} max={20} value={extra} onChange={(e) => setExtra(e.target.value)} />
          </label>
          <ConfirmAction
            label="Сохранить"
            variant="default"
            question={
              <>
                Лимит станет {nextTotal}
                {own.trim() ? ' (индивидуальный ' + own.trim() + ')' : ' (общая база ' + globalBase + ')'}
                {lowering ? '. Привязано ' + sub.bound + ': последние сверх лимита перестанут работать' : ''}. Сохранить?
              </>
            }
            yes="Да, сохранить"
            onYes={() => void run('/admin/limit', { accountId: user.account.id, limitOverride: own.trim(), extraSlots: extra })}
          />
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium">Бонусные устройства</p>
          {bonus.length === 0 ? <p className="text-sm text-muted-foreground">Нет</p> : null}
          {bonus.length > 0 ? (
            <Table className="min-w-[36rem]">
              <TableHeader>
                <TableRow>
                  <TableHead>Кол-во</TableHead>
                  <TableHead>Срок</TableHead>
                  <TableHead>Причина</TableHead>
                  <TableHead>Выдано, МСК</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {bonus.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell>+{b.count}</TableCell>
                    <TableCell>
                      {b.until === null ? 'навсегда' : 'до ' + listStamp(b.until)}
                      {b.active ? null : (
                        <Badge variant="secondary" className="ml-1">
                          истёк
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {b.reason || <span className="text-muted-foreground">-</span>}
                      {b.source === 'promo' ? null : <span className="text-xs text-muted-foreground"> · вручную</span>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Stamp ms={b.grantedAt} />
                    </TableCell>
                    <TableCell>
                      <ConfirmAction
                        label="Снять"
                        question={<>Снять {b.count} бонусн. устр.?</>}
                        yes="Да, снять"
                        onYes={() => void run('/admin/bonus-remove', { accountId: user.account.id, bonusId: b.id, confirm: 'yes' })}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1 text-sm">
              <span className="text-muted-foreground">Устройств</span>
              <Input className="w-20" type="number" min={1} max={20} value={bonusCount} onChange={(e) => setBonusCount(e.target.value)} />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-muted-foreground">Дней</span>
              <Input className="w-36" type="number" min={1} max={3650} placeholder="пусто = навсегда" value={bonusDays} onChange={(e) => setBonusDays(e.target.value)} />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-muted-foreground">Причина</span>
              <Input className="w-56" maxLength={80} value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
            <Button
              size="sm"
              onClick={() => void run('/admin/bonus', { accountId: user.account.id, count: bonusCount, days: bonusDays.trim(), reason })}
            >
              Выдать бонус
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function SubtractDaysCard({ user, run }: { user: UserData; run: Run }) {
  const sub = user.subscription;
  const [days, setDays] = useState('1');
  if (!sub || !sub.paidUntil) return null;
  const n = Math.floor(Number(days));
  const valid = Number.isFinite(n) && n >= 1 && n <= 3650 && String(n) === days.trim();
  const after = sub.paidUntil - (valid ? n : 0) * DAY;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Убавить дни</CardTitle>
        <CardDescription>
          Сдвигает окончание назад, например после возврата денег. Если дата уйдёт в прошлое, поиск выключится после льготного периода.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">Дней</span>
          <Input className="w-24" type="number" min={1} max={3650} value={days} onChange={(e) => setDays(e.target.value)} />
        </label>
        <ConfirmAction
          label="Убавить"
          variant="destructive"
          disabled={!valid}
          question={
            <>
              Убавить {n} дн.? Подписка будет до {listStamp(after)} МСК
              {after <= Date.now() ? ' - это уже в прошлом' : ''}.
            </>
          }
          yes="Да, убавить"
          onYes={() => void run('/admin/subtract', { accountId: user.account.id, days: String(n), confirm: 'yes' })}
        />
      </CardContent>
    </Card>
  );
}

/**
 * YooMoney transfers that wait for acceptance in the wallet (`unaccepted`). «Подтвердить платёж»
 * applies one once (a second click or YooMoney's own accepted notice changes nothing).
 */
export function PendingPayments({
  rows,
  run,
  accountId,
  showWho,
}: {
  rows: PendingPayment[];
  run: Run;
  accountId?: string;
  showWho?: boolean;
}) {
  if (!rows.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Ждут подтверждения в ЮMoney{' '}
          <Badge variant="warn" className="ml-2 align-middle">
            {rows.length}
          </Badge>
        </CardTitle>
        <CardDescription>
          ЮMoney держит эти переводы, пока их не примут в кошельке, и подписку они не продлили. Примите перевод в кошельке и нажмите
          «Подтвердить платёж» - он применится один раз. «Отклонить» - если перевод отклонён или возвращён.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.map((p) => (
          <div key={p.operationId} className="space-y-2 rounded-md border border-amber-800/50 px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Stamp ms={p.at} />
              <span className="font-medium">{p.amount || '?'} ₽</span>
              <Badge variant="count">{purchaseKind(p.kind, p.price)}</Badge>
              {showWho && p.accountId ? (
                <a className="text-primary" href={'/admin/?id=' + encodeURIComponent(p.accountId)}>
                  {p.who || 'карточка'}
                </a>
              ) : null}
              <span className="font-mono text-xs text-muted-foreground">{p.operationId}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <ConfirmAction
                label="Подтвердить платёж"
                variant="default"
                question={<>Перевод {p.amount} ₽ принят в кошельке? Подписка продлится сразу, пользователь получит сообщение.</>}
                yes="Да, подтвердить"
                onYes={() => void run('/admin/payment-confirm', { operationId: p.operationId, accountId: accountId || '', confirm: 'yes' })}
              />
              <ConfirmAction
                label="Отклонить"
                question={<>Убрать платёж {p.amount} ₽ из ожидания, ничего не продлевая?</>}
                yes="Да, отклонить"
                onYes={() => void run('/admin/payment-reject', { operationId: p.operationId, accountId: accountId || '', confirm: 'yes' })}
              />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
