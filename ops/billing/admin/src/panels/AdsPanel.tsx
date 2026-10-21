import { useEffect, useRef, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton, toast } from '@/components/chrome';
import { api, post } from '@/lib/api';
import {
  AD_PLATFORM_LABEL,
  AD_SECTION_LABEL,
  ctr,
  dayInput,
  fileBase64,
  type AdBanner,
  type AdPlatform,
  type AdsConfig,
  type AdSection,
  type AdStats,
  type AdStatRow,
} from '@/lib/ads';

const selectClass = 'h-10 rounded-md border border-input bg-secondary px-3 text-sm text-foreground';
const SECTIONS: AdSection[] = ['mine', 'discoverGrid', 'discoverRails'];
const PLATFORMS: AdPlatform[] = ['phone', 'androidTv', 'webos'];
const imageUrl = (id: string) => '/v1/ads/img/' + id;

type Draft = {
  /** Which open form an in-flight upload belongs to. A new one on each open, kept across field edits. */
  localId: string;
  id?: string;
  enabled: boolean;
  title: string;
  text: string;
  advertiser: string;
  erid: string;
  url: string;
  image: string;
  weight: string;
  from: string;
  to: string;
  platforms: AdPlatform[];
  sections: AdSection[];
  tvMode: 'qr' | 'noclick';
};

function draftLocalId(): string {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

const emptyDraft = (): Draft => ({
  localId: draftLocalId(),
  enabled: true,
  title: '',
  text: '',
  advertiser: '',
  erid: '',
  url: '',
  image: '',
  weight: '1',
  from: '',
  to: '',
  platforms: ['phone', 'androidTv', 'webos'],
  sections: ['mine', 'discoverGrid', 'discoverRails'],
  tvMode: 'qr',
});

function draftOf(b: AdBanner): Draft {
  return {
    localId: draftLocalId(),
    id: b.id,
    enabled: b.enabled,
    title: b.title,
    text: b.text,
    advertiser: b.advertiser,
    erid: b.erid,
    url: b.url,
    image: b.image,
    weight: String(b.weight),
    from: dayInput(b.from),
    to: dayInput(b.to),
    platforms: b.platforms,
    sections: b.sections,
    tvMode: b.tvMode,
  };
}

function toggle<T>(list: T[], v: T, on: boolean): T[] {
  const rest = list.filter((x) => x !== v);
  return on ? rest.concat([v]) : rest;
}

export function AdsPanel({ csrf }: { csrf: string }) {
  const [cfg, setCfg] = useState<AdsConfig | null>(null);
  const [stats, setStats] = useState<AdStats | null>(null);
  const [days, setDays] = useState(30);
  const [form, setForm] = useState<AdsConfig | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // The first load fills the settings form. Later loads for another stats period must not.
  const formReady = useRef(false);

  async function load(d = days, keepForm = false) {
    const r = await api<{ config?: AdsConfig; stats?: AdStats }>('/admin/api/ads?days=' + d);
    if (r.auth === false || !r.config) return;
    setCfg(r.config);
    setStats(r.stats || null);
    if (!keepForm) setForm(r.config);
  }
  useEffect(() => {
    const keep = formReady.current;
    formReady.current = true;
    let alive = true;
    void (async () => {
      const r = await api<{ config?: AdsConfig; stats?: AdStats }>('/admin/api/ads?days=' + days);
      if (!alive || r.auth === false || !r.config) return;
      setCfg(r.config);
      setStats(r.stats || null);
      // A period change keeps whatever the admin has not saved yet. The first answer still fills an empty form.
      setForm((cur) => (keep && cur ? cur : r.config!));
    })();
    return () => {
      alive = false;
    };
  }, [days]);

  async function send(path: string, fields: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await post(path, csrf, fields);
      if (res.flash?.error) {
        setError(res.flash.error);
        toast(res.flash.error);
      } else {
        setError('');
        if (res.flash?.text) toast(res.flash.text);
      }
      return res;
    } finally {
      setBusy(false);
    }
  }

  if (!cfg || !form) return <Skeleton className="h-48" />;
  const num = (k: 'everyN' | 'firstAfter' | 'afterInstallDays' | 'maxPerScreen' | 'railsEvery', label: string, hint: string) => (
    <div className="space-y-1">
      <Label htmlFor={'ads-' + k}>{label}</Label>
      <Input id={'ads-' + k} inputMode="numeric" value={String(form[k])} onChange={(e) => setForm({ ...form, [k]: e.target.value as unknown as number })} />
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            Реклама
            {cfg.enabled ? <Badge variant="ok">включена</Badge> : <Badge variant="secondary">выключена</Badge>}
            <Badge variant="secondary">баннеров: {cfg.banners.length}</Badge>
          </CardTitle>
          <CardDescription>
            Свои баннеры (прямые рекламодатели и партнёрки). Приложения читают настройки раз в 5 минут: выключатель доходит до всех за это время.
            Подписчикам и в «Истории», поиске, режиме выбора рекламы нет.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
            Показывать рекламу (общий выключатель)
          </label>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="ads-provider">Источник</Label>
              <select id="ads-provider" className={selectClass + ' w-full'} value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value as AdsConfig['provider'] })}>
                <option value="house">Свои баннеры</option>
                <option value="yandex" disabled>
                  Яндекс (позже)
                </option>
              </select>
            </div>
            {num('everyN', 'Каждая N-я карточка', '6-30, по умолчанию 10')}
            {num('firstAfter', 'Первая не раньше карточки', '1-60, по умолчанию 10')}
            {num('afterInstallDays', 'Дней после установки', '0-60: до этого рекламы нет')}
            {num('maxPerScreen', 'На экране не больше', '1-2 рекламы')}
            {num('railsEvery', 'Главная «Обзора»: после каждых N рельс', '2-10, первая после 2-й рельсы')}
            <div className="space-y-1">
              <Label htmlFor="ads-minver">Минимальная версия приложения</Label>
              <Input id="ads-minver" placeholder="например 0.20.5" value={form.minAppVersion} onChange={(e) => setForm({ ...form, minAppVersion: e.target.value })} />
              <p className="text-xs text-muted-foreground">Пусто: все версии с рекламой</p>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <fieldset className="space-y-1">
              <legend className="mb-1 text-sm font-medium">Разделы</legend>
              {SECTIONS.map((s) => (
                <label key={s} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.sections[s]} onChange={(e) => setForm({ ...form, sections: { ...form.sections, [s]: e.target.checked } })} />
                  {AD_SECTION_LABEL[s]}
                </label>
              ))}
            </fieldset>
            <fieldset className="space-y-1">
              <legend className="mb-1 text-sm font-medium">Платформы</legend>
              {PLATFORMS.map((p) => (
                <label key={p} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.platforms[p]} onChange={(e) => setForm({ ...form, platforms: { ...form.platforms, [p]: e.target.checked } })} />
                  {AD_PLATFORM_LABEL[p]}
                </label>
              ))}
            </fieldset>
            <fieldset className="space-y-1">
              <legend className="mb-1 text-sm font-medium">Кому не показывать</legend>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.hideForSubscribers} onChange={(e) => setForm({ ...form, hideForSubscribers: e.target.checked })} />
                Подписчикам OMP (и в льготный период)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.tvHideIfLinkedSubscriber} onChange={(e) => setForm({ ...form, tvHideIfLinkedSubscriber: e.target.checked })} />
                ТВ, к которому привязан телефон с подпиской
              </label>
            </fieldset>
          </div>
          {form.enabled && !cfg.banners.some((b) => b.enabled) ? (
            <Alert variant="warn">Нет ни одного включённого баннера: приложения рекламу не покажут, пока его нет.</Alert>
          ) : null}
          <Button
            disabled={busy}
            onClick={() => {
              const { banners: _b, ...rest } = form;
              void _b;
              void send('/admin/ads/config', rest).then(() => load());
            }}
          >
            Сохранить настройки рекламы
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Баннеры</CardTitle>
          <CardDescription>
            По закону о рекламе на баннере видны пометка «Реклама», рекламодатель и erid (токен ОРД). Без erid баннер не сохраняется. erid
            добавляется и в ссылку.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {cfg.banners.length === 0 ? <p className="text-sm text-muted-foreground">Баннеров пока нет</p> : null}
          <ul className="space-y-2">
            {cfg.banners.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-3 rounded-md border border-border p-2">
                <img src={imageUrl(b.image)} alt="" className="h-16 w-12 rounded object-cover" />
                <div className="min-w-0 flex-1 text-sm">
                  <div className="font-medium">
                    {b.title} {b.enabled ? null : <Badge variant="secondary">выключен</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {b.advertiser} · erid {b.erid} · вес {b.weight}
                    {b.from || b.to ? ' · ' + (dayInput(b.from) || '...') + ' - ' + (dayInput(b.to) || '...') : ''}
                  </div>
                </div>
                <Button size="sm" variant="secondary" onClick={() => setDraft(draftOf(b))}>
                  Изменить
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => {
                    if (!confirm('Удалить баннер «' + b.title + '»? Статистика по нему останется.')) return;
                    void send('/admin/ads/banner-remove', { id: b.id, confirm: 'yes' }).then(() => load());
                  }}
                >
                  Удалить
                </Button>
              </li>
            ))}
          </ul>
          {draft ? (
            <BannerForm
              draft={draft}
              setDraft={setDraft}
              busy={busy}
              error={error}
              onUpload={async (file) => {
                const localId = draft.localId;
                const data = await fileBase64(file);
                const res = await send('/admin/ads/image', { mime: file.type, data });
                const extra = res.extra as { imageId?: string } | undefined;
                const imageId = extra && extra.imageId;
                if (!imageId) return;
                // Field edits made while the upload was in flight stay. A canceled or replaced form is left alone.
                setDraft((cur) => (cur && cur.localId === localId ? { ...cur, image: imageId } : cur));
              }}
              onSave={async () => {
                const { localId: _local, ...banner } = draft;
                void _local;
                const res = await send('/admin/ads/banner', { banner });
                if (res.ok) {
                  setDraft(null);
                  await load();
                }
              }}
            />
          ) : (
            <Button variant="secondary" onClick={() => setDraft(emptyDraft())}>
              Добавить баннер
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Предпросмотр</CardTitle>
          <CardDescription>Так ячейка выглядит в каждом виде карточек на телефоне. Размер всегда как у соседних карточек.</CardDescription>
        </CardHeader>
        <CardContent>
          <AdPreview banner={draft || cfg.banners[0] || null} />
        </CardContent>
      </Card>

      <StatsCard stats={stats} days={days} setDays={setDays} />
    </div>
  );
}

function BannerForm({
  draft,
  setDraft,
  busy,
  error,
  onUpload,
  onSave,
}: {
  draft: Draft;
  setDraft: (d: Draft | null) => void;
  busy: boolean;
  error: string;
  onUpload: (f: File) => Promise<void>;
  onSave: () => Promise<void>;
}) {
  const field = (k: 'title' | 'text' | 'advertiser' | 'erid' | 'url' | 'weight' | 'from' | 'to', label: string, extra?: { placeholder?: string; type?: string; hint?: string; max?: number }) => (
    <div className="space-y-1">
      <Label htmlFor={'banner-' + k}>{label}</Label>
      <Input
        id={'banner-' + k}
        type={extra?.type || 'text'}
        maxLength={extra?.max}
        placeholder={extra?.placeholder}
        value={draft[k]}
        onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
      />
      {extra?.hint ? <p className="text-xs text-muted-foreground">{extra.hint}</p> : null}
    </div>
  );
  const noErid = !draft.erid.trim();
  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <div className="text-sm font-medium">{draft.id ? 'Изменить баннер' : 'Новый баннер'}</div>
      <div className="grid gap-3 md:grid-cols-2">
        {field('title', 'Заголовок', { max: 56, hint: 'До 56 знаков' })}
        {field('advertiser', 'Рекламодатель', { placeholder: 'ООО «Ромашка», ИНН ...', hint: 'Видно на баннере рядом с пометкой «Реклама»' })}
        {field('text', 'Текст', { max: 140, hint: 'До 140 знаков, в виде «список» и между рельсами' })}
        {field('erid', 'erid (токен ОРД)', { placeholder: '2SDnjc...', hint: 'Обязательно. Выдаёт ОРД или партнёрская сеть' })}
        {field('url', 'Ссылка', { placeholder: 'https://...', hint: 'На ТВ вместо клика QR-код с этой ссылкой' })}
        {field('weight', 'Вес', { hint: '1-100: чем больше, тем чаще среди баннеров' })}
        {field('from', 'Показывать с', { type: 'date' })}
        {field('to', 'Показывать по', { type: 'date' })}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {draft.image ? <img src={imageUrl(draft.image)} alt="" className="h-24 w-16 rounded object-cover" /> : <div className="flex h-24 w-16 items-center justify-center rounded bg-muted text-xs">нет</div>}
        <div className="space-y-1">
          <Label htmlFor="banner-image">Картинка 2:3 (JPEG, PNG, WebP, до 300 КБ)</Label>
          <input
            id="banner-image"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="text-sm"
            onChange={(e) => {
              const f = e.target.files && e.target.files[0];
              if (f) void onUpload(f);
            }}
          />
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <fieldset className="space-y-1">
          <legend className="mb-1 text-sm font-medium">Разделы</legend>
          {SECTIONS.map((s) => (
            <label key={s} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={draft.sections.indexOf(s) >= 0} onChange={(e) => setDraft({ ...draft, sections: toggle(draft.sections, s, e.target.checked) })} />
              {AD_SECTION_LABEL[s]}
            </label>
          ))}
        </fieldset>
        <fieldset className="space-y-1">
          <legend className="mb-1 text-sm font-medium">Платформы</legend>
          {PLATFORMS.map((p) => (
            <label key={p} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={draft.platforms.indexOf(p) >= 0} onChange={(e) => setDraft({ ...draft, platforms: toggle(draft.platforms, p, e.target.checked) })} />
              {AD_PLATFORM_LABEL[p]}
            </label>
          ))}
        </fieldset>
        <fieldset className="space-y-1">
          <legend className="mb-1 text-sm font-medium">ТВ</legend>
          <select className={selectClass} value={draft.tvMode} aria-label="Клик на ТВ" onChange={(e) => setDraft({ ...draft, tvMode: e.target.value as Draft['tvMode'] })}>
            <option value="qr">QR-код со ссылкой</option>
            <option value="noclick">Только баннер</option>
          </select>
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
            Баннер включён
          </label>
        </fieldset>
      </div>
      {noErid ? <Alert variant="warn">Без erid баннер не сохранится: это требование закона о маркировке рекламы.</Alert> : null}
      {error ? <Alert variant="warn">{error}</Alert> : null}
      <div className="flex gap-2">
        <Button disabled={busy || noErid} onClick={() => void onSave()}>
          Сохранить баннер
        </Button>
        <Button variant="ghost" onClick={() => setDraft(null)}>
          Отмена
        </Button>
      </div>
    </div>
  );
}

type PreviewBanner = { title: string; text: string; advertiser: string; erid: string; image: string };

/** A rough copy of the phone cells (mobile.css m-ad-*): 2 and 3 columns, list, compact, «Обзор» 4 columns. */
export function AdPreview({ banner }: { banner: PreviewBanner | null }) {
  if (!banner) return <p className="text-sm text-muted-foreground">Добавьте баннер, чтобы увидеть предпросмотр</p>;
  const img = banner.image ? imageUrl(banner.image) : '';
  const poster = (cls: string) => (
    <div className={'relative overflow-hidden rounded-lg bg-zinc-800 ' + cls} style={{ aspectRatio: '173 / 240' }}>
      {img ? <img src={img} alt="" className="h-full w-full object-cover" /> : null}
      <span className="absolute left-1 top-1 rounded bg-black/70 px-1 text-[10px] font-bold text-amber-300">Реклама</span>
    </div>
  );
  const fake = (n: number, cls: string) =>
    Array.from({ length: n }, (_, i) => (
      <div key={i} className="space-y-1">
        <div className={'rounded-lg bg-zinc-700/60 ' + cls} style={{ aspectRatio: '173 / 240' }} />
        <div className="h-2 w-3/4 rounded bg-zinc-700/60" />
      </div>
    ));
  const cell = (
    <div className="min-w-0 space-y-1">
      {poster('')}
      <div className="line-clamp-2 text-xs font-semibold">{banner.title || 'Заголовок'}</div>
      <div className="truncate text-[10px] text-muted-foreground">Реклама · {banner.advertiser || 'рекламодатель'}</div>
      <div className="truncate text-[10px] text-muted-foreground">erid: {banner.erid || '...'}</div>
    </div>
  );
  return (
    <div className="grid gap-4 md:grid-cols-5">
      <div>
        <div className="mb-1 text-xs text-muted-foreground">«Мои»: крупно (2)</div>
        <div className="grid grid-cols-2 gap-2 rounded-md bg-zinc-950 p-2">
          {fake(1, '')}
          {cell}
        </div>
      </div>
      <div>
        <div className="mb-1 text-xs text-muted-foreground">«Мои»: мелко (3)</div>
        <div className="grid grid-cols-3 gap-1 rounded-md bg-zinc-950 p-2">
          {fake(2, '')}
          {cell}
        </div>
      </div>
      <div>
        <div className="mb-1 text-xs text-muted-foreground">«Мои»: список</div>
        <div className="flex gap-2 rounded-md bg-zinc-950 p-2">
          {poster('w-10 shrink-0')}
          <div className="min-w-0 text-xs">
            <div className="font-semibold">{banner.title || 'Заголовок'}</div>
            <div className="text-muted-foreground">{banner.text}</div>
            <div className="text-[10px] text-muted-foreground">
              Реклама · {banner.advertiser || 'рекламодатель'} · erid: {banner.erid || '...'}
            </div>
          </div>
        </div>
      </div>
      <div>
        <div className="mb-1 text-xs text-muted-foreground">«Мои»: компактно</div>
        <div className="rounded-md bg-zinc-950 p-2 text-xs">
          <div className="font-semibold">{banner.title || 'Заголовок'}</div>
          <div className="text-[10px] text-muted-foreground">
            <span className="rounded bg-amber-300/20 px-1 font-bold text-amber-300">Реклама</span> {banner.advertiser || 'рекламодатель'} · erid: {banner.erid || '...'}
          </div>
        </div>
      </div>
      <div>
        <div className="mb-1 text-xs text-muted-foreground">«Обзор»: 4 в ряд</div>
        <div className="grid grid-cols-4 gap-1 rounded-md bg-zinc-950 p-2">
          {fake(3, '')}
          {cell}
        </div>
      </div>
    </div>
  );
}

function StatsTable({ title, rows, label }: { title: string; rows: AdStatRow[]; label?: (k: string, r: AdStatRow) => string }) {
  return (
    <div>
      <div className="mb-1 text-sm font-medium">{title}</div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Нет данных</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Что</TableHead>
              <TableHead className="text-right">Показы</TableHead>
              <TableHead className="text-right">Клики</TableHead>
              <TableHead className="text-right">CTR</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.key}>
                <TableCell>{label ? label(r.key, r) : r.key}</TableCell>
                <TableCell className="text-right">{r.impressions}</TableCell>
                <TableCell className="text-right">{r.clicks}</TableCell>
                <TableCell className="text-right">{ctr(r)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function StatsCard({ stats, days, setDays }: { stats: AdStats | null; days: number; setDays: (n: number) => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Статистика
          <select className={selectClass} value={days} aria-label="Период" onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>7 дней</option>
            <option value={30}>30 дней</option>
            <option value={90}>90 дней</option>
          </select>
        </CardTitle>
        <CardDescription>Показы (ячейка видна наполовину 1 секунду) и клики по дням МСК. Без ID устройств, хранится 90 дней.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!stats ? (
          <Skeleton className="h-24" />
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3">
              {(
                [
                  [stats.total.impressions, 'показов'],
                  [stats.total.clicks, 'кликов'],
                  [ctr(stats.total), 'CTR'],
                ] as const
              ).map(([v, l]) => (
                <div key={l} className="rounded-md border border-border p-3">
                  <div className="text-2xl font-bold">{v}</div>
                  <div className="text-xs text-muted-foreground">{l}</div>
                </div>
              ))}
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <StatsTable title="По баннерам" rows={stats.byBanner} label={(_k, r) => r.title || r.key} />
              <StatsTable title="По разделам" rows={stats.bySection} label={(k) => AD_SECTION_LABEL[k as AdSection] || k} />
              <StatsTable title="По платформам" rows={stats.byPlatform} label={(k) => AD_PLATFORM_LABEL[k as AdPlatform] || k} />
            </div>
            <StatsTable
              title="По дням"
              rows={stats.byDay
                .filter((d) => d.impressions || d.clicks)
                .reverse()
                .map((d) => ({ key: d.day, impressions: d.impressions, clicks: d.clicks }))}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}
