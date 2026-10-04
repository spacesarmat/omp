// «Источники поиска» → «Индексаторы» on the phone: Jackett / Prowlarr connections with their trackers, what the LAN
// scan and the TorrServer settings found, and the «Подключить индексатор» sheet. The API key is never kept in
// component state: it is read from the field at «Проверить и подключить», written to the Keystore storage, and the
// field is emptied. A key imported from the TorrServer settings stays in memory only.
import { useEffect, useRef, useState } from 'preact/hooks';
import { Sheet } from '../ui/Sheet';
import { native } from '../platform/native';
import { client } from '../../../src/store/servers';
import { log } from '../../../src/lib/log';
import { setSourceOn, isSourceOn } from '../../../src/sources/store';
import {
  getIndexer,
  hostKey,
  indexerConnections,
  indexerKeyName,
  INDEXER_BAD_URL,
  INDEXER_NO_KEY,
  INDEXER_SOURCE_PREFIX,
  normalizeIndexerUrl,
  onIndexersChange,
  removeIndexer,
  saveIndexer,
  type IndexerConn,
  type IndexerKind,
} from '../../../src/sources/indexerStore';
import {
  candidateWhere,
  hostName,
  identifyIndexer,
  kindByPort,
  lastScan,
  mergeCandidates,
  plainHttpWarning,
  readTorznabImports,
  scanDue,
  scanIndexers,
  type FoundIndexer,
  type IndexerCandidate,
  type LanScan,
  type TorznabImport,
} from '../../../src/sources/indexerDiscovery';
import {
  checkedText,
  checkIndexer,
  connLine,
  connTitle,
  getIndexerStatus,
  kindLabel,
  onIndexerStatus,
  refreshIndexerStatus,
  setIndexerStatus,
  successText,
  trackerStateText,
  trackerTone,
} from '../../../src/sources/indexerStatus';
import type { SourceContext } from '../../../src/sources/types';

/** What the indexer screens need besides the source context (tests pass fakes). */
export interface IndexerEnv {
  /** Native LAN scan of the Jackett / Prowlarr ports; null off-device. */
  scan: LanScan | null;
  /** TorrServer `/settings` (its Torznab list); null without a server. */
  readSettings: (() => Promise<unknown>) | null;
  /** Host of the TorrServer: a Torznab address on its loopback means that machine. */
  serverHost?: string;
  now: () => number;
}

export function phoneIndexerEnv(): IndexerEnv {
  const c = client.value;
  return {
    scan: (ports) => native.scanLan(ports),
    readSettings: c ? () => c.settingsQuiet() : null,
    serverHost: c ? hostName(c.baseUrl) || undefined : undefined,
    now: Date.now,
  };
}

export const KEY_NOTE = 'Ключ хранится в зашифрованном хранилище телефона и не попадает в резервную копию.';
export const UNKNOWN_KIND = 'Не удалось понять, Jackett это или Prowlarr: проверьте адрес и порт';

/** Label of the key field with where to find the key. */
export function keyLabel(kind: IndexerKind | null): string {
  if (kind === 'prowlarr') return 'API-ключ (Prowlarr → Settings → General)';
  if (kind === 'jackett') return 'API-ключ (Jackett → главная страница, поле API Key)';
  return 'API-ключ (Jackett: главная страница · Prowlarr: Settings → General)';
}

function sourceId(c: IndexerConn): string {
  return INDEXER_SOURCE_PREFIX + c.id;
}

function hostOf(url: string): string {
  const m = /^https?:\/\/([^/:]+)/i.exec(url);
  return m ? m[1] : url;
}

interface Preset {
  kind: IndexerKind | null;
  url: string;
  tsKey?: string;
}

/** «Подключить индексатор» (mockup 6). */
export function IndexerAddSheet({
  candidates,
  preset,
  scanning,
  scanned,
  onScan,
  ctx,
  now,
  onClose,
}: {
  candidates: IndexerCandidate[];
  preset: Preset | null;
  scanning: boolean;
  scanned: boolean;
  onScan: () => void;
  ctx: () => SourceContext;
  now: () => number;
  onClose: () => void;
}) {
  const [url, setUrl] = useState(preset ? preset.url : '');
  const [kind, setKind] = useState<IndexerKind | null>(preset ? preset.kind : null);
  // a key from the TorrServer settings applies only to the address it came with
  const [tsKey, setTsKey] = useState<{ key: string; host: string } | null>(preset && preset.tsKey ? { key: preset.tsKey, host: hostKey(preset.url) } : null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  const keyField = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  const clearKey = () => {
    if (keyField.current) keyField.current.value = '';
  };
  useEffect(
    () => () => {
      alive.current = false;
      clearKey();
    },
    [],
  );

  const norm = normalizeIndexerUrl(url);
  const existing = norm ? indexerConnections().filter((c) => hostKey(c.url) === hostKey(norm))[0] : undefined;
  const shownKind = kind || (existing ? existing.kind : null) || (norm ? kindByPort(norm) : null);
  const warn = plainHttpWarning(url);

  const pick = (c: IndexerCandidate) => {
    if (busy) return;
    setUrl(c.url);
    setKind(c.kind);
    setTsKey(c.tsKey ? { key: c.tsKey, host: c.host } : null);
    setError('');
    setDone('');
  };

  const close = () => {
    if (busy) return;
    clearKey();
    onClose();
  };

  const submit = (e?: Event) => {
    if (e) e.preventDefault();
    if (busy) return;
    if (done) {
      close();
      return;
    }
    const base = normalizeIndexerUrl(url);
    if (!base) {
      setError(INDEXER_BAD_URL);
      return;
    }
    const typed = keyField.current ? keyField.current.value.trim() : '';
    const c = ctx();
    const imported = tsKey && tsKey.host === hostKey(base) ? tsKey.key : '';
    setError('');
    setBusy(true);
    const kindP: Promise<IndexerKind | null> = kind && (!existing || existing.kind === kind)
      ? Promise.resolve(kind)
      : existing
        ? Promise.resolve(existing.kind)
        : identifyIndexer(base, c.http).then((k) => k || kindByPort(base), () => kindByPort(base));
    let saved: IndexerKind = 'jackett';
    kindP
      .then((k) => {
        if (!k) throw new Error(UNKNOWN_KIND);
        saved = k;
        if (typed || imported) return typed || imported;
        const old = getIndexer(existingId(k, base));
        if (old && old.keySet && c.secrets) return c.secrets.get(indexerKeyName(old.id)).then((v) => v || '', () => '');
        return '';
      })
      .then((key) => {
        if (!key) throw new Error(INDEXER_NO_KEY);
        return checkIndexer({ kind: saved, url: base }, key, c.http, now).then((st) => {
          if (st.state !== 'ok') throw new Error(st.message || 'Не удалось подключиться');
          return saveIndexer({ kind: saved, url: base, apiKey: key }, c.secrets).then((conn) => {
            setIndexerStatus(conn.id, st);
            return successText(saved, st);
          });
        });
      })
      .then(
        (text) => {
          clearKey();
          if (!alive.current) return;
          log('info', 'search', 'Подключён ' + kindLabel(saved));
          setBusy(false);
          setDone(text);
        },
        (err: unknown) => {
          clearKey();
          if (!alive.current) return;
          setBusy(false);
          setError(err instanceof Error ? err.message : 'Не удалось подключиться');
        },
      );
  };

  const placeholder = tsKey && norm && tsKey.host === hostKey(norm) ? 'ключ из настроек TorrServer' : existing && existing.keySet ? 'оставьте пустым, чтобы не менять' : '';
  return (
    <Sheet label="Подключить индексатор" onClose={close}>
      <form class="m-field-group m-idx-add" onSubmit={submit}>
        <div class="m-sheet-title">Подключить индексатор</div>
        {candidates.length > 0 && <div class="m-note m-muted">Нашлось в сети и в настройках TorrServer:</div>}
        {candidates.map((c) => {
          const chosen = norm !== null && hostKey(c.url) === hostKey(norm);
          const state = c.connId ? 'подключён' : c.tsKey ? 'ключ есть' : 'нужен ключ';
          return (
            <button type="button" key={c.host} class={'m-idx-pick' + (chosen ? ' on' : '')} data-candidate={c.host} onClick={() => pick(c)}>
              <span class="m-src-name">
                <span class="m-idx-title">{c.kind ? kindLabel(c.kind) : 'Jackett или Prowlarr'}</span>
                <span class="m-src-note">{candidateWhere(c)}</span>
              </span>
              <span class={'m-src-note ' + (c.connId || c.tsKey ? 'ok' : 'warn')}>{state}</span>
            </button>
          );
        })}
        <button type="button" class="m-link m-idx-scan" disabled={scanning} onClick={onScan}>
          {scanning ? 'Ищу в сети…' : 'Искать в сети'}
        </button>
        {scanned && !scanning && candidates.length === 0 && <div class="m-note m-muted">В сети Jackett и Prowlarr не нашлись</div>}
        <div class="m-field">
          <label for="m-idx-url">Адрес</label>
          <input
            id="m-idx-url"
            class="m-input"
            type="url"
            inputMode="url"
            autocapitalize="off"
            placeholder="http://192.168.1.5:9117"
            value={url}
            onInput={(e) => {
              setUrl((e.target as HTMLInputElement).value);
              setDone('');
            }}
          />
        </div>
        {warn && (
          <div class="m-src-hint" data-warn="http">
            {warn}
          </div>
        )}
        <div class="m-field">
          <label for="m-idx-key">{keyLabel(shownKind)}</label>
          <input id="m-idx-key" class="m-input" type="password" autocomplete="off" autocapitalize="off" placeholder={placeholder} ref={keyField} />
        </div>
        <div class="m-note m-muted">{KEY_NOTE}</div>
        {error && (
          <div class="m-error" role="alert">
            {error}
          </div>
        )}
        <button type="submit" class="m-btn m-btn-primary" disabled={busy}>
          {busy ? 'Проверяю…' : done ? 'Готово' : 'Проверить и подключить'}
        </button>
        {done && (
          <div class="m-idx-done" role="status">
            {done}
          </div>
        )}
      </form>
    </Sheet>
  );
}

function existingId(kind: IndexerKind, url: string): string {
  const c = indexerConnections().filter((x) => x.kind === kind && x.url === url)[0];
  return c ? c.id : '';
}

function IndexerCard({
  conn,
  open,
  now,
  onOpen,
  onToggle,
  onCheck,
  onKey,
  onRemove,
}: {
  conn: IndexerConn;
  open: boolean;
  now: number;
  onOpen: () => void;
  onToggle: () => void;
  onCheck: () => void;
  onKey: () => void;
  onRemove: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const st = getIndexerStatus(conn.id);
  const on = isSourceOn({ id: sourceId(conn) });
  const line = connLine(st, on);
  const title = connTitle(conn);
  const warn = plainHttpWarning(conn.url);
  const needKey = !!st && (st.state === 'nokey' || st.state === 'badkey');
  return (
    <div class="m-set-card m-idx-card" data-indexer={conn.id}>
      <div class="m-src-row">
        <button type="button" class="m-idx-head" aria-expanded={open} onClick={onOpen}>
          <span class="m-src-name">
            <span class="m-idx-title">{title}</span>
            <span class={'m-src-note' + (line.tone === 'muted' ? '' : ' ' + line.tone)}>{line.text}</span>
          </span>
          <span class="m-idx-caret" aria-hidden="true">
            {open ? '▴' : '▾'}
          </span>
        </button>
        <button type="button" role="switch" aria-checked={on} aria-label={title} class={'m-switch' + (on ? ' on' : '')} onClick={onToggle}>
          <span class="m-switch-knob" />
        </button>
      </div>
      {needKey && (
        <button type="button" class="m-btn m-btn-secondary m-btn-sm" onClick={onKey}>
          Ввести ключ
        </button>
      )}
      {warn && (
        <div class="m-src-hint" data-warn="http">
          {warn}
        </div>
      )}
      {open && (
        <div class="m-idx-body">
          {st &&
            st.trackers.map((t, i) => (
              <div class="m-idx-tracker" key={i}>
                <span>{t.name}</span>
                <span class={'m-src-note ' + trackerTone(t)}>{trackerStateText(t)}</span>
              </div>
            ))}
          {st && st.hint && <div class="m-note m-muted" data-hint="states">{st.hint}</div>}
          {st && st.state === 'ok' && !st.trackers.length && <div class="m-note m-muted">В индексаторе нет настроенных трекеров</div>}
          {st && st.state !== 'ok' && st.message && <div class="m-error">{st.message}</div>}
          {st && <div class="m-idx-checked">{checkedText(st.at, now)}</div>}
          {confirm ? (
            <div class="m-idx-actions">
              <span class="m-note">Удалить подключение? Ключ тоже будет удалён с телефона.</span>
              <button type="button" class="m-btn m-btn-secondary m-btn-sm" onClick={() => setConfirm(false)}>
                Отмена
              </button>
              <button
                type="button"
                class="m-btn m-btn-secondary m-btn-sm"
                onClick={() => {
                  setConfirm(false);
                  onRemove();
                }}
              >
                Удалить
              </button>
            </div>
          ) : (
            <div class="m-idx-actions">
              <button type="button" class="m-btn m-btn-secondary m-btn-sm" onClick={onCheck}>
                Проверить
              </button>
              <button type="button" class="m-btn m-btn-secondary m-btn-sm" onClick={onKey}>
                Изменить ключ
              </button>
              <button type="button" class="m-btn m-btn-secondary m-btn-sm" onClick={() => setConfirm(true)}>
                Удалить
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** The «Индексаторы» part of the phone's «Источники поиска» (mockup 5). onChange: a switch or the list changed. */
export function IndexerSection({ ctx, env, onChange }: { ctx: () => SourceContext; env: () => IndexerEnv; onChange: () => void }) {
  const [, setTick] = useState(0);
  const rerender = () => setTick((n) => n + 1);
  const [imports, setImports] = useState<TorznabImport[]>([]);
  const [found, setFound] = useState<FoundIndexer[]>(() => {
    const s = lastScan();
    return s ? s.found : [];
  });
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Preset | null | false>(false);
  const alive = useRef(true);
  const e = useRef<IndexerEnv>(env());

  const check = (c: IndexerConn) => {
    refreshIndexerStatus(c, ctx(), e.current.now).then(undefined, () => undefined);
  };

  const scan = () => {
    const s = e.current.scan;
    if (scanning || !s) {
      if (!s) setScanned(true);
      return;
    }
    setScanning(true);
    scanIndexers(s, ctx().http, e.current.now).then(
      (list) => {
        if (!alive.current) return;
        setFound(list);
        setScanning(false);
        setScanned(true);
      },
      () => {
        if (!alive.current) return;
        setScanning(false);
        setScanned(true);
      },
    );
  };

  useEffect(() => {
    alive.current = true;
    const offConns = onIndexersChange(() => {
      if (alive.current) rerender();
    });
    const offStatus = onIndexerStatus(() => {
      if (alive.current) rerender();
    });
    readTorznabImports(e.current.readSettings, e.current.serverHost).then((list) => {
      if (!alive.current) return;
      setImports(list);
      // the path selection may have changed with the TorrServer Torznab hosts
      onChange();
    });
    if (e.current.scan && scanDue(e.current.now())) scan();
    indexerConnections().forEach(check);
    return () => {
      alive.current = false;
      offConns();
      offStatus();
    };
  }, []);

  const conns = indexerConnections();
  const candidates = mergeCandidates(conns, found, imports);
  const loose = candidates.filter((c) => !c.connId);
  const now = e.current.now();

  const toggle = (c: IndexerConn) => {
    setSourceOn(sourceId(c), !isSourceOn({ id: sourceId(c) }));
    rerender();
    onChange();
  };

  const remove = (c: IndexerConn) => {
    removeIndexer(c.id, ctx().secrets).then(() => {
      if (!alive.current) return;
      rerender();
      onChange();
    });
  };

  const closeSheet = () => {
    setSheet(false);
    // a new or changed connection: its row and the path selection
    onChange();
  };

  return (
    <section class="m-set-group" data-section="indexers">
      <div class="m-set-label">Индексаторы</div>
      {conns.map((c) => (
        <IndexerCard
          key={c.id}
          conn={c}
          open={openId === c.id}
          now={now}
          onOpen={() => {
            const next = openId === c.id ? null : c.id;
            setOpenId(next);
            // opening a row whose check is older than a minute checks it again
            const st = getIndexerStatus(c.id);
            if (next && (!st || now - st.at > 60000)) check(c);
          }}
          onToggle={() => toggle(c)}
          onCheck={() => check(c)}
          onKey={() => setSheet({ kind: c.kind, url: c.url })}
          onRemove={() => remove(c)}
        />
      ))}
      {loose.map((c) => (
        <div class="m-set-card m-idx-found" key={c.host} data-candidate={c.host}>
          <div class="m-src-row">
            <span class="m-src-name">
              <span class="m-idx-title">{(c.kind ? kindLabel(c.kind) : 'Jackett или Prowlarr') + ' · ' + hostOf(c.url)}</span>
              <span class={'m-src-note ' + (c.tsKey ? 'ok' : 'warn')}>
                {c.torrserver ? (c.tsKey ? 'в настройках TorrServer — ключ есть' : 'в настройках TorrServer — нужен API-ключ') : 'найден в сети — нужен API-ключ'}
              </span>
            </span>
            <button type="button" class="m-btn m-btn-secondary m-btn-sm" onClick={() => setSheet({ kind: c.kind, url: c.url, tsKey: c.tsKey })}>
              Подключить
            </button>
          </div>
        </div>
      ))}
      {scanning && <div class="m-note m-muted">Ищу Jackett и Prowlarr в сети…</div>}
      <button type="button" class="m-idx-add-btn" onClick={() => setSheet(null)}>
        Добавить Jackett или Prowlarr
      </button>
      {sheet !== false && (
        <IndexerAddSheet
          candidates={candidates}
          preset={sheet}
          scanning={scanning}
          scanned={scanned}
          onScan={scan}
          ctx={ctx}
          now={e.current.now}
          onClose={closeSheet}
        />
      )}
    </section>
  );
}
