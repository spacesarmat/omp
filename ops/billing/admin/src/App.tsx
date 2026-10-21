import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alerts, Brand, FlashBox, LoadingScreen, Toast, toast } from '@/components/chrome';
import { post, api, type PostResult } from '@/lib/api';
import { Login } from '@/panels/Login';
import { SupportPanel } from '@/panels/SupportPanel';
import { UserCard } from '@/panels/UserCard';
import { PendingPayments } from '@/panels/DeviceAdmin';
import { ChangelogPanel } from '@/panels/ChangelogPanel';
import { MonitorPanel } from '@/panels/MonitorPanel';
import { AuditPanel, FailsPanel, FinancePanel, HomeFeed, IssueCard, PromoCard, SecurityCard, ServicesCard, SettingsCard, SubsPanel } from '@/panels/sections';
import type { HomeData, UserData } from '@/lib/types';

function AlertsPanel({ alerts }: { alerts?: { level: string; text: string; accountId?: string }[] }) {
  const list = alerts || [];
  return (
    <Card id="alerts">
      <CardHeader>
        <CardTitle>
          Предупреждения{' '}
          {list.length > 0 ? (
            <Badge variant="count" className="ml-2 align-middle">
              {list.length}
            </Badge>
          ) : null}
        </CardTitle>
      </CardHeader>
      {list.length === 0 ? (
        <CardContent className="text-sm text-muted-foreground">Алертов нет</CardContent>
      ) : (
        <CardContent className="space-y-2">
          {list.map((a, i) => (
            <Alerts key={i} a={a} />
          ))}
        </CardContent>
      )}
    </Card>
  );
}

export function App() {
  const [auth, setAuth] = useState<boolean | null>(null);
  const [data, setData] = useState<HomeData | null>(null);
  const [user, setUser] = useState<UserData | null>(null);
  const params = useMemo(() => new URLSearchParams(location.search), []);
  const [tab, setTab] = useState(() => params.get('tab') || 'home');
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const supportTg = params.get('tg') || '';

  async function reload() {
    const id = new URLSearchParams(location.search).get('id');
    if (id) {
      const u = await api<UserData & { error?: string }>('/admin/api/user?id=' + encodeURIComponent(id));
      if (u.auth === false) {
        setAuth(false);
        return;
      }
      if (u.error) {
        setUser(null);
        setAuth(true);
        const home = await api<HomeData>('/admin/api/home');
        setData(home);
        return;
      }
      setUser(u);
      setAuth(true);
      return;
    }
    const home = await api<HomeData>('/admin/api/home');
    if (home.auth === false) {
      setAuth(false);
      return;
    }
    setData(home);
    setUser(null);
    setAuth(true);
  }

  useEffect(() => {
    void reload();
  }, []);

  useEffect(() => {
    if (auth !== true || tab !== 'support' || user) return;
    let stop = false;
    const timer = window.setInterval(() => {
      void api<HomeData>('/admin/api/home').then((home) => {
        if (stop) return;
        if (home.auth === false) {
          setAuth(false);
          return;
        }
        setData((prev) => (prev ? { ...prev, support: home.support || [] } : prev));
      });
    }, 3000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [auth, tab, user]);

  async function run(path: string, fields: Record<string, unknown> = {}): Promise<PostResult | undefined> {
    const csrf = user?.csrf || data?.csrf || '';
    const res = await post(path, csrf, fields);
    if (res.auth === false) {
      setAuth(false);
      return res;
    }
    if (path === '/admin/logout') {
      location.href = '/admin/';
      return res;
    }
    if (res.redirect) {
      const url = new URL(res.redirect, location.origin);
      const nextId = url.searchParams.get('id') || '';
      const curId = new URLSearchParams(location.search).get('id') || '';
      if (nextId !== curId) {
        location.href = res.redirect;
        return res;
      }
    }
    await reload();
    if (res.flash?.error) toast(res.flash.error);
    else if (res.flash?.text) toast(res.flash.text);
    else if (res.flash?.promo) toast('Промокод создан');
    return res;
  }

  if (auth === null) return <LoadingScreen />;
  if (auth === false) return <Login />;
  if (user) {
    return (
      <>
        <UserCard user={user} run={run} />
        <Toast />
      </>
    );
  }

  const d = data || ({} as HomeData);

  return (
    <main className="mx-auto w-full max-w-[1200px] space-y-4 px-4 py-6 lg:px-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <Brand />
        <Button variant="secondary" onClick={() => void run('/admin/logout')}>
          Выйти
        </Button>
      </header>
      <FlashBox flash={d.flash} />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="w-full">
          <TabsTrigger value="home">
            Главная
            {(d.alerts || []).length > 0 ? (
              <Badge variant="count" className="ml-2">
                {(d.alerts || []).length}
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="support">
            Поддержка
            {(d.support || []).length > 0 ? (
              <Badge variant="count" className="ml-2">
                {(d.support || []).length}
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="subs">Подписки</TabsTrigger>
          <TabsTrigger value="finance">Финансы</TabsTrigger>
          <TabsTrigger value="promos">Промо</TabsTrigger>
          <TabsTrigger value="fails">Отказы</TabsTrigger>
          <TabsTrigger value="audit">Журнал</TabsTrigger>
          <TabsTrigger value="services">Сервисы</TabsTrigger>
          <TabsTrigger value="monitor">Мониторинг</TabsTrigger>
          <TabsTrigger value="changes">Изменения</TabsTrigger>
          <TabsTrigger value="settings">Настройки</TabsTrigger>
          <TabsTrigger value="security">Доступ</TabsTrigger>
        </TabsList>

        <TabsContent value="support">
          <SupportPanel csrf={d.csrf} threads={d.support || []} onSent={() => void reload()} initialTelegramId={supportTg} />
        </TabsContent>

        <TabsContent value="home" className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            {(
              [
                [d.stats?.accounts ?? 0, 'аккаунтов'],
                [d.stats?.activeSubs ?? 0, 'активных'],
                [d.stats?.payments30 ?? 0, 'оплат / 30 дн.'],
                [Math.round(d.stats?.revenue30 || 0), '₽ / 30 дн.'],
                [d.stats?.devicesRefresh == null ? '-' : d.stats.devicesRefresh, 'новые токены'],
                [d.stats?.devicesLegacy == null ? '-' : d.stats.devicesLegacy, 'старые токены'],
              ] as const
            ).map(([v, l]) => (
              <Card key={l}>
                <CardContent className="pt-4">
                  <div className="text-2xl font-bold">{v}</div>
                  <div className="text-xs text-muted-foreground">{l}</div>
                </CardContent>
              </Card>
            ))}
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Найти</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                className="flex flex-col gap-2 sm:flex-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run('/admin/find', { q });
                }}
              >
                <Input placeholder="Telegram / почта / код / идентификатор" value={q} onChange={(e) => setQ(e.target.value)} />
                <Button type="submit">Найти</Button>
              </form>
            </CardContent>
          </Card>
          <AlertsPanel alerts={d.alerts} />
          <Card>
            <CardHeader>
              <CardTitle>Быстрое промо</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button onClick={() => void run('/admin/promo', { days: 1, maxUses: 1 })}>1 день × 1</Button>
              <Button variant="secondary" onClick={() => void run('/admin/promo', { days: 7, maxUses: 10 })}>
                7 дней × 10
              </Button>
              <Button variant="secondary" onClick={() => void run('/admin/promo', { days: 30, maxUses: 1 })}>
                30 дней × 1
              </Button>
            </CardContent>
          </Card>
          <IssueCard run={run} />
          <HomeFeed events={d.events || []} />
        </TabsContent>

        <TabsContent value="subs">
          <SubsPanel subs={d.subscriptions || []} filter={filter} setFilter={setFilter} csrf={d.csrf || ''} />
        </TabsContent>
        <TabsContent value="finance" className="space-y-4">
          <PendingPayments rows={d.pending || []} run={run} showWho />
          <FinancePanel home={d} />
        </TabsContent>
        <TabsContent value="promos">
          <PromoCard run={run} promos={d.promos || []} />
        </TabsContent>
        <TabsContent value="fails">
          <FailsPanel />
        </TabsContent>
        <TabsContent value="audit">
          <AuditPanel />
        </TabsContent>
        <TabsContent value="changes">
          <ChangelogPanel />
        </TabsContent>
        <TabsContent value="settings">
          <SettingsCard run={run} settings={d.settings || {}} storage={d.storage} backup={d.backup} secrets={d.secrets} />
        </TabsContent>
        <TabsContent value="services">
          <ServicesCard csrf={d.csrf || ''} settings={d.settings || {}} secrets={d.secrets} onSaved={() => void reload()} />
        </TabsContent>
        <TabsContent value="monitor">
          <MonitorPanel csrf={d.csrf || ''} />
        </TabsContent>
        <TabsContent value="security">
          <SecurityCard run={run} sessions={d.sessions || []} sessionId={d.sessionId || ''} />
        </TabsContent>
      </Tabs>
      <Toast />
    </main>
  );
}
