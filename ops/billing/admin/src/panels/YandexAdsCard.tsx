import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { YandexAdsSettings, YandexGroup } from '@/lib/ads';

type GroupName = 'free' | 'sub';

const GROUPS: { name: GroupName; title: string; hint: string }[] = [
  { name: 'free', title: 'Без подписки', hint: 'Телефон без подписки OMP. По умолчанию включена, каждая 10-я карточка, 3 дня после установки.' },
  { name: 'sub', title: 'С подпиской', hint: 'Телефон с подпиской и телевизор, к которому привязан такой телефон. По умолчанию выключена. На ТВ остаются свои баннеры.' },
];

function num(
  name: GroupName,
  group: YandexGroup,
  field: 'everyN' | 'afterInstallDays' | 'maxPerSession' | 'maxPerDay',
  label: string,
  hint: string,
  onChange: (next: YandexGroup) => void,
) {
  const id = 'yandex-' + name + '-' + field;
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        inputMode="numeric"
        value={group[field] === undefined || group[field] === null ? '' : String(group[field])}
        onChange={(e) => onChange({ ...group, [field]: e.target.value as unknown as number })}
      />
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

/** The Yandex Mobile Ads card. Own banners stay on the card above. */
export function YandexAdsCard({
  value,
  busy,
  onChange,
  onSave,
}: {
  value: YandexAdsSettings;
  busy: boolean;
  onChange: (next: YandexAdsSettings) => void;
  onSave: (next: YandexAdsSettings) => void;
}) {
  const setGroup = (name: GroupName, group: YandexGroup) => onChange({ ...value, groups: { ...value.groups, [name]: group } });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Реклама Яндекса</CardTitle>
        <CardDescription>
          Нативная реклама Yandex Mobile Ads только на телефоне Android и iOS, в той же карточке, что и свои баннеры. Если Яндекс не отдал объявление, показывается свой баннер, затем обычная карточка. Пустой блок - официальный демо-идентификатор, пока в кабинете Яндекса не появится свой R-M-.... Старые версии приложения это поле не читают и ничего нового не показывают. Телевизор, Windows и сайт остаются на своих баннерах.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={value.enabled} onChange={(e) => onChange({ ...value, enabled: e.target.checked })} />
          Показывать рекламу Яндекса (общий выключатель)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={value.fallbackHouse} onChange={(e) => onChange({ ...value, fallbackHouse: e.target.checked })} />
          Если Яндекс не отдал объявление, показать свой баннер
        </label>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="yandex-android">Блок Android</Label>
            <Input id="yandex-android" value={value.androidUnit} placeholder="R-M-... или пусто" onChange={(e) => onChange({ ...value, androidUnit: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="yandex-ios">Блок iOS</Label>
            <Input id="yandex-ios" value={value.iosUnit} placeholder="R-M-... или пусто" onChange={(e) => onChange({ ...value, iosUnit: e.target.value })} />
          </div>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {GROUPS.map((g) => {
            const group = value.groups[g.name];
            return (
              <fieldset key={g.name} className="space-y-3 rounded-md border border-border p-3">
                <legend className="px-1 text-sm font-medium">{g.title}</legend>
                <p className="text-xs text-muted-foreground">{g.hint}</p>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={group.enabled} onChange={(e) => setGroup(g.name, { ...group, enabled: e.target.checked })} />
                  Показывать этой группе
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  {num(g.name, group, 'everyN', 'Каждая N-я карточка', '6-30', (next) => setGroup(g.name, next))}
                  {num(g.name, group, 'afterInstallDays', 'Дней после установки', '0-60', (next) => setGroup(g.name, next))}
                  {num(g.name, group, 'maxPerSession', 'Показов за сеанс', '0 или пусто: без лимита, до 100', (next) => setGroup(g.name, next))}
                  {num(g.name, group, 'maxPerDay', 'Показов за день', '0 или пусто: без лимита, до 500, сутки по Москве', (next) => setGroup(g.name, next))}
                </div>
              </fieldset>
            );
          })}
        </div>
        <Button disabled={busy} onClick={() => onSave(value)}>
          Сохранить рекламу Яндекса
        </Button>
      </CardContent>
    </Card>
  );
}
