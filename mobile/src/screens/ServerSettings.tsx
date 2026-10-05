import { useEffect, useMemo, useState } from 'preact/hooks';
import { t } from '../../../src/i18n';
import { goBack } from '../nav';
import { Sheet } from '../ui/Sheet';
import { showToast } from '../ui/toast';
import { Icon } from '../ui/Icon';
import { LOCAL_URL, LOCAL_NAME } from '../server/localServer';
import { client, activeServer } from '../../../src/store/servers';
import { torrents, findPosters } from '../../../src/store/library';
import { TorrServerClient } from '../../../src/api/torrserver';
import { errorMessage } from '../../../src/api/http';
import type { ServerSettings as Sets, TmdbConfig } from '../../../src/api/types';
import { cacheOptions, preloadOptions, readaheadOptions, connsOptions, rateOptions, disconnectOptions, withCurrent, type NumOption } from '../../../src/lib/serverSettingsOptions';

type NumField = 'CacheSize' | 'PreloadCache' | 'ReaderReadAHead' | 'ConnectionsLimit' | 'DownloadRateLimit' | 'UploadRateLimit' | 'TorrentDisconnectTimeout';

const rows = (): { field: NumField; label: string; options: NumOption[] }[] => [
  { field: 'CacheSize', label: t('tvSettings.cacheSize'), options: cacheOptions() },
  { field: 'PreloadCache', label: t('tvSettings.preload'), options: preloadOptions() },
  { field: 'ReaderReadAHead', label: t('tvSettings.readahead'), options: readaheadOptions() },
  { field: 'ConnectionsLimit', label: t('tvSettings.connsLimit'), options: connsOptions() },
  { field: 'DownloadRateLimit', label: t('tvSettings.downLimit'), options: rateOptions() },
  { field: 'UploadRateLimit', label: t('tvSettings.upLimit'), options: rateOptions() },
  { field: 'TorrentDisconnectTimeout', label: t('tvSettings.disconnectAfter'), options: disconnectOptions() },
];

function Switch(p: { on: boolean; label: string; onToggle: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={p.on} aria-label={p.label} class={'m-switch' + (p.on ? ' on' : '')} onClick={p.onToggle}>
      <span class="m-switch-knob" />
    </button>
  );
}

export function ServerSettings({ url }: { url?: string } = {}) {
  const active = client.value;
  // an explicit url edits that server without switching the active one
  const c = useMemo(() => (url ? new TorrServerClient({ url }) : active), [url, active ? active.baseUrl : '']);
  const server = url ? { name: url === LOCAL_URL ? LOCAL_NAME : url } : activeServer.value;
  const [srv, setSrv] = useState<Sets | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<NumField | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [tmdbOpen, setTmdbOpen] = useState(false);
  const [tmdbKey, setTmdbKey] = useState('');
  const [progress, setProgress] = useState<string | null>(null);

  function load() {
    if (!c) return;
    setError(null);
    c.getSettings().then(
      (r) => setSrv(r),
      () => setError(t('serverSettings.loadFailed')),
    );
  }
  useEffect(load, [c ? c.baseUrl : '']);

  function save(patch: Partial<Sets>) {
    if (!c || !srv) return;
    const before = srv;
    const next = { ...before, ...patch } as Sets;
    setSrv(next);
    c.setSettings(next).then(
      () => showToast(t('connect.saved')),
      (e) => {
        setSrv(before);
        showToast(errorMessage(e));
      },
    );
  }

  function pick(field: NumField, value: number) {
    setOpen(null);
    if (srv && srv[field] !== value) save({ [field]: value });
  }

  function reset() {
    setConfirmReset(false);
    if (!c) return;
    c.resetSettings().then(
      () => {
        showToast(t('connect.saved'));
        load();
      },
      (e) => showToast(errorMessage(e)),
    );
  }

  // older TorrServer builds have no TMDB settings: the row is hidden there
  const tmdb = srv && srv.TMDBSettings && typeof srv.TMDBSettings === 'object' ? (srv.TMDBSettings as TmdbConfig) : null;
  function saveTmdb() {
    setTmdbOpen(false);
    if (tmdb && (tmdb.APIKey || '') !== tmdbKey.trim()) save({ TMDBSettings: { ...tmdb, APIKey: tmdbKey.trim() } });
  }

  // the catalog belongs to the active server: posters for all only when editing that one
  const isActive = !!c && !!active && c.baseUrl === active.baseUrl;
  function fillAll() {
    if (!c || progress !== null) return;
    const missing = torrents.value.filter((x) => !x.poster);
    if (!missing.length) {
      showToast(t('serverSettings.allHavePosters'));
      return;
    }
    setProgress(t('serverSettings.searching'));
    findPosters(c, missing, (_h, _p, done, total) => setProgress(t('serverSettings.searchingProgress', { done: done, total: total }))).then((r) => {
      setProgress(null);
      showToast(r.hasKey ? t('serverSettings.foundPosters', { found: r.found, tried: r.tried }) : t('serverSettings.needKey'));
    });
  }

  const isLocal = !!c && c.baseUrl === LOCAL_URL;
  const row = rows().filter((r) => r.field === open)[0];
  return (
    <div class="m-screen" data-route="serverSettings">
      <div class="m-bar">
        <button type="button" class="m-icon-btn" aria-label={t('common.back')} onClick={() => goBack()}>
          <Icon d="M15 5l-7 7 7 7" />
        </button>
        <h1 class="m-bar-title">{t('serverSettings.title')}</h1>
      </div>
      {server && <div class="m-muted m-small m-ss-sub">{server.name}</div>}
      {error && (
        <div class="m-error" role="alert">
          <span>{error}</span>{' '}
          <button type="button" class="m-btn m-btn-secondary m-btn-sm" onClick={load}>
            {t('common.retry')}
          </button>
        </div>
      )}
      {!srv && !error && <div class="m-muted">{t('serverSettings.loading')}</div>}
      {srv && (
        <>
          <section class="m-set-group">
            {rows().map((r) => {
              const v = srv[r.field];
              const cur = typeof v === 'number' ? withCurrent(r.options, v).filter((o) => o.value === v)[0] : undefined;
              return (
                <button type="button" class="m-set-row m-set-pick" data-field={r.field} onClick={() => setOpen(r.field)}>
                  <span>{r.label}</span>
                  <span class="m-muted">{cur ? cur.label : '—'}</span>
                </button>
              );
            })}
            <div class="m-set-row m-ss-row">
              <span>{t('tvSettings.trackTimecode')}</span>
              <Switch on={!!srv.TrackTimecode} label={t('tvSettings.trackTimecode')} onToggle={() => save({ TrackTimecode: !srv.TrackTimecode })} />
            </div>
            {isLocal && (
              <div class="m-set-row m-ss-row">
                <span>{t('serverSettings.diskCache')}</span>
                <Switch on={!!srv.UseDisk} label={t('serverSettings.diskCache')} onToggle={() => save({ UseDisk: !srv.UseDisk })} />
              </div>
            )}
          </section>
          {tmdb && (
            <section class="m-set-group">
              <button
                type="button"
                class="m-set-row m-set-pick"
                data-field="tmdb"
                onClick={() => {
                  setTmdbKey(tmdb.APIKey || '');
                  setTmdbOpen(true);
                }}
              >
                <span>{t('serverSettings.tmdbKey')}</span>
                <span class="m-muted">{tmdb.APIKey ? t('serverSettings.set') : t('serverSettings.notSet')}</span>
              </button>
              {tmdb.APIKey && isActive && (
                <button type="button" class="m-set-row m-set-pick" data-field="posters" disabled={progress !== null} onClick={fillAll}>
                  <span>{t('serverSettings.fillPosters')}</span>
                  <span class="m-muted">{progress || ''}</span>
                </button>
              )}
            </section>
          )}
          <button type="button" class="m-btn m-btn-secondary m-ss-reset" onClick={() => setConfirmReset(true)}>
            {t('serverSettings.reset')}
          </button>
        </>
      )}
      {srv && row && (
        <Sheet onClose={() => setOpen(null)} label={row.label}>
          <div class="m-sheet-title">{row.label}</div>
          {(typeof srv[row.field] === 'number' ? withCurrent(row.options, srv[row.field] as number) : row.options).map((o) => (
            <button type="button" role="radio" aria-checked={o.value === srv[row.field]} class="m-opt" onClick={() => pick(row.field, o.value)}>
              <span class="m-opt-name">{o.label}</span>
              {o.value === srv[row.field] && <Icon d="M5 12l5 5l9-10" size={20} />}
            </button>
          ))}
        </Sheet>
      )}
      {tmdbOpen && (
        <Sheet onClose={() => setTmdbOpen(false)} label={t('serverSettings.tmdbTitle')}>
          <div class="m-sheet-title">{t('serverSettings.tmdbTitle')}</div>
          <div class="m-muted">
            {t('serverSettings.tmdbText')}
          </div>
          <div class="m-field">
            <label for="tmdb-key">{t('serverSettings.apiKey')}</label>
            <input
              id="tmdb-key"
              class="m-input"
              type="text"
              autoCapitalize="off"
              autoComplete="off"
              spellcheck={false}
              value={tmdbKey}
              onInput={(e) => setTmdbKey((e.target as HTMLInputElement).value)}
            />
          </div>
          <div class="m-sheet-row">
            <button type="button" class="m-btn m-btn-secondary" onClick={() => setTmdbOpen(false)}>
              {t('common.cancel')}
            </button>
            <button type="button" class="m-btn m-btn-primary" onClick={saveTmdb}>
              {t('common.save')}
            </button>
          </div>
        </Sheet>
      )}
      {confirmReset && (
        <Sheet onClose={() => setConfirmReset(false)} label={t('serverSettings.resetLabel')}>
          <div class="m-sheet-title">{t('serverSettings.resetTitle')}</div>
          <div class="m-muted">{t('serverSettings.resetText')}</div>
          <div class="m-sheet-row">
            <button type="button" class="m-btn m-btn-secondary" onClick={() => setConfirmReset(false)}>
              {t('common.cancel')}
            </button>
            <button type="button" class="m-btn m-btn-primary" onClick={reset}>
              {t('common.reset')}
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
