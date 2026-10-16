import { useEffect, useState, type FormEvent } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Brand } from '@/components/chrome';
import { api } from '@/lib/api';

export function Login() {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [tg, setTg] = useState<{ token: string; deepLink: string } | null>(null);
  const [tgStatus, setTgStatus] = useState('');

  useEffect(() => {
    if (!tg?.token) return;
    let stop = false;
    const tick = async () => {
      const res = await api<{ ok?: boolean; status?: string }>('/admin/login/telegram/status?token=' + encodeURIComponent(tg.token));
      if (stop) return;
      if (res.status === 'ok' || res.ok) {
        location.href = '/admin/';
        return;
      }
      if (res.status === 'denied') {
        setErr('Этот Telegram не входит в список администраторов');
        setTg(null);
        setTgStatus('');
        return;
      }
      if (res.status === 'expired') {
        setErr('Ссылка устарела — нажмите «Войти через Telegram» ещё раз');
        setTg(null);
        setTgStatus('');
        return;
      }
      setTgStatus('Ожидаю подтверждение в Telegram…');
    };
    void tick();
    const id = window.setInterval(() => void tick(), 2000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [tg?.token]);

  async function startTelegram() {
    setBusy(true);
    setErr('');
    setTgStatus('');
    const res = await api<{ ok?: boolean; error?: string; token?: string; deepLink?: string; status?: number }>('/admin/login/telegram', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Accept: 'application/json' },
      body: '{}',
    });
    setBusy(false);
    if (res.status === 403) {
      setErr('Панель ещё не перезапущена — сервер не знает вход через Telegram.');
      return;
    }
    if (!res.ok || !res.token || !res.deepLink) {
      setErr(res.error || 'Не удалось начать вход через Telegram');
      return;
    }
    setTg({ token: res.token, deepLink: res.deepLink });
    window.open(res.deepLink, '_blank', 'noopener,noreferrer');
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    const res = await api<{ ok?: boolean; error?: string }>('/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ password }),
    });
    setBusy(false);
    if (res.ok) location.href = '/admin/';
    else setErr(res.error || 'Неверный пароль');
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="flex justify-center">
            <Brand />
          </div>
          <p className="mt-3 text-sm text-muted-foreground">Вход для администраторов</p>
        </div>
        {err ? (
          <Alert variant="destructive" className="mb-4">
            {err}
          </Alert>
        ) : null}
        {tgStatus ? <Alert className="mb-4">{tgStatus}</Alert> : null}
        <Card>
          <CardContent className="space-y-4 pt-6">
            <Button className="w-full" disabled={busy} onClick={() => void startTelegram()}>
              {busy && !tg ? '…' : 'Войти через Telegram'}
            </Button>
            {tg?.deepLink ? (
              <p className="text-sm text-muted-foreground">
                Если бот не открылся:{' '}
                <a className="underline" href={tg.deepLink} target="_blank" rel="noreferrer">
                  открыть ссылку
                </a>
              </p>
            ) : null}
            <button type="button" className="text-sm text-muted-foreground underline" onClick={() => setShowPass((v) => !v)}>
              {showPass ? 'Скрыть пароль' : 'Войти по паролю'}
            </button>
            {showPass ? (
              <form className="space-y-4" onSubmit={(e) => void submit(e)}>
                <div className="space-y-2">
                  <Label htmlFor="password">Пароль</Label>
                  <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy ? '…' : 'Войти'}
                </Button>
              </form>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
