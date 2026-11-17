import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, type PostResult } from '@/lib/api';
import { donateSaveFailed, formFromDonateSettings, keepOrRefreshForm, stillDirtyAfterSave, takeFilterRows, type DonateForm } from '@/lib/donateForm';
import { when } from '@/lib/text';
import type { DonateRateRow, DonateRates } from '@/lib/types';

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
  held?: boolean;
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

function sourceName(source: string) {
  if (source === 'cryptopay') return 'Crypto Pay';
  if (source === 'coingecko') return 'CoinGecko';
  if (source === 'cbr') return 'ЦБ';
  if (source === 'manual') return 'вручную';
  return source;
}

function rubRate(n: number) {
  if (!(n > 0)) return '0 ₽';
  const digits = n >= 100 ? 2 : 4;
  const text = n.toFixed(digits).replace(/0+$/, '').replace(/\.$/, '');
  return text.replace('.', ',') + ' ₽';
}

function rateStatus(row?: DonateRateRow) {
  if (!row) return 'Нет данных';
  if (!row.auto) return row.manual > 0 ? 'Сейчас вручную, ' + rubRate(row.value) : 'Вручную, курс не задан, кнопка скрыта';
  if (row.usable) return 'Сейчас ' + rubRate(row.value) + ', ' + sourceName(row.source) + (row.at ? ', ' + when(row.at) : '');
  if (row.last > 0) {
    return 'Скрыто: курс старше срока. Последний ' + rubRate(row.last) + (row.source ? ', ' + sourceName(row.source) : '') + (row.at ? ', ' + when(row.at) : '');
  }
  return 'Скрыто: свежего курса нет';
}

export function DonationsPanel({
  settings,
  rates,
  report,
  run,
}: {
  settings?: Settings;
  rates?: DonateRates;
  report?: Report;
  run: (path: string, fields: Record<string, unknown>) => Promise<PostResult | undefined>;
}) {
  const [dirty, setDirty] = useState(false);
  const [form, setForm] = useState<DonateForm>(() => formFromDonateSettings(settings, rates));
  const [filtered, setFiltered] = useState<Row[] | null>(null);
  const [status, setStatus] = useState('all');
  const [method, setMethod] = useState('all');
  const requestId = useRef(0);
  const formRef = useRef(form);
  formRef.current = form;
  const filterRef = useRef({ status, method });
  filterRef.current = { status, method };
  const rows = filtered ?? report?.rows ?? [];
  const summary = report?.summary;
  const chart = report?.chart || [];
  const top = report?.top || [];

  useEffect(() => {
    setForm((local) => keepOrRefreshForm(local, formFromDonateSettings(settings, rates), dirty));
  }, [settings, rates, dirty]);

  async function reload(nextStatus = status, nextMethod = method) {
    const mine = ++requestId.current;
    if (nextStatus === 'all' && nextMethod === 'all') {
      const taken = takeFilterRows<Row>(mine, requestId.current, null);
      if (taken !== undefined) setFiltered(taken);
      return;
    }
    const q = new URLSearchParams();
    if (nextStatus !== 'all') q.set('status', nextStatus);
    if (nextMethod !== 'all') q.set('method', nextMethod);
    const data = await api<Report>('/admin/api/donations?' + q.toString());
    if (data.auth === false) return;
    const taken = takeFilterRows<Row>(mine, requestId.current, data.rows || []);
    if (taken !== undefined) setFiltered(taken);
  }

  useEffect(() => {
    const current = filterRef.current;
    if (current.status === 'all' && current.method === 'all') return;
    void reload(current.status, current.method);
  }, [report]);

  function edit(patch: Partial<DonateForm>) {
    setDirty(true);
    setForm((prev) => ({ ...prev, ...patch }));
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
            <input type="checkbox" checked={form.enabled} onChange={(e) => edit({ enabled: e.target.checked })} />
            Принимать донаты
          </label>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.yoomoney} onChange={(e) => edit({ yoomoney: e.target.checked })} /> ЮMoney</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.stars} onChange={(e) => edit({ stars: e.target.checked })} /> Telegram Stars</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.crypto} onChange={(e) => edit({ crypto: e.target.checked })} /> Crypto Pay</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.notifyAll} onChange={(e) => edit({ notifyAll: e.target.checked })} /> Уведомлять о каждом</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.showAmounts} onChange={(e) => edit({ showAmounts: e.target.checked })} /> Суммы в списке благодарностей</label>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Кнопки сумм" value={form.amounts} onChange={(v) => edit({ amounts: v })} />
            <Field label="Минимум, ₽" value={form.minRub} onChange={(v) => edit({ minRub: v })} />
            <Field label="Максимум, ₽" value={form.maxRub} onChange={(v) => edit({ maxRub: v })} />
            <Field label="Комментарий, символов" value={form.commentMax} onChange={(v) => edit({ commentMax: v })} />
            <Field label="Порог уведомления, ₽" value={form.notifyMin} onChange={(v) => edit({ notifyMin: v })} />
          </div>
          <div className="space-y-3 rounded-md border p-3">
            <p className="text-sm">Автокурсы. Сумма доната по-прежнему в рублях. Нет свежего курса - кнопка способа скрыта.</p>
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="USD за 1 звезду" value={form.starUsd} onChange={(v) => edit({ starUsd: v })} />
              <Field label="Наценка, %" value={form.markupPercent} onChange={(v) => edit({ markupPercent: v })} />
              <Field label="Прятать курс старше, часов" value={form.maxAgeHours} onChange={(v) => edit({ maxAgeHours: v })} />
            </div>
            <p className="text-xs text-muted-foreground">
              Звезда: проект получает около 0,013 USD по условиям Telegram (вывод через Fragment). Покупка звезды пользователем ближе к 0,02. Рубли для звезды берутся из курса ЦБ, запасной - USDT/RUB. Крипта: Crypto Pay, запасной CoinGecko. Обновление примерно каждые 12 минут и перед счётом. Наценка 10 значит донор отправляет на 10% больше. Ручной курс работает, когда авто выключено.
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <RateBox title="Звёзды" auto={form.autoStar} onAuto={(v) => edit({ autoStar: v })} manual={form.rubPerStar} onManual={(v) => edit({ rubPerStar: v })} status={rateStatus(rates && rates.rows.star)} />
              <RateBox title="USDT" auto={form.autoUsdt} onAuto={(v) => edit({ autoUsdt: v })} manual={form.cryptoRateUsdt} onManual={(v) => edit({ cryptoRateUsdt: v })} status={rateStatus(rates && rates.rows.usdt)} />
              <RateBox title="TON" auto={form.autoTon} onAuto={(v) => edit({ autoTon: v })} manual={form.cryptoRateTon} onManual={(v) => edit({ cryptoRateTon: v })} status={rateStatus(rates && rates.rows.ton)} />
              <RateBox title="BTC" auto={form.autoBtc} onAuto={(v) => edit({ autoBtc: v })} manual={form.cryptoRateBtc} onManual={(v) => edit({ cryptoRateBtc: v })} status={rateStatus(rates && rates.rows.btc)} />
            </div>
          </div>
          <div>
            <Label>Текст благодарности</Label>
            <Input value={form.thanksText} onChange={(e) => edit({ thanksText: e.target.value })} />
          </div>
          <Button
            type="button"
            onClick={() => {
              const sent = form;
              void run('/admin/donate', {
                enabled: sent.enabled ? 'true' : 'false',
                yoomoney: sent.yoomoney ? 'true' : 'false',
                stars: sent.stars ? 'true' : 'false',
                crypto: sent.crypto ? 'true' : 'false',
                notifyAll: sent.notifyAll ? 'true' : 'false',
                showAmounts: sent.showAmounts ? 'true' : 'false',
                amounts: sent.amounts,
                minRub: sent.minRub,
                maxRub: sent.maxRub,
                commentMax: sent.commentMax,
                thanksText: sent.thanksText,
                rubPerStar: sent.rubPerStar,
                notifyMin: sent.notifyMin,
                rateAutoStar: sent.autoStar ? 'true' : 'false',
                rateAutoUsdt: sent.autoUsdt ? 'true' : 'false',
                rateAutoTon: sent.autoTon ? 'true' : 'false',
                rateAutoBtc: sent.autoBtc ? 'true' : 'false',
                starUsd: sent.starUsd,
                markupPercent: sent.markupPercent,
                maxAgeHours: sent.maxAgeHours,
                cryptoRateUsdt: sent.cryptoRateUsdt,
                cryptoRateTon: sent.cryptoRateTon,
                cryptoRateBtc: sent.cryptoRateBtc,
              }).then((res) => {
                setDirty(stillDirtyAfterSave(formRef.current, sent, donateSaveFailed(res)));
              });
            }}
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
                    <td className="py-1 pr-2">{row.held && row.status === 'pending' ? 'ждёт в ЮMoney' : STATUS[row.status] || row.status}</td>
                    <td className="py-1 space-x-2 whitespace-nowrap">
                      {row.held && row.status === 'pending' ? (
                        <button type="button" className="text-primary" onClick={() => { if (window.confirm('Подтвердить удержанный донат? Подписка не продлится.')) void run('/admin/donate/confirm', { id: row.id, confirm: 'yes' }).then(() => reload()); }}>Подтвердить</button>
                      ) : null}
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

function RateBox({
  title,
  auto,
  onAuto,
  manual,
  onManual,
  status,
}: {
  title: string;
  auto: boolean;
  onAuto: (v: boolean) => void;
  manual: string;
  onManual: (v: string) => void;
  status: string;
}) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{title}</span>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={auto} onChange={(e) => onAuto(e.target.checked)} />
          Авто
        </label>
      </div>
      <p className="text-xs text-muted-foreground">{status}</p>
      <Field label="Ручной, ₽ за 1" value={manual} onChange={onManual} />
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
