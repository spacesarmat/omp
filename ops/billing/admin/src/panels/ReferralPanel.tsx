import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { post } from '@/lib/api';

type Settings = {
  enabled?: boolean;
  referrerDays?: number;
  friendDays?: number;
  balancePercent?: number;
  tiers?: boolean;
  friendDiscount?: boolean;
  retention?: boolean;
  delayDays?: number;
  yearlyCap?: number;
};

type Row = { id: string; friendId?: string; status: string; days: number; reason?: string };

/** Six switches, each with its own number. The master flag is separate and starts off. */
export function ReferralPanel({ csrf, settings, journal }: { csrf: string; settings?: Settings; journal?: Row[] }) {
  const s = settings || {};
  const [busy, setBusy] = useState(false);
  const save = (patch: Settings) => {
    setBusy(true);
    void post('/admin/referral', csrf, { settings: { ...s, ...patch } }).finally(() => setBusy(false));
  };
  const toggle = (key: keyof Settings) => save({ [key]: !s[key] } as Settings);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Реферальная программа</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button type="button" variant={s.enabled ? 'default' : 'secondary'} disabled={busy} onClick={() => toggle('enabled')}>
          {s.enabled ? 'Программа включена' : 'Программа выключена'}
        </Button>
        <Label>Дни рефереру (макс. 14)</Label>
        <Input defaultValue={String(s.referrerDays ?? 0)} onBlur={(e) => save({ referrerDays: Number(e.target.value) })} />
        <Label>Бонусные дни другу (макс. 14)</Label>
        <Input defaultValue={String(s.friendDays ?? 0)} onBlur={(e) => save({ friendDays: Number(e.target.value) })} />
        <Label>Процент на баланс</Label>
        <Input defaultValue={String(s.balancePercent ?? 0)} onBlur={(e) => save({ balancePercent: Number(e.target.value) })} />
        <Button type="button" variant={s.tiers ? 'default' : 'secondary'} disabled={busy} onClick={() => toggle('tiers')}>Уровни 3/5/10</Button>
        <Button type="button" variant={s.friendDiscount ? 'default' : 'secondary'} disabled={busy} onClick={() => toggle('friendDiscount')}>Скидка другу</Button>
        <Button type="button" variant={s.retention ? 'default' : 'secondary'} disabled={busy} onClick={() => toggle('retention')}>Бонус удержания</Button>
        <p className="text-sm text-muted-foreground">Начисление через {s.delayDays ?? 7} дн. после оплаты. Годовой лимит {s.yearlyCap ?? 12} мес. Только при активной подписке реферера и оплате друга.</p>
        <h3 className="font-semibold">Журнал</h3>
        {(journal || []).length === 0 ? <p className="text-sm">Начислений нет</p> : (journal || []).map((row) => (
          <div key={row.id} className="flex items-center gap-2 text-sm">
            <span>{row.friendId || row.id} · {row.status} · {row.days} дн.</span>
            {row.status !== 'cancelled' ? (
              <Button type="button" variant="secondary" disabled={busy} onClick={() => { setBusy(true); void post('/admin/referral', csrf, { settings: s, cancelId: row.id }).finally(() => setBusy(false)); }}>
                Отменить
              </Button>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
