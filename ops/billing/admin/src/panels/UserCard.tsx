import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { CopyBtn, FlashBox, SubStatus, toast } from '@/components/chrome';
import { api, type PostResult } from '@/lib/api';
import { personLabel, problemKind, when } from '@/lib/text';
import type { UserData } from '@/lib/types';

const DAY_KEY = 'omp-grant-days';

export function UserCard({
  user,
  run,
}: {
  user: UserData;
  run: (path: string, fields?: Record<string, unknown>) => Promise<PostResult | undefined>;
}) {
  const tg = user.account.telegramId || '';
  const [msg, setMsg] = useState('');
  const [grantDays, setGrantDays] = useState(() => sessionStorage.getItem(DAY_KEY) || '30');
  const [notify, setNotify] = useState(true);
  const [shown, setShown] = useState<Record<string, { formatted: string; openUrl?: string }>>({});

  async function reveal(codeId: string) {
    const r = await api<{ formatted?: string; openUrl?: string; error?: string; auth?: boolean }>(
      '/admin/api/reveal?codeId=' + encodeURIComponent(codeId),
    );
    if (r.auth === false) return;
    if (!r.formatted) {
      toast('Код уже привязан или скрыт');
      return;
    }
    setShown((prev) => ({ ...prev, [codeId]: { formatted: r.formatted || '', openUrl: r.openUrl } }));
  }

  const active = !!user.subscription?.active;
  const until = user.subscription?.paidUntil || 0;
  const expiring = active && until > 0 && until - Date.now() <= 24 * 60 * 60 * 1000;
  const status = !user.subscription ? '' : !active ? 'expired' : expiring ? 'expiring' : 'active';

  return (
    <main className="mx-auto w-full max-w-4xl space-y-4 px-4 py-6">
      <Button variant="link" className="px-0" asChild>
        <a href="/admin/">← Назад</a>
      </Button>
      <h1 className="text-2xl font-bold">Пользователь</h1>
      <FlashBox flash={user.flash} />
      <Card>
        <CardContent className="space-y-2 pt-6 text-sm">
          <p>
            <span className="text-muted-foreground">Идентификатор</span> {user.account.id} <CopyBtn value={user.account.id} />
          </p>
          <p>
            <span className="text-muted-foreground">Telegram</span>{' '}
            {tg ? (
              <>
                <Badge variant="ok">{personLabel(tg, user.account.telegramUsername, user.account.telegramName)}</Badge>{' '}
                <CopyBtn value={tg} />
              </>
            ) : (
              '—'
            )}
          </p>
          <p>
            <span className="text-muted-foreground">Почта</span> {user.account.email || '—'}
          </p>
          <p>
            <span className="text-muted-foreground">Создан</span> {user.account.createdText}
          </p>
          {user.subscription ? (
            <p className="flex flex-wrap items-center gap-2">
              Подписка до <b>{user.subscription.paidUntilText}</b>
              <span className="text-muted-foreground">устройств {user.subscription.deviceLimit}</span>
              <SubStatus status={status} />
            </p>
          ) : (
            <p className="text-muted-foreground">Нет подписки</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Написать пользователю</CardTitle>
          <CardDescription>
            {tg ? 'Сообщение уйдёт в Telegram-бота и появится во вкладке «Поддержка».' : 'У аккаунта нет Telegram — сначала нужна привязка в боте.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {tg ? (
            <>
              <Textarea value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Текст сообщения…" rows={4} />
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={!msg.trim()}
                  onClick={() => {
                    const text = msg.trim();
                    if (!text) return;
                    void run('/admin/message', { accountId: user.account.id, text }).then(() => setMsg(''));
                  }}
                >
                  Отправить в Telegram
                </Button>
                <Button variant="secondary" asChild>
                  <a href={'/admin/?tab=support&tg=' + encodeURIComponent(tg)}>Открыть в поддержке</a>
                </Button>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Привяжите Telegram в боте или через приложение OMP.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Выдать дни</CardTitle>
          <CardDescription>Число дней сохраняется. Перед отправкой будет подтверждение.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm text-muted-foreground" htmlFor="grant-days">
              Дней
            </label>
            <select
              id="grant-days"
              className="h-10 rounded-md border border-input bg-secondary px-3 text-sm"
              value={grantDays}
              onChange={(e) => {
                setGrantDays(e.target.value);
                sessionStorage.setItem(DAY_KEY, e.target.value);
              }}
            >
              <option value="1">1</option>
              <option value="7">7</option>
              <option value="30">30</option>
              <option value="90">90</option>
            </select>
            <Button
              onClick={() => {
                const note = notify ? ' Пользователь получит сообщение в Telegram.' : ' Без сообщения в Telegram.';
                if (!window.confirm('Выдать +' + grantDays + ' дн.?' + note)) return;
                sessionStorage.setItem(DAY_KEY, grantDays);
                void run('/admin/grant', { accountId: user.account.id, days: grantDays, notify });
              }}
            >
              Выдать
            </Button>
          </div>
          <label className="flex items-center gap-2 rounded-md border border-amber-700/60 bg-amber-950/40 px-3 py-2 text-sm text-amber-100">
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
            Уведомить пользователя в Telegram
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Коды</CardTitle>
          <CardDescription>Непривязанный код открывается кнопкой «Показать». После привязки к устройству код стирается.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {(user.codes || []).length === 0 ? <p className="text-muted-foreground">Нет кодов</p> : null}
          {(user.codes || []).map((c) => {
            const open = shown[c.id];
            return (
              <div key={c.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-mono">{open?.formatted || (c.bound ? 'привязан · ' + (c.deviceId || '') : 'скрыт')}</span>
                {c.bound && !c.hasPlain && !open ? <span className="text-muted-foreground">код стёрт после привязки</span> : null}
                {open ? <CopyBtn value={open.formatted} /> : null}
                {c.hasPlain && !open ? (
                  <Button size="sm" variant="secondary" onClick={() => void reveal(c.id)}>
                    Показать
                  </Button>
                ) : null}
                {open?.openUrl ? (
                  <Button size="sm" variant="link" asChild>
                    <a href={open.openUrl} target="_blank" rel="noreferrer">
                      Открыть
                    </a>
                  </Button>
                ) : null}
                {c.bound ? (
                  <Button size="sm" variant="secondary" onClick={() => void run('/admin/unbind', { codeId: c.id, accountId: user.account.id })}>
                    Сбросить
                  </Button>
                ) : null}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Платежи</CardTitle>
        </CardHeader>
        <CardContent>
          {(user.payments || []).length === 0 ? <p className="text-sm text-muted-foreground">Нет платежей</p> : null}
          {(user.payments || []).length > 0 ? (
            <Table className="min-w-[36rem]">
              <TableHeader>
                <TableRow>
                  <TableHead>Когда</TableHead>
                  <TableHead>Сумма</TableHead>
                  <TableHead>Метка</TableHead>
                  <TableHead>Ошибка</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(user.payments || []).map((p, i) => (
                  <TableRow key={i}>
                    <TableCell>{p.at ? when(p.at) : '—'}</TableCell>
                    <TableCell>{p.amount || '—'}</TableCell>
                    <TableCell className="font-mono text-xs">{p.label || '—'}</TableCell>
                    <TableCell>{p.error ? <Badge variant="bad">{problemKind(p.error)}</Badge> : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}
