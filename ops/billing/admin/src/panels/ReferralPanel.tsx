import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { post, type PostResult } from '@/lib/api';

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

/**
 * Six switches, each with its own number. The master flag is separate and starts off.
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
    try {
      const body = { settings: next, ...(cancelId ? { cancelId } : {}) };
      const res = run ? await run(body) : await post('/admin/referral', csrf, body);
      if (!res || res.auth === false || res.ok === false || res.flash?.error) {
        setError((res && res.flash && res.flash.error) || 'Не сохранилось');
        return;
      }
      setLocal(next);
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
  return (
    <Card>
      <CardHeader>
        <CardTitle>Реферальная программа</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button type="button" variant={local.enabled ? 'default' : 'secondary'} disabled={busy} onClick={() => toggle('enabled')}>
          {local.enabled ? 'Программа включена' : 'Программа выключена'}
        </Button>
        <Label>Дни рефереру (макс. 14)</Label>
        <Input defaultValue={String(local.referrerDays ?? 0)} onBlur={(e) => void save({ referrerDays: Number(e.target.value) })} />
        <Label>Бонусные дни другу (макс. 14)</Label>
        <Input defaultValue={String(local.friendDays ?? 0)} onBlur={(e) => void save({ friendDays: Number(e.target.value) })} />
        <Label>Процент на баланс</Label>
        <Input defaultValue={String(local.balancePercent ?? 0)} onBlur={(e) => void save({ balancePercent: Number(e.target.value) })} />
        <Button type="button" variant={local.tiers ? 'default' : 'secondary'} disabled={busy} onClick={() => toggle('tiers')}>Уровни 3/5/10</Button>
        <Button type="button" variant={local.friendDiscount ? 'default' : 'secondary'} disabled={busy} onClick={() => toggle('friendDiscount')}>Скидка другу</Button>
        <Button type="button" variant={local.retention ? 'default' : 'secondary'} disabled={busy} onClick={() => toggle('retention')}>Бонус удержания</Button>
        <p className="text-sm text-muted-foreground">Начисление через {local.delayDays ?? 7} дн. после оплаты. Годовой лимит {local.yearlyCap ?? 12} мес. Только при активной подписке реферера и оплате друга.</p>
        <h3 className="font-semibold">Журнал</h3>
        {rows.length === 0 ? <p className="text-sm">Начислений нет</p> : rows.map((row) => (
          <div key={row.id} className="flex items-center gap-2 text-sm">
            <span>{row.friendId || row.id} · {row.status} · {row.days} дн.</span>
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
