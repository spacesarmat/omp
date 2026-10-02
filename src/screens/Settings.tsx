import { useEffect, useState } from 'preact/hooks';
import { settings, updateSettings, resetSettings } from '../store/settings';
import { client, activeServer } from '../store/servers';
import type { ServerSettings } from '../api/types';
import { errorMessage } from '../api/http';
import { LANG_OPTIONS } from '../lib/tracks';
import { APP_VERSION } from '../version';
import { SUB_SIZE_OPTIONS } from '../player/subtitleOffset';
import { navigate } from '../ui/nav';
import { FocusGroup, ChoiceRow, ON_OFF, Button } from '../ui/components';
import { restoreFocus } from '../ui/focus';
import { confirmDialog } from '../ui/dialog';
import { toast } from '../ui/toast';
import { latestUpdate, checkForUpdate } from '../store/updates';
import { openHbChannel } from '../platform/hbchannel';
import { HB_REPO_URL } from '../lib/updateInfo';
import { platformKind } from '../platform/env';
import { CACHE, PRELOAD, READAHEAD, CONNS, RATE, DISCONNECT, withCurrent } from '../lib/serverSettingsOptions';

const SEEK = [5, 10, 15, 30, 60].map((v) => ({ value: v, label: v + ' с' }));
const SUB_COLOR: { value: 'white' | 'yellow'; label: string }[] = [
  { value: 'white', label: 'Белый' },
  { value: 'yellow', label: 'Жёлтый' },
];

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

      <h2>Сервер</h2>
      <div class="row">
        <div class="grow">
          {activeServer.value ? activeServer.value.name + ' · ' + activeServer.value.url.replace(/^https?:\/\//, '') : 'Сервер не выбран'}
        </div>
        <Button focusKey="set-server" label="Сменить сервер" onPress={() => navigate({ name: 'connect' })} />
        <Button focusKey="set-pair" label="Подключить телефон" onPress={() => navigate({ name: 'pairPhone' })} />
      </div>

      <h2>Воспроизведение</h2>
      <ChoiceRow focusKey="set-audio" label="Язык аудио" value={s.audioLang} options={LANG_OPTIONS} onChange={(v) => updateSettings({ audioLang: v })} />
      <ChoiceRow label="Субтитры при запуске" value={s.subtitlesOn} options={ON_OFF} onChange={(v) => updateSettings({ subtitlesOn: v })} />
      <ChoiceRow label="Язык субтитров" value={s.subLang} options={LANG_OPTIONS} onChange={(v) => updateSettings({ subLang: v })} />
      <ChoiceRow label="Шаг перемотки" value={s.seekStep} options={SEEK} onChange={(v) => updateSettings({ seekStep: v })} />
      <ChoiceRow label="Шаг двойного клика" value={s.edgeSeekStep} options={[5, 10, 15].map((v) => ({ value: v, label: v + ' с' }))} onChange={(v) => updateSettings({ edgeSeekStep: v })} />
      <ChoiceRow label="Автопереход к следующей серии" value={s.autoNext} options={ON_OFF} onChange={(v) => updateSettings({ autoNext: v })} />
      <ChoiceRow label="Статистика потока при запуске" value={s.showStats} options={ON_OFF} onChange={(v) => updateSettings({ showStats: v })} />

      <h2>Субтитры</h2>
      <ChoiceRow label="Размер" value={s.subSize} options={SUB_SIZE_OPTIONS} onChange={(v) => updateSettings({ subSize: v })} />
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
      <div class="row">
        <div class="grow">
          OMP — Open Movie Player {APP_VERSION}
          {latestUpdate.value ? ' · доступна ' + latestUpdate.value.version : ''}
          {c ? ' · ' + c.baseUrl : ''}
        </div>
        <Button
          focusKey="set-update-check"
          label="Проверить обновления"
          onPress={() => checkForUpdate({ manual: true }).then((r) => {
            if (r === 'error') toast('Не удалось проверить обновления', 'error');
            else if (r === 'latest') toast('У вас последняя версия');
          })}
        />
      </div>
      <ChoiceRow label="Проверять обновления при запуске" value={s.updateCheck} options={ON_OFF} onChange={(v) => updateSettings({ updateCheck: v })} />
      <div class="row" style={{ marginTop: '16px' }}>
        <Button label="Обновление" onPress={() => navigate({ name: 'update' })} />
        {platformKind() !== 'androidtv' && (
          <Button
            label="Добавить репозиторий OMP в Homebrew Channel"
            onPress={() => { openHbChannel(HB_REPO_URL).catch(() => toast('Не удалось открыть Homebrew Channel', 'error')); }}
          />
        )}
        <Button
          label="Сбросить настройки приложения"
          onPress={() => confirmDialog('Сбросить настройки приложения?', 'Сбросить').then((ok) => { if (ok) resetSettings(); })}
        />
      </div>
    </FocusGroup>
  );
}
