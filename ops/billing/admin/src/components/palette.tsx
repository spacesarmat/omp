import { Command } from 'cmdk';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

const PAGES: { id: string; label: string }[] = [
  ['home', 'Обзор'],
  ['users', 'Пользователи'],
  ['subs', 'Подписки и оплаты'],
  ['devices', 'Устройства'],
  ['sources', 'Источники поиска'],
  ['rank', 'Подбор раздач'],
  ['cache', 'Кэш'],
  ['funnel', 'Воронка'],
  ['revenue', 'Выручка'],
  ['nuc', 'NUC'],
  ['support', 'Поддержка'],
  ['promos', 'Промо'],
  ['fails', 'Отказы'],
  ['audit', 'Журнал'],
  ['ads', 'Реклама'],
  ['services', 'Сервисы'],
  ['dht', 'DHT'],
  ['monitor', 'Мониторинг'],
  ['changes', 'Изменения'],
  ['settings', 'Настройки'],
  ['security', 'Доступ'],
].map(([id, label]) => ({ id, label }));

type Hit = { kind: string; id: string; title: string; href: string };

export function Palette({ open, onOpen, go }: { open: boolean; onOpen: (v: boolean) => void; go: (tab: string) => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onOpen(!open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpen]);

  useEffect(() => {
    if (!open || q.trim().length < 2) {
      setHits([]);
      return;
    }
    let stop = false;
    const timer = window.setTimeout(() => {
      void api<{ hits?: Hit[] }>('/admin/api/search?q=' + encodeURIComponent(q.trim())).then((res) => {
        if (!stop) setHits(res.hits || []);
      });
    }, 180);
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [q, open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[12vh]" onClick={() => onOpen(false)}>
      <div className="w-full max-w-xl rounded-lg border border-border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <Command label="Поиск" shouldFilter={false}>
          <Command.Input value={q} onValueChange={setQ} placeholder="Аккаунт, устройство, платёж, раздача" autoFocus />
          <Command.List className="max-h-80 overflow-auto p-2">
            <Command.Empty className="px-2 py-3 text-sm text-muted-foreground">Ничего не найдено</Command.Empty>
            <Command.Group heading="Экраны">
              {PAGES.filter((p) => !q.trim() || p.label.toLowerCase().indexOf(q.trim().toLowerCase()) >= 0).map((p) => (
                <Command.Item
                  key={p.id}
                  value={p.label}
                  onSelect={() => {
                    go(p.id);
                    onOpen(false);
                  }}
                >
                  {p.label}
                </Command.Item>
              ))}
            </Command.Group>
            {hits.length ? (
              <Command.Group heading="Данные">
                {hits.map((h) => (
                  <Command.Item
                    key={h.kind + h.id}
                    value={h.kind + ' ' + h.title}
                    onSelect={() => {
                      if (h.href.indexOf('tab=') >= 0) {
                        const tab = new URL(h.href, location.origin).searchParams.get('tab');
                        if (tab) go(tab);
                      }
                      if (h.href.indexOf('id=') >= 0) location.href = h.href;
                      onOpen(false);
                    }}
                  >
                    <span className="mr-2 text-xs uppercase text-muted-foreground">{h.kind}</span>
                    {h.title}
                  </Command.Item>
                ))}
              </Command.Group>
            ) : null}
          </Command.List>
        </Command>
      </div>
    </div>
  );
}

export const NAV = [
  { title: 'Обзор', items: [['home', 'Обзор'], ['users', 'Пользователи'], ['subs', 'Подписки и оплаты'], ['devices', 'Устройства']] },
  { title: 'Сеть', items: [['sources', 'Источники'], ['rank', 'Подбор'], ['cache', 'Кэш'], ['nuc', 'NUC']] },
  { title: 'Деньги', items: [['funnel', 'Воронка'], ['revenue', 'Выручка'], ['finance', 'Финансы'], ['promos', 'Промо']] },
  { title: 'Работа', items: [['support', 'Поддержка'], ['fails', 'Отказы'], ['ads', 'Реклама'], ['services', 'Сервисы'], ['dht', 'DHT'], ['monitor', 'Мониторинг'], ['changes', 'Изменения']] },
  { title: 'Система', items: [['settings', 'Настройки'], ['audit', 'Журнал'], ['security', 'Доступ']] },
];
