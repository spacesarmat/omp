import { useEffect, useState } from 'preact/hooks';
import { settings, updateSettings, resetSettings } from '../store/settings';
import { client, activeServer } from '../store/servers';
import type { ServerSettings } from '../api/types';
import { errorMessage } from '../api/http';
import { LANG_OPTIONS } from '../lib/tracks';
import { APP_VERSION } from '../version';
import { subSizeOptions } from '../player/subtitleOffset';
import { navigate } from '../ui/nav';
import { FocusGroup, ChoiceRow, onOff, Button, Focusable } from '../ui/components';
import { playerEngineOptions, vlcUnavailable, vlcAvailable } from '../player/nativeEngine';
import { nativePlugin } from '../platform/androidNative';
import { restoreFocus } from '../ui/focus';
import { confirmDialog } from '../ui/dialog';
import { toast } from '../ui/toast';
import { latestUpdate, checkForUpdate } from '../store/updates';
import { openHbChannel } from '../platform/hbchannel';
import { HB_REPO_URL } from '../lib/updateInfo';
import { platformKind } from '../platform/env';
import { logEntries, clearLog, logVersion, logTime, levelLabel, areaLabel } from '../lib/log';
import { cacheOptions, preloadOptions, readaheadOptions, connsOptions, rateOptions, disconnectOptions, withCurrent } from '../lib/serverSettingsOptions';
import { t, type LanguageSetting } from '../i18n';
import { LANGUAGE_NAMES } from '../i18n/languageNames';

const seekOptions = () => [5, 10, 15, 30, 60].map((v) => ({ value: v, label: v + ' ' + t('common.sec') }));
const subColorOptions = (): { value: 'white' | 'yellow'; label: string }[] => [
  { value: 'white', label: t('tvSettings.white') },
  { value: 'yellow', label: t('tvSettings.yellow') },
];

const LOG_BRIEF = 20;

/** «Язык»: a press cycles Как в системе → Русский → English (read at render: the labels follow the language). */
function languageOptions(): { value: LanguageSetting; label: string }[] {
  return [
    { value: 'system', label: t('settings.language.system') },
    { value: 'ru', label: LANGUAGE_NAMES.ru },
    { value: 'en', label: LANGUAGE_NAMES.en },
  ];
}

/** Android TV: «Плеер» — the engine of the native player (per torrent: the player menu). */
function PlayerEngineSection() {
  const cur = settings.value.playerEngine;
  const [vlcOk, setVlcOk] = useState(true);
  useEffect(() => {
    let live = true;
    vlcAvailable(nativePlugin()).then((ok) => { if (live) setVlcOk(ok); });
    return () => { live = false; };
  }, []);
  return (
    <div class="engine-block">
      <h2>{t('tvSettings.player')}</h2>
      <div class="muted engine-intro">{t('tvSettings.engineIntro')}</div>
      {playerEngineOptions().map((o) => {
        const off = o.value === 'vlc' && !vlcOk;
        return (
          <Focusable
            key={o.value}
            focusKey={'set-engine-' + o.value}
            className={'engine-option' + (cur === o.value ? ' on' : '')}
            role="radio"
            ariaChecked={cur === o.value}
            ariaLabel={o.name}
            disabled={off}
            onPress={() => updateSettings({ playerEngine: o.value })}
          >
            <span class="engine-dot" />
            <span class="engine-texts">
              <span class="engine-name">{o.name}</span>
              <span class="engine-text">{off ? vlcUnavailable() : o.text}</span>
            </span>
          </Focusable>
        );
      })}
      <div class="muted engine-note">{t('tvSettings.engineNote')}</div>
    </div>
  );
}

/** The last entries of the error log, newest first (read-only; the full log with sharing is on the phone). */
function LogBrief() {
  void logVersion.value; // re-render on new entries
  const list = logEntries().reverse().slice(0, LOG_BRIEF);
  return (
    <div class="log-brief">
      {list.length === 0 ? (
        <div class="log-empty">{t('tvSettings.logEmpty')}</div>
      ) : (
        list.map((e, i) => (
          <div class={'log-line log-' + e.l} key={e.t + ':' + i}>
            <span class="log-level">{levelLabel(e.l)}</span> {logTime(e.t)} · {areaLabel(e.a)}: {e.x}
          </div>
        ))
      )}
      <div class="row">
        <Button
          focusKey="set-log-clear"
          label={t('tvSettings.clearLog')}
          onPress={() => confirmDialog(t('tvSettings.clearLogAsk'), t('tvSettings.clear')).then((ok) => { if (ok) clearLog(); })}
        />
      </div>
    </div>
  );
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
      () => { setSaving(false); setDirty(false); toast(t('tvSettings.serverSaved')); },
      (e) => { setSaving(false); toast(errorMessage(e), 'error'); },
    );
  };

  const resetServer = () => {
    confirmDialog(t('tvSettings.resetServerAsk'), t('tv.marks.reset')).then((ok) => {
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
      <h1>{t('common.settings')}</h1>
      <ChoiceRow
        focusKey="set-language"
        label={t('settings.language.title')}
        value={s.language}
        options={languageOptions()}
        onChange={(v) => updateSettings({ language: v })}
      />

      <h2>{t('tvSettings.server')}</h2>
      <div class="row">
        <div class="grow">
          {activeServer.value ? activeServer.value.name + ' · ' + activeServer.value.url.replace(/^https?:\/\//, '') : t('errors.noServerSelected')}
        </div>
        <Button focusKey="set-server" label={t('catalog.changeServer')} onPress={() => navigate({ name: 'connect' })} />
        <Button focusKey="set-pair" label={t('pair.title')} onPress={() => navigate({ name: 'pairPhone' })} />
        <Button focusKey="set-faq" label={t('common.faq')} onPress={() => navigate({ name: 'faq' })} />
      </div>
      {platformKind() === 'androidtv' && (
        <div class="row">
          <div class="grow muted">{t('tvSettings.sourcesNote')}</div>
          <Button focusKey="set-sources" label={t('tvSettings.sources')} onPress={() => navigate({ name: 'sources' })} />
        </div>
      )}

      {platformKind() === 'androidtv' && <PlayerEngineSection />}

      <h2>{t('tvSettings.playback')}</h2>
      <ChoiceRow focusKey="set-audio" label={t('tvSettings.audioLang')} value={s.audioLang} options={LANG_OPTIONS} onChange={(v) => updateSettings({ audioLang: v })} />
      <ChoiceRow focusKey="set-subtitlesOn" label={t('tvSettings.subtitlesOn')} value={s.subtitlesOn} options={onOff()} onChange={(v) => updateSettings({ subtitlesOn: v })} />
      <ChoiceRow focusKey="set-subLang" label={t('tvSettings.subLang')} value={s.subLang} options={LANG_OPTIONS} onChange={(v) => updateSettings({ subLang: v })} />
      <ChoiceRow focusKey="set-seekStep" label={t('tvSettings.seekStep')} value={s.seekStep} options={seekOptions()} onChange={(v) => updateSettings({ seekStep: v })} />
      <ChoiceRow focusKey="set-edgeStep" label={t('tvSettings.edgeStep')} value={s.edgeSeekStep} options={[5, 10, 15].map((v) => ({ value: v, label: v + ' ' + t('common.sec') }))} onChange={(v) => updateSettings({ edgeSeekStep: v })} />
      <ChoiceRow focusKey="set-autoNext" label={t('tvSettings.autoNext')} value={s.autoNext} options={onOff()} onChange={(v) => updateSettings({ autoNext: v })} />
      <ChoiceRow focusKey="set-showStats" label={t('tvSettings.showStats')} value={s.showStats} options={onOff()} onChange={(v) => updateSettings({ showStats: v })} />

      <h2>{t('common.subtitles')}</h2>
      <ChoiceRow focusKey="set-subSize" label={t('tvSettings.subSize')} value={s.subSize} options={subSizeOptions()} onChange={(v) => updateSettings({ subSize: v })} />
      <ChoiceRow focusKey="set-subColor" label={t('tvSettings.subColor')} value={s.subColor} options={subColorOptions()} onChange={(v) => updateSettings({ subColor: v })} />
      <ChoiceRow focusKey="set-subBackground" label={t('tvSettings.subBackground')} value={s.subBackground} options={onOff()} onChange={(v) => updateSettings({ subBackground: v })} />

      <h2>{activeServer.value ? t('tvSettings.serverNamed', { name: activeServer.value.name }) : t('tvSettings.server')}</h2>
      {srvError && <div class="banner-error">{srvError}</div>}
      {srv && (
        <div>
          <ChoiceRow focusKey="set-cacheSize" label={t('tvSettings.cacheSize')} value={srv.CacheSize} options={withCurrent(cacheOptions(), srv.CacheSize)} onChange={(v) => patch({ CacheSize: v })} />
          <ChoiceRow focusKey="set-preload" label={t('tvSettings.preload')} value={srv.PreloadCache} options={withCurrent(preloadOptions(), srv.PreloadCache)} onChange={(v) => patch({ PreloadCache: v })} />
          <ChoiceRow focusKey="set-readahead" label={t('tvSettings.readahead')} value={srv.ReaderReadAHead} options={withCurrent(readaheadOptions(), srv.ReaderReadAHead)} onChange={(v) => patch({ ReaderReadAHead: v })} />
          <ChoiceRow focusKey="set-connsLimit" label={t('tvSettings.connsLimit')} value={srv.ConnectionsLimit} options={withCurrent(connsOptions(), srv.ConnectionsLimit)} onChange={(v) => patch({ ConnectionsLimit: v })} />
          <ChoiceRow focusKey="set-downLimit" label={t('tvSettings.downLimit')} value={srv.DownloadRateLimit} options={withCurrent(rateOptions(), srv.DownloadRateLimit)} onChange={(v) => patch({ DownloadRateLimit: v })} />
          <ChoiceRow focusKey="set-upLimit" label={t('tvSettings.upLimit')} value={srv.UploadRateLimit} options={withCurrent(rateOptions(), srv.UploadRateLimit)} onChange={(v) => patch({ UploadRateLimit: v })} />
          <ChoiceRow focusKey="set-disconnectAfter" label={t('tvSettings.disconnectAfter')} value={srv.TorrentDisconnectTimeout} options={withCurrent(disconnectOptions(), srv.TorrentDisconnectTimeout)} onChange={(v) => patch({ TorrentDisconnectTimeout: v })} />
          <ChoiceRow focusKey="set-trackTimecode" label={t('tvSettings.trackTimecode')} value={!!srv.TrackTimecode} options={onOff()} onChange={(v) => patch({ TrackTimecode: v })} />
          <div class="row">
            <Button focusKey="set-saveOnServer" label={dirty ? t('tvSettings.saveOnServerDirty') : t('tvSettings.saveOnServer')} onPress={saveServer} />
            <Button focusKey="set-defaults" label={t('tvSettings.defaults')} onPress={resetServer} />
            <Button focusKey="set-server-2" label={t('catalog.changeServer')} onPress={() => navigate({ name: 'connect' })} />
          </div>
        </div>
      )}

      <h2>{t('tvSettings.log')}</h2>
      <LogBrief />

      <h2>{t('tvSettings.about')}</h2>
      <div class="row">
        <div class="grow">
          {t('tvSettings.aboutLine', { version: APP_VERSION })}
          {latestUpdate.value ? t('tvSettings.availableVersion', { version: latestUpdate.value.version }) : ''}
          {c ? ' · ' + c.baseUrl : ''}
        </div>
        <Button
          focusKey="set-update-check"
          label={t('updateScreen.check')}
          onPress={() => checkForUpdate({ manual: true }).then((r) => {
            if (r === 'error') toast(t('updateScreen.checkFailed'), 'error');
            else if (r === 'latest') toast(t('updateScreen.latest'));
          })}
        />
      </div>
      <ChoiceRow focusKey="set-updateOnStart" label={t('tvSettings.updateOnStart')} value={s.updateCheck} options={onOff()} onChange={(v) => updateSettings({ updateCheck: v })} />
      <div class="row" style={{ marginTop: '16px' }}>
        <Button focusKey="set-update" label={t('tvSettings.update')} onPress={() => navigate({ name: 'update' })} />
        {platformKind() !== 'androidtv' && (
          <Button
            focusKey="set-addHbRepo"
            label={t('tvSettings.addHbRepo')}
            onPress={() => { openHbChannel(HB_REPO_URL).catch(() => toast(t('updateScreen.openHbFailed'), 'error')); }}
          />
        )}
        <Button
          focusKey="set-resetApp"
          label={t('tvSettings.resetApp')}
          onPress={() => confirmDialog(t('tvSettings.resetAppAsk'), t('tv.marks.reset')).then((ok) => { if (ok) resetSettings(); })}
        />
      </div>
    </FocusGroup>
  );
}
