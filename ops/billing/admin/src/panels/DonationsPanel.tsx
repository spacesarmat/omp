import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, type PostResult } from '@/lib/api';

type Settings = {
  enabled?: boolean;
  amounts?: string;
  minRub?: number;
  maxRub?: number;
  commentMax?: number;
  thanksText?: string;
  yoomoney?: boolean;
  stars?: boolean;
  crypto?: boolean;
  rubPerStar?: number;
  notifyAll?: boolean;
  notifyMin?: number;
  showAmounts?: boolean;
};

type Row = {
  id: string;
  atText: string;
  who: string;
  telegramId: string;
  amountRub: number;
  method: string;
  comment: string;
  commentHidden: boolean;
  nameHidden: boolean;
  status: string;
};

type Report = {
  rows?: Row[];
  summary?: {
    day: { sum: number; count: number; average: number };
    week: { sum: number; count: number; average: number };
    month: { sum: number; count: number; average: number };
  };
  chart?: { day: string; rub: number }[];
  top?: { who: string; sum: number; count: number }[];
};

const STATUS: Record<string, string> = { paid: 'оплачен', pending: 'ждёт', refunded: 'возврат', draft: 'черновик', cancelled: 'отменён' };

function money(n: number) {
  return String(n) + ' ₽';
}

export function DonationsPanel({
  settings,
  report,
  run,
}: {
  settings?: Settings;
  report?: Report;
  run: (path: string, fields: Record<string, unknown>) => Promise<PostResult | undefined>;
}) {
  const src = settings || {};
  const [enabled, setEnabled] = useState(src.enabled === true);
  const [yoomoney, setYoomoney] = useState(src.yoomoney === true);
  const [stars, setStars] = useState(src.stars === true);
  const [crypto, setCrypto] = useState(src.crypto === true);
  const [notifyAll, setNotifyAll] = useState(src.notifyAll === true);
  const [showAmounts, setShowAmounts] = useState(src.showAmounts === true);
  const [amounts, setAmounts] = useState(src.amounts || '100,300,500,1000');
  const [minRub, setMinRub] = useState(String(src.minRub ?? 50));
  const [maxRub, setMaxRub] = useState(String(src.maxRub ?? 100000));
  const [commentMax, setCommentMax] = useState(String(src.commentMax ?? 200));
  const [thanksText, setThanksText] = useState(src.thanksText || 'Спасибо! Вы поддержали проект OMP.');
  const [rubPerStar, setRubPerStar] = useState(String(src.rubPerStar ?? 0));
  const [notifyMin, setNotifyMin] = useState(String(src.notifyMin ?? 0));
  const [filtered, setFiltered] = useState<Row[] | null>(null);
  const [status, setStatus] = useState('all');
  const [method, setMethod] = useState('all');
  const rows = filtered ?? report?.rows ?? [];
  const summary = report?.summary;
  const chart = report?.chart || [];
  const top = report?.top || [];

  async function reload(nextStatus = status, nextMethod = method) {
    if (nextStatus === 'all' && nextMethod === 'all') {
      setFiltered(null);
      return;
    }
    const q = new URLSearchParams();
    if (nextStatus !== 'all') q.set('status', nextStatus);
    if (nextMethod !== 'all') q.set('method', nextMethod);
    const data = await api<Report>('/admin/api/donations?' + q.toString());
    if (data.auth === false) return;
    setFiltered(data.rows || []);
  }

  const max = Math.max(1, ...chart.map((r) => r.rub));
  const boxes: [string, { sum: number; count: number; average: number } | undefined][] = [
    ['День', summary?.day],
    ['Неделя', summary?.week],
    ['Месяц', summary?.month],
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Донаты</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Принимать донаты
          </label>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={yoomoney} onChange={(e) => setYoomoney(e.target.checked)} /> ЮMoney</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={stars} onChange={(e) => setStars(e.target.checked)} /> Telegram Stars</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={crypto} onChange={(e) => setCrypto(e.target.checked)} /> Crypto Pay</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={notifyAll} onChange={(e) => setNotifyAll(e.target.checked)} /> Уведомлять о каждом</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={showAmounts} onChange={(e) => setShowAmounts(e.target.checked)} /> Суммы в списке благодарностей</label>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Кнопки сумм" value={amounts} onChange={setAmounts} />
            <Field label="Минимум, ₽" value={minRub} onChange={setMinRub} />
            <Field label="Максимум, ₽" value={maxRub} onChange={setMaxRub} />
            <Field label="Комментарий, символов" value={commentMax} onChange={setCommentMax} />
            <Field label="₽ за 1 звезду" value={rubPerStar} onChange={setRubPerStar} />
            <Field label="Порог уведомления, ₽" value={notifyMin} onChange={setNotifyMin} />
          </div>
          <div>
            <Label>Текст благодарности</Label>
            <Input value={thanksText} onChange={(e) => setThanksText(e.target.value)} />
          </div>
          <Button
            type="button"
            onClick={() =>
              void run('/admin/donate', {
                enabled: enabled ? 'true' : 'false',
                yoomoney: yoomoney ? 'true' : 'false',
                stars: stars ? 'true' : 'false',
                crypto: crypto ? 'true' : 'false',
                notifyAll: notifyAll ? 'true' : 'false',
                showAmounts: showAmounts ? 'true' : 'false',
                amounts,
                minRub,
                maxRub,
                commentMax,
                thanksText,
                rubPerStar,
                notifyMin,
              })
            }
          >
            Сохранить
          </Button>
          <p className="text-xs text-muted-foreground">Пока флаг выключен, бот отвечает, что донат недоступен. Донат не продлевает подписку. Секреты ЮMoney, Stars и Crypto Pay берутся из тех же настроек оплаты.</p>
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-3">
        {boxes.map(([label, row]) => (
          <Card key={label}>
            <CardHeader><CardTitle>{label}</CardTitle></CardHeader>
            <CardContent className="text-sm">
              <div>{money(row?.sum || 0)}</div>
              <div className="text-muted-foreground">{row?.count || 0} донатов, средний чек {money(row?.average || 0)}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle>30 дней, МСК</CardTitle></CardHeader>
        <CardContent>
          <div className="flex h-36 items-end gap-px overflow-x-auto">
            {chart.map((r) => (
              <div key={r.day} title={r.day + ': ' + r.rub} className="flex h-full min-w-[6px] flex-1 flex-col justify-end">
                <div className="w-full rounded-sm bg-[#f5b700]" style={{ height: Math.max(2, Math.round((r.rub / max) * 128)) + 'px' }} />
              </div>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-xs text-muted-foreground">
            <span>{chart[0]?.day || ''}</span>
            <span>{chart[chart.length - 1]?.day || ''}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Топ</CardTitle></CardHeader>
        <CardContent className="text-sm">
          {top.length ? top.map((row) => <div key={row.who + row.sum}>{row.who}: {money(row.sum)} ({row.count})</div>) : <div className="text-muted-foreground">Пока нет оплаченных донатов</div>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Лента</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <select className="rounded-md border bg-background px-2 py-1 text-sm" value={status} onChange={(e) => { setStatus(e.target.value); void reload(e.target.value, method); }}>
              <option value="all">все статусы</option>
              <option value="paid">оплачен</option>
              <option value="pending">ждёт</option>
              <option value="refunded">возврат</option>
            </select>
            <select className="rounded-md border bg-background px-2 py-1 text-sm" value={method} onChange={(e) => { setMethod(e.target.value); void reload(status, e.target.value); }}>
              <option value="all">все способы</option>
              <option value="yoomoney">ЮMoney</option>
              <option value="stars">Stars</option>
              <option value="crypto">Crypto Pay</option>
            </select>
            <a className="text-sm text-primary" href={'/admin/donations.csv' + (status !== 'all' || method !== 'all' ? '?' + new URLSearchParams({ ...(status !== 'all' ? { status } : {}), ...(method !== 'all' ? { method } : {}) }).toString() : '')}>CSV</a>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="py-1 pr-2">Время</th>
                  <th className="py-1 pr-2">Кто</th>
                  <th className="py-1 pr-2">Сумма</th>
                  <th className="py-1 pr-2">Способ</th>
                  <th className="py-1 pr-2">Комментарий</th>
                  <th className="py-1 pr-2">Статус</th>
                  <th className="py-1">Действия</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-border">
                    <td className="py-1 pr-2 whitespace-nowrap">{row.atText}</td>
                    <td className="py-1 pr-2">{row.nameHidden ? 'имя скрыто' : row.who || row.telegramId}</td>
                    <td className="py-1 pr-2">{money(row.amountRub)}</td>
                    <td className="py-1 pr-2">{row.method}</td>
                    <td className="py-1 pr-2">{row.commentHidden ? 'скрыт' : row.comment}</td>
                    <td className="py-1 pr-2">{STATUS[row.status] || row.status}</td>
                    <td className="py-1 space-x-2 whitespace-nowrap">
                      {row.status === 'paid' ? (
                        <button type="button" className="text-primary" onClick={() => { if (window.confirm('Отметить возврат? Деньги этой кнопкой не уходят.')) void run('/admin/donate/refund', { id: row.id, confirm: 'yes' }).then(() => reload()); }}>Возврат</button>
                      ) : null}
                      <button type="button" className="text-primary" onClick={() => void run('/admin/donate/hide', { id: row.id, field: 'comment' }).then(() => reload())}>{row.commentHidden ? 'Вернуть комментарий' : 'Скрыть комментарий'}</button>
                      <button type="button" className="text-primary" onClick={() => void run('/admin/donate/hide', { id: row.id, field: 'name' }).then(() => reload())}>{row.nameHidden ? 'Вернуть имя' : 'Скрыть имя'}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length ? null : <div className="py-3 text-sm text-muted-foreground">Пусто</div>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-muted-foreground">{label}</span>
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
