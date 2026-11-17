import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { post, type PostResult } from '@/lib/api';
import { nextTierFriends } from '@/lib/nextTierFriends';

type Tier = { friends: number; days: number; percent: number };

type Settings = {
  enabled?: boolean;
  referrerDays?: number;
  friendDays?: number;
  balance?: boolean;
  balancePercent?: number;
  balanceMax?: number;
  balanceMonthlyCap?: number;
  tiers?: boolean;
  tierList?: Tier[];
  friendDiscount?: boolean;
  friendDiscountPercent?: number;
  friendDiscountRub?: number;
  friendDiscountDays?: number;
  retention?: boolean;
  retentionMonths?: number;
  retentionDays?: number;
  delayDays?: number;
  yearlyCap?: number;
};

type Row = {
  id: string;
  friendId?: string;
  status: string;
  days: number;
  variant?: string;
  credit?: number;
  reason?: string;
  shortfall?: string;
};

function clamp(raw: string, max: number) {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(max, n);
}

function variantLabel(variant?: string) {
  if (variant === 'balance') return 'Баланс';
  if (variant === 'retention') return 'Удержание';
  return 'Дни';
}

/**
 * Each variant is its own switch and its own numbers. The master flag is separate.
 * Local copy is what the next save sends, so a second edit does not restore the old flag.
 */
export function ReferralPanel({
  csrf,
  settings,
  journal,
  run,
}: {
  csrf: string;
  settings?: Settings;
  journal?: Row[];
  run?: (fields: Record<string, unknown>) => Promise<PostResult | undefined>;
}) {
  const [local, setLocal] = useState<Settings>(settings || {});
  const [rows, setRows] = useState<Row[]>(journal || []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => {
    setLocal(settings || {});
  }, [settings]);
  useEffect(() => {
    setRows(journal || []);
  }, [journal]);

  const save = async (patch: Settings, cancelId?: string) => {
    const next = { ...local, ...patch };
    setBusy(true);
    setError('');
    setNote('');
    try {
      const body = { settings: next, ...(cancelId ? { cancelId } : {}) };
      const res = run ? await run(body) : await post('/admin/referral', csrf, body);
      if (!res || res.auth === false || res.ok === false || res.flash?.error) {
        setError((res && res.flash && res.flash.error) || 'Не сохранилось');
        return;
      }
      setLocal(next);
      if (res.flash?.text) setNote(res.flash.text);
      if (cancelId) {
        setRows((cur) => cur.map((row) => (row.id === cancelId ? { ...row, status: 'cancelled', reason: 'manual' } : row)));
      }
    } catch {
      setError('Не сохранилось');
    } finally {
      setBusy(false);
    }
  };
  const toggle = (key: keyof Settings) => void save({ [key]: !local[key] } as Settings);
  const tiers = local.tierList || [];
  const saveTiers = (tierList: Tier[]) => void save({ tierList });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Реферальная программа</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 [&_label]:mt-1 [&_label]:block">
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {note ? <p className="text-sm">{note}</p> : null}
        <Button type="button" variant={local.enabled ? 'default' : 'secondary'} disabled={busy} onClick={() => toggle('enabled')}>
          {local.enabled ? 'Программа включена' : 'Программа выключена'}
        </Button>
        <Label>Дни рефереру (0-14)</Label>
        <Input defaultValue={String(local.referrerDays ?? 0)} onBlur={(e) => void save({ referrerDays: clamp(e.target.value, 14) })} />
        <p className="text-sm text-muted-foreground">Базовые дни за первого оплатившего друга. Потолок одного начисления - 14 дней.</p>
        <Label>Бонусные дни другу (0-14)</Label>
        <Input defaultValue={String(local.friendDays ?? 0)} onBlur={(e) => void save({ friendDays: clamp(e.target.value, 14) })} />
        <Label>Задержка, дней (0-365)</Label>
        <Input defaultValue={String(local.delayDays ?? 7)} onBlur={(e) => void save({ delayDays: clamp(e.target.value, 365) })} />
        <p className="text-sm text-muted-foreground">Дни, баланс и удержание начисляются только после этой паузы. 0 - сразу после оплаты.</p>
        <Label>Годовой лимит, месяцев (0-120)</Label>
        <Input defaultValue={String(local.yearlyCap ?? 12)} onBlur={(e) => void save({ yearlyCap: clamp(e.target.value, 120) })} />
        <p className="text-sm text-muted-foreground">Сколько месяцев бонусных дней реферер может получить за 365 дней. 0 - без лимита. Месяц считается как 30 дней.</p>

        <Button type="button" variant={local.balance ? 'default' : 'secondary'} disabled={busy} onClick={() => toggle('balance')}>
          {local.balance ? 'Процент на баланс включен' : 'Процент на баланс выключен'}
        </Button>
        <Label>Процент от оплаты друга (0-100)</Label>
        <Input defaultValue={String(local.balancePercent ?? 0)} onBlur={(e) => void save({ balancePercent: clamp(e.target.value, 100) })} />
        <Label>Максимум за одну оплату, руб (0 - без потолка)</Label>
        <Input defaultValue={String(local.balanceMax ?? 0)} onBlur={(e) => void save({ balanceMax: clamp(e.target.value, 1000000) })} />
        <Label>Потолок баланса за календарный месяц, руб (0 - без потолка)</Label>
        <Input defaultValue={String(local.balanceMonthlyCap ?? 0)} onBlur={(e) => void save({ balanceMonthlyCap: clamp(e.target.value, 1000000) })} />
        <p className="text-sm text-muted-foreground">Рубли падают на внутренний баланс подписки и списываются при следующей оплате. Пока переключатель выключен, процент не начисляется. Уровень может поднять процент, если он выше.</p>

        <Button type="button" variant={local.tiers ? 'default' : 'secondary'} disabled={busy} onClick={() => toggle('tiers')}>
          {local.tiers ? 'Уровни включены' : 'Уровни выключены'}
        </Button>
        <p className="text-sm text-muted-foreground">Порог - сколько друзей уже оплатили. Дни уровня заменяют базовые, если они больше, но не больше 14. Процент уровня берется, если он выше процента на баланс. Пустой список ничего не меняет.</p>
        {local.tiers ? (
          <div className="space-y-2">
            {tiers.map((tier, index) => (
              <div key={tier.friends + '-' + index} className="flex flex-wrap items-center gap-2">
                <Input className="w-24" defaultValue={String(tier.friends)} aria-label="Друзей" onBlur={(e) => {
                  const next = tiers.slice();
                  next[index] = { ...tier, friends: clamp(e.target.value, 10000) };
                  saveTiers(next);
                }} />
                <Input className="w-24" defaultValue={String(tier.days)} aria-label="Дней уровня" onBlur={(e) => {
                  const next = tiers.slice();
                  next[index] = { ...tier, days: clamp(e.target.value, 14) };
                  saveTiers(next);
                }} />
                <Input className="w-24" defaultValue={String(tier.percent)} aria-label="Процент уровня" onBlur={(e) => {
                  const next = tiers.slice();
                  next[index] = { ...tier, percent: clamp(e.target.value, 100) };
                  saveTiers(next);
                }} />
                <Button type="button" variant="secondary" disabled={busy} onClick={() => saveTiers(tiers.filter((_, i) => i !== index))}>Убрать</Button>
              </div>
            ))}
            <Button type="button" variant="secondary" disabled={busy} onClick={() => saveTiers(tiers.concat([{ friends: nextTierFriends(tiers.map((tier) => tier.friends)), days: 14, percent: 0 }]))}>
              Добавить уровень
            </Button>
          </div>
        ) : null}

        <Button type="button" variant={local.friendDiscount ? 'default' : 'secondary'} disabled={busy} onClick={() => toggle('friendDiscount')}>
          {local.friendDiscount ? 'Скидка другу включена' : 'Скидка другу выключена'}
        </Button>
        <Label>Скидка, процент (0-100)</Label>
        <Input defaultValue={String(local.friendDiscountPercent ?? 0)} onBlur={(e) => void save({ friendDiscountPercent: clamp(e.target.value, 100) })} />
        <Label>Скидка, руб (0 - нет фиксированной суммы)</Label>
        <Input defaultValue={String(local.friendDiscountRub ?? 0)} onBlur={(e) => void save({ friendDiscountRub: clamp(e.target.value, 1000000) })} />
        <Label>Срок скидки, дней с привязки (0 - без срока)</Label>
        <Input defaultValue={String(local.friendDiscountDays ?? 0)} onBlur={(e) => void save({ friendDiscountDays: clamp(e.target.value, 3650) })} />
        <p className="text-sm text-muted-foreground">Только первая оплата подписки, и только пока у реферера есть доступ. Процент и рубли складываются. Цена в боте и в приложении берется уже со скидкой и замораживается в заказе.</p>

        <Button type="button" variant={local.retention ? 'default' : 'secondary'} disabled={busy} onClick={() => toggle('retention')}>
          {local.retention ? 'Удержание включено' : 'Удержание выключено'}
        </Button>
        <Label>Подряд месяцев (1-36)</Label>
        <Input defaultValue={String(local.retentionMonths ?? 3)} onBlur={(e) => void save({ retentionMonths: Math.max(1, clamp(e.target.value, 36)) })} />
        <Label>Дней за удержание (0-14)</Label>
        <Input defaultValue={String(local.retentionDays ?? 0)} onBlur={(e) => void save({ retentionDays: clamp(e.target.value, 14) })} />
        <p className="text-sm text-muted-foreground">Месяц - следующая оплата через 27-45 дней. Большой разрыв начинает счет заново. 0 дней - бонус не выдается, даже если переключатель включен.</p>

        <p className="text-sm text-muted-foreground">Бонус только при активной подписке реферера и оплате друга. Нельзя пригласить себя. Один Telegram или одно устройство - одно приглашение.</p>
        <h3 className="font-semibold">Журнал</h3>
        {rows.length === 0 ? <p className="text-sm">Начислений нет</p> : rows.map((row) => (
          <div key={row.id} className="flex flex-wrap items-center gap-2 text-sm">
            <span>
              {row.friendId || row.id} · {variantLabel(row.variant)} · {row.status} · {row.days} дн.
              {row.credit ? ' · ' + row.credit + ' ₽' : ''}
              {row.shortfall ? ' · ' + row.shortfall : ''}
            </span>
            {row.status !== 'cancelled' ? (
              <Button type="button" variant="secondary" disabled={busy} onClick={() => void save({}, row.id)}>
                Отменить
              </Button>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
