import { useEffect, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/chrome';
import { Stamp } from '@/components/stamp';
import { api } from '@/lib/api';
import {
  CHANGELOG_FILTERS,
  filterChangelog,
  PLATFORM_LABEL,
  sectionTitle,
  type ChangelogFilter,
  type ChangelogPayload,
} from '@/lib/changelog';

const selectClass = 'h-10 rounded-md border border-input bg-secondary px-3 text-sm text-foreground';
const PAGE = 12;

/** The full changelog with the «[tech]» bullets users never see (app, release, Telegram). Read only. */
export function ChangelogPanel() {
  const [data, setData] = useState<ChangelogPayload | null>(null);
  const [lang, setLang] = useState<'ru' | 'en'>('ru');
  const [filter, setFilter] = useState<ChangelogFilter>('all');
  const [betas, setBetas] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [err, setErr] = useState('');

  useEffect(() => {
    let stop = false;
    api<ChangelogPayload>('/admin/api/changelog')
      .then((r) => {
        if (stop) return;
        if (r.auth === false) {
          setErr('Нужен вход');
          return;
        }
        setData(r);
      })
      .catch((e) => {
        if (!stop) setErr(e instanceof Error ? e.message : 'Не удалось загрузить');
      });
    return () => {
      stop = true;
    };
  }, []);

  const source = data ? (lang === 'en' && (data.en || []).length ? data.en || [] : data.ru || []) : [];
  const list = filterChangelog(source, filter, betas);
  const techTotal = source.reduce((n, s) => n + s.items.filter((i) => i.tech).length, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Изменения</CardTitle>
        <CardDescription>
          Полный CHANGELOG из main на GitHub. Пункты <code>[tech]</code> видны только здесь: в приложении, релизе и Telegram их нет.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <select className={selectClass} value={filter} aria-label="Какие пункты" onChange={(e) => setFilter(e.target.value as ChangelogFilter)}>
            {CHANGELOG_FILTERS.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
          <div className="flex gap-1" role="group" aria-label="Язык">
            <Button size="sm" variant={lang === 'ru' ? 'default' : 'secondary'} onClick={() => setLang('ru')}>
              RU
            </Button>
            <Button size="sm" variant={lang === 'en' ? 'default' : 'secondary'} onClick={() => setLang('en')} disabled={!data || !(data.en || []).length}>
              EN
            </Button>
          </div>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" checked={betas} onChange={(e) => setBetas(e.target.checked)} />
            Бета-версии
          </label>
          {data?.ok ? (
            <span className="ml-auto text-xs text-muted-foreground">
              {techTotal} тех. пунктов · загружено <Stamp ms={lang === 'en' ? data.enFetchedAt : data.fetchedAt} />
            </span>
          ) : null}
        </div>
        {err ? <Alert variant="destructive">{err}</Alert> : null}
        {data && !data.ok ? <Alert variant="destructive">GitHub не ответил{data.error ? ': ' + data.error : ''}. Попробуйте позже.</Alert> : null}
        {data?.ok && data.stale ? (
          <Alert variant="warn">
            Показана сохранённая копия: GitHub не ответил{data.error ? ' (' + data.error + ')' : ''}.
          </Alert>
        ) : null}
        {data?.ok && lang === 'en' && data.enStale ? (
          <Alert variant="warn">
            Английский текст из сохранённой копии{data.enFetchedAt ? '' : ' (не загружался)'}: CHANGELOG.en.md не ответил{data.enError ? ' (' + data.enError + ')' : ''}.
          </Alert>
        ) : null}
        {data === null && !err ? (
          <Skeleton className="h-24" />
        ) : data?.ok && list.length === 0 ? (
          <p className="text-sm text-muted-foreground">Пунктов нет</p>
        ) : (
          <div className="space-y-4">
            {list.slice(0, shown).map((s) => (
              <section key={s.version} className="space-y-2">
                <h3 className="flex flex-wrap items-center gap-2 text-base font-semibold">
                  {sectionTitle(s)}
                  {s.unreleased ? <Badge variant="warn">не в релизе</Badge> : null}
                  {s.beta ? <Badge variant="secondary">бета</Badge> : null}
                </h3>
                <ul className="space-y-1 text-sm">
                  {s.items.map((i, k) => (
                    <li
                      key={k}
                      className={
                        'flex items-start gap-2 rounded-md px-2 py-1 ' +
                        (i.tech ? 'border-l-2 border-amber-500 bg-amber-950/30' : 'border-l-2 border-transparent')
                      }
                    >
                      {i.tech ? <Badge variant="warn" className="shrink-0">tech</Badge> : null}
                      {i.platform ? (
                        <Badge variant="secondary" className="shrink-0">
                          {PLATFORM_LABEL[i.platform] || i.platform}
                        </Badge>
                      ) : null}
                      <span className={'min-w-0 flex-1 ' + (i.tech ? 'text-amber-100' : '')}>{i.text}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            {list.length > shown ? (
              <Button variant="secondary" onClick={() => setShown((n) => n + PAGE)}>
                Показать ещё ({list.length - shown})
              </Button>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
