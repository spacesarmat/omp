import { useEffect, useState } from 'preact/hooks';
import { settings, updateSettings, resetSettings } from '../store/settings';
import { client, activeServer } from '../store/servers';
import type { ServerSettings } from '../api/types';
import { errorMessage } from '../api/http';
import { LANG_OPTIONS } from '../lib/tracks';
import { APP_VERSION } from '../version';
import { navigate } from '../ui/nav';
import { FocusGroup, ChoiceRow, ON_OFF, Button } from '../ui/components';
import { restoreFocus } from '../ui/focus';
import { confirmDialog } from '../ui/dialog';
import { toast } from '../ui/toast';

const MB = 1024 * 1024;
const SEEK = [5, 10, 15, 30, 60].map((v) => ({ value: v, label: v + ' с' }));
const SUB_SIZE: { value: 'small' | 'medium' | 'large'; label: string }[] = [
  { value: 'small', label: 'Маленький' },
  { value: 'medium', label: 'Средний' },
  { value: 'large', label: 'Крупный' },
];
const SUB_COLOR: { value: 'white' | 'yellow'; label: string }[] = [
  { value: 'white', label: 'Белый' },
  { value: 'yellow', label: 'Жёлтый' },
];
const CACHE = [64, 128, 256, 512, 1024, 2048].map((m) => ({ value: m * MB, label: m >= 1024 ? m / 1024 + ' ГБ' : m + ' МБ' }));
const PRELOAD = [0, 5, 10, 25, 50, 75, 95].map((v) => ({ value: v, label: v + '%' }));
const READAHEAD = [5, 25, 50, 75, 95].map((v) => ({ value: v, label: v + '%' }));
const CONNS = [10, 25, 50, 100, 200].map((v) => ({ value: v, label: String(v) }));
// TorrServer rate limits are in KB/s, 0 = unlimited
const RATE = [{ value: 0, label: 'Без ограничений' }].concat([1, 5, 10, 25, 50].map((m) => ({ value: m * 1024, label: m + ' МБ/с' })));
const DISCONNECT = [30, 60, 120, 300].map((v) => ({ value: v, label: v + ' с' }));

/** Keeps a server value visible even when it is not one of our presets. */
function withCurrent(options: { value: number; label: string }[], value: number) {
  return options.some((o) => o.value === value) ? options : [{ value, label: String(value) }].concat(options);
}

export function SettingsScreen() {
  const c = client.value;
  const s = settings.value;
  const [srv, setSrv] = useState<ServerSettings | null>(null);
  const [srvError, setSrvError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadServer = () => {
    if (!c) return;
    c.getSettings().then(
      (r) => { setSrv(r); setSrvError(null); setDirty(false); },
      (e) => setSrvError(errorMessage(e)),
    );
  };

  useEffect(() => {
    restoreFocus('SETTINGS');
    loadServer();
  }, []);

  const patch = (p: Partial<ServerSettings>) => {
    if (!srv) return;
    setSrv({ ...srv, ...p } as ServerSettings);
    setDirty(true);
  };

  const saveServer = () => {
    if (!c || !srv || saving) return;
    setSaving(true);
    c.setSettings(srv).then(
      () => { setSaving(false); setDirty(false); toast('Настройки сервера сохранены'); },
      (e) => { setSaving(false); toast(errorMessage(e), 'error'); },
    );
  };

  const resetServer = () => {
    confirmDialog('Сбросить настройки сервера по умолчанию?', 'Сбросить').then((ok) => {
      if (ok && c) {
        setSaving(true);
        c.resetSettings().then(
          () => { setSaving(false); loadServer(); },
          (e) => { setSaving(false); toast(errorMessage(e), 'error'); },
        );
      }
    });
  };

  return (
    <FocusGroup focusKey="SETTINGS" className="screen settings">
      <h1>Настройки</h1>

      <h2>Воспроизведение</h2>
      <ChoiceRow focusKey="set-audio" label="Язык аудио" value={s.audioLang} options={LANG_OPTIONS} onChange={(v) => updateSettings({ audioLang: v })} />
      <ChoiceRow label="Субтитры при запуске" value={s.subtitlesOn} options={ON_OFF} onChange={(v) => updateSettings({ subtitlesOn: v })} />
      <ChoiceRow label="Язык субтитров" value={s.subLang} options={LANG_OPTIONS} onChange={(v) => updateSettings({ subLang: v })} />
      <ChoiceRow label="Шаг перемотки" value={s.seekStep} options={SEEK} onChange={(v) => updateSettings({ seekStep: v })} />
      <ChoiceRow label="Автопереход к следующей серии" value={s.autoNext} options={ON_OFF} onChange={(v) => updateSettings({ autoNext: v })} />
      <ChoiceRow label="Статистика потока при запуске" value={s.showStats} options={ON_OFF} onChange={(v) => updateSettings({ showStats: v })} />

      <h2>Субтитры</h2>
      <ChoiceRow label="Размер" value={s.subSize} options={SUB_SIZE} onChange={(v) => updateSettings({ subSize: v })} />
      <ChoiceRow label="Цвет" value={s.subColor} options={SUB_COLOR} onChange={(v) => updateSettings({ subColor: v })} />
      <ChoiceRow label="Подложка" value={s.subBackground} options={ON_OFF} onChange={(v) => updateSettings({ subBackground: v })} />

      <h2>Сервер{activeServer.value ? ' — ' + activeServer.value.name : ''}</h2>
      {srvError && <div class="banner-error">{srvError}</div>}
      {srv && (
        <div>
          <ChoiceRow label="Размер кэша" value={srv.CacheSize} options={withCurrent(CACHE, srv.CacheSize)} onChange={(v) => patch({ CacheSize: v })} />
          <ChoiceRow label="Предзагрузка" value={srv.PreloadCache} options={withCurrent(PRELOAD, srv.PreloadCache)} onChange={(v) => patch({ PreloadCache: v })} />
          <ChoiceRow label="Опережающее чтение" value={srv.ReaderReadAHead} options={withCurrent(READAHEAD, srv.ReaderReadAHead)} onChange={(v) => patch({ ReaderReadAHead: v })} />
          <ChoiceRow label="Лимит соединений" value={srv.ConnectionsLimit} options={withCurrent(CONNS, srv.ConnectionsLimit)} onChange={(v) => patch({ ConnectionsLimit: v })} />
          <ChoiceRow label="Ограничение загрузки" value={srv.DownloadRateLimit} options={withCurrent(RATE, srv.DownloadRateLimit)} onChange={(v) => patch({ DownloadRateLimit: v })} />
          <ChoiceRow label="Ограничение отдачи" value={srv.UploadRateLimit} options={withCurrent(RATE, srv.UploadRateLimit)} onChange={(v) => patch({ UploadRateLimit: v })} />
          <ChoiceRow label="Отключать неактивный торрент через" value={srv.TorrentDisconnectTimeout} options={withCurrent(DISCONNECT, srv.TorrentDisconnectTimeout)} onChange={(v) => patch({ TorrentDisconnectTimeout: v })} />
          <ChoiceRow label="Сохранять тайм-коды на сервере" value={!!srv.TrackTimecode} options={ON_OFF} onChange={(v) => patch({ TrackTimecode: v })} />
          <div class="row">
            <Button label={dirty ? 'Сохранить на сервере •' : 'Сохранить на сервере'} onPress={saveServer} />
            <Button label="По умолчанию" onPress={resetServer} />
            <Button label="Сменить сервер" onPress={() => navigate({ name: 'connect' })} />
          </div>
        </div>
      )}

      <h2>О приложении</h2>
      <div class="muted">TorrServer Player {APP_VERSION}{c ? ' · ' + c.baseUrl : ''}</div>
      <div class="row" style={{ marginTop: '16px' }}>
        <Button
          label="Сбросить настройки приложения"
          onPress={() => confirmDialog('Сбросить настройки приложения?', 'Сбросить').then((ok) => { if (ok) resetSettings(); })}
        />
      </div>
    </FocusGroup>
  );
}
