import { useEffect, useState } from 'preact/hooks';
import { goBack } from '../nav';
import { Sheet } from '../ui/Sheet';
import { showToast } from '../ui/toast';
import { Icon } from '../ui/Icon';
import { LOCAL_URL } from '../server/localServer';
import { client, activeServer } from '../../../src/store/servers';
import { errorMessage } from '../../../src/api/http';
import type { ServerSettings as Sets } from '../../../src/api/types';
import { CACHE, PRELOAD, READAHEAD, CONNS, RATE, DISCONNECT, withCurrent, type NumOption } from '../../../src/lib/serverSettingsOptions';

type NumField = 'CacheSize' | 'PreloadCache' | 'ReaderReadAHead' | 'ConnectionsLimit' | 'DownloadRateLimit' | 'UploadRateLimit' | 'TorrentDisconnectTimeout';

const ROWS: { field: NumField; label: string; options: NumOption[] }[] = [
  { field: 'CacheSize', label: 'Размер кэша', options: CACHE },
  { field: 'PreloadCache', label: 'Предзагрузка', options: PRELOAD },
  { field: 'ReaderReadAHead', label: 'Опережающее чтение', options: READAHEAD },
  { field: 'ConnectionsLimit', label: 'Лимит соединений', options: CONNS },
  { field: 'DownloadRateLimit', label: 'Ограничение загрузки', options: RATE },
  { field: 'UploadRateLimit', label: 'Ограничение отдачи', options: RATE },
  { field: 'TorrentDisconnectTimeout', label: 'Отключать неактивный торрент через', options: DISCONNECT },
];

function Switch(p: { on: boolean; label: string; onToggle: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={p.on} aria-label={p.label} class={'m-switch' + (p.on ? ' on' : '')} onClick={p.onToggle}>
      <span class="m-switch-knob" />
    </button>
  );
}

export function ServerSettings() {
  const c = client.value;
  const server = activeServer.value;
  const [srv, setSrv] = useState<Sets | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<NumField | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  function load() {
    if (!c) return;
    setError(null);
    c.getSettings().then(
      (r) => setSrv(r),
      () => setError('Не удалось загрузить настройки сервера'),
    );
  }
  useEffect(load, []);

  function save(patch: Partial<Sets>) {
    if (!c || !srv) return;
    const before = srv;
    const next = { ...before, ...patch } as Sets;
    setSrv(next);
    c.setSettings(next).then(
      () => showToast('Сохранено'),
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
        showToast('Сохранено');
        load();
      },
      (e) => showToast(errorMessage(e)),
    );
  }

  const isLocal = !!c && c.baseUrl === LOCAL_URL;
  const row = ROWS.filter((r) => r.field === open)[0];
  return (
    <div class="m-screen" data-route="serverSettings">
      <div class="m-bar">
        <button type="button" class="m-icon-btn" aria-label="Назад" onClick={() => goBack()}>
          <Icon d="M15 5l-7 7 7 7" />
        </button>
        <h1 class="m-bar-title">Настройки сервера</h1>
      </div>
      {server && <div class="m-muted m-small m-ss-sub">{server.name}</div>}
      {error && (
        <div class="m-error" role="alert">
          <span>{error}</span>{' '}
          <button type="button" class="m-btn m-btn-secondary m-btn-sm" onClick={load}>
            Повторить
          </button>
        </div>
      )}
      {!srv && !error && <div class="m-muted">Загружаю…</div>}
      {srv && (
        <>
          <section class="m-set-group">
            {ROWS.map((r) => {
              const cur = withCurrent(r.options, srv[r.field] as number).filter((o) => o.value === srv[r.field])[0];
              return (
                <button type="button" class="m-set-row m-set-pick" data-field={r.field} onClick={() => setOpen(r.field)}>
                  <span>{r.label}</span>
                  <span class="m-muted">{cur.label}</span>
                </button>
              );
            })}
            <div class="m-set-row">
              <span>Сохранять тайм-коды на сервере</span>
              <Switch on={!!srv.TrackTimecode} label="Сохранять тайм-коды на сервере" onToggle={() => save({ TrackTimecode: !srv.TrackTimecode })} />
            </div>
            {isLocal && (
              <div class="m-set-row">
                <span>Кэш на диске телефона</span>
                <Switch on={!!srv.UseDisk} label="Кэш на диске телефона" onToggle={() => save({ UseDisk: !srv.UseDisk })} />
              </div>
            )}
          </section>
          <button type="button" class="m-btn m-btn-secondary m-ss-reset" onClick={() => setConfirmReset(true)}>
            Сбросить к стандартным
          </button>
        </>
      )}
      {srv && row && (
        <Sheet onClose={() => setOpen(null)} label={row.label}>
          <div class="m-sheet-title">{row.label}</div>
          {withCurrent(row.options, srv[row.field] as number).map((o) => (
            <button type="button" role="radio" aria-checked={o.value === srv[row.field]} class="m-opt" onClick={() => pick(row.field, o.value)}>
              <span class="m-opt-name">{o.label}</span>
              {o.value === srv[row.field] && <Icon d="M5 12l5 5l9-10" size={20} />}
            </button>
          ))}
        </Sheet>
      )}
      {confirmReset && (
        <Sheet onClose={() => setConfirmReset(false)} label="Сбросить настройки сервера">
          <div class="m-sheet-title">Сбросить настройки сервера?</div>
          <div class="m-muted">Все настройки вернутся к стандартным значениям.</div>
          <div class="m-sheet-row">
            <button type="button" class="m-btn m-btn-secondary" onClick={() => setConfirmReset(false)}>
              Отмена
            </button>
            <button type="button" class="m-btn m-btn-primary" onClick={reset}>
              Сбросить
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
