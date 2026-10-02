import { useEffect, useState } from 'preact/hooks';
import { client } from '../store/servers';
import { torrents, refreshTorrents, addedTorrents, addedMessage } from '../store/library';
import { continueWatching, refreshViewed, progressVersion, Progress } from '../store/progress';
import type { Torrent } from '../api/types';
import { errorMessage } from '../api/http';
import { CATEGORY_TABS, Category, categoryOf } from '../lib/category';
import { formatBytes, formatDuration } from '../lib/format';
import { baseName, episodeLabel } from '../lib/episodes';
import { buildTorrentQueue } from '../player/queue';
import { navigate, resetTo } from '../ui/nav';
import { FocusGroup, Focusable, Button, ErrorView, ProgressBar, Spinner } from '../ui/components';
import { KeyDot } from '../ui/icons';
import { restoreFocus } from '../ui/focus';
import { confirmDialog } from '../ui/dialog';
import { toast } from '../ui/toast';
import { useKeys } from '../ui/keys';

function PosterCard(p: { t: Torrent; onPress: () => void; onFocused: () => void }) {
  const t = p.t;
  return (
    <Focusable focusKey={'torrent-' + t.hash} className="card" onPress={p.onPress} onFocused={p.onFocused}>
      <div class="poster">
        {t.poster
          ? <img src={t.poster} alt="" onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }} />
          : <div class="poster-fallback">{(t.title || '?').charAt(0)}</div>}
      </div>
      <div class="card-title">{t.title || t.name || t.hash}</div>
      <div class="card-meta">{formatBytes(t.torrent_size || 0)}</div>
    </Focusable>
  );
}

export function LibraryScreen() {
  const c = client.value;
  const [tab, setTab] = useState<'all' | Category>('all');
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(torrents.value.length > 0);
  const [focusedHash, setFocusedHash] = useState<string | null>(null);
  progressVersion.value; // re-render when progress changes

  const load = (isDead?: () => boolean) => {
    if (!c) return;
    const before = torrents.value;
    refreshTorrents(c).then(
      (list) => {
        if (isDead?.()) return;
        const msg = addedMessage(addedTorrents(before, list));
        if (msg) toast(msg);
        setError(null);
        setLoaded(true);
      },
      (e) => { if (isDead?.()) return; setError(errorMessage(e)); setLoaded(true); },
    );
    refreshViewed(c);
  };

  useEffect(() => {
    if (!c) {
      resetTo({ name: 'connect' });
      return;
    }
    let dead = false;
    load(() => dead);
    // picks up torrents added from a phone via the TorrServer web UI
    const timer = setInterval(() => load(() => dead), 10000);
    return () => {
      dead = true;
      clearInterval(timer);
    };
  }, [c]);

  const showingError = !!error && !torrents.value.length;
  useEffect(() => {
    if (loaded && !showingError) restoreFocus(torrents.value.length ? 'LIB-GRID' : 'LIB-HEADER');
  }, [loaded, showingError]);

  const remove = (hash: string) => {
    const t = torrents.value.find((x) => x.hash === hash);
    confirmDialog('Удалить «' + (t ? t.title : hash) + '»?', 'Удалить').then((ok) => {
      if (!ok || !c) return;
      c.remove(hash).then(
        () => { torrents.value = torrents.value.filter((x) => x.hash !== hash); setFocusedHash(null); toast('Торрент удалён'); },
        (e) => toast(errorMessage(e), 'error'),
      );
    });
  };

  useKeys((a) => {
    if (a === 'red' && focusedHash) { remove(focusedHash); return true; }
    if (a === 'blue') { navigate({ name: 'settings' }); return true; }
    return false;
  });

  if (!c) return null;

  const resume = (e: { torrent: Torrent; fileIndex: number; progress: Progress }) => {
    const queue = buildTorrentQueue(c, e.torrent, c.files(e.torrent));
    const index = queue.findIndex((q) => q.fileIndex === e.fileIndex);
    if (index < 0) navigate({ name: 'torrent', hash: e.torrent.hash });
    else navigate({ name: 'player', queue, index, startAt: e.progress.time });
  };

  if (error && !torrents.value.length) {
    return (
      <div class="screen">
        <ErrorView
          message={'Не удалось загрузить список торрентов\n' + error}
          actions={[
            { label: 'Повторить', onPress: () => load() },
            { label: 'Сменить сервер', onPress: () => navigate({ name: 'connect' }) },
          ]}
        />
      </div>
    );
  }

  const list = torrents.value.filter((t) => tab === 'all' || categoryOf(t.category) === tab);
  const cont = tab === 'all' ? continueWatching(torrents.value) : [];

  return (
    <FocusGroup focusKey="LIBRARY" className="screen library">
      <FocusGroup focusKey="LIB-HEADER" className="header">
        {CATEGORY_TABS.map((ct) => (
          <Focusable
            key={ct.id}
            focusKey={'tab-' + ct.id}
            className={'tab' + (tab === ct.id ? ' active' : '')}
            onPress={() => setTab(ct.id)}
            onFocused={() => { setTab(ct.id); setFocusedHash(null); }}
          >
            {ct.label}
          </Focusable>
        ))}
        <div class="spacer" />
        <Button icon="plus" label="Добавить" onPress={() => navigate({ name: 'add' })} onFocused={() => setFocusedHash(null)} />
        <Button label="Плейлист" onPress={() => navigate({ name: 'playlist' })} onFocused={() => setFocusedHash(null)} />
        <Button label="Настройки" onPress={() => navigate({ name: 'settings' })} onFocused={() => setFocusedHash(null)} />
        <Button label="Сервер" onPress={() => navigate({ name: 'connect' })} onFocused={() => setFocusedHash(null)} />
      </FocusGroup>
      {error && <div class="banner-error">{error} — показан сохранённый список</div>}
      {!loaded && <Spinner text="Загрузка…" />}
      {cont.length > 0 && (
        <section>
          <h2>Продолжить просмотр</h2>
          <FocusGroup focusKey="LIB-CONTINUE" className="hscroll">
            {cont.map((e) => {
              const file = c.files(e.torrent).find((f) => f.id === e.fileIndex);
              const name = file ? episodeLabel(file.path) || baseName(file.path) : '';
              return (
                <Focusable key={e.torrent.hash} focusKey={'cont-' + e.torrent.hash} className="wide-card" onPress={() => resume(e)} onFocused={() => setFocusedHash(null)}>
                  <div class="title">{e.torrent.title}</div>
                  <div class="meta">
                    {name} · {formatDuration(e.progress.time)}{e.progress.duration > 0 ? ' / ' + formatDuration(e.progress.duration) : ''}
                  </div>
                  {e.progress.duration > 0 && <ProgressBar ratio={e.progress.time / e.progress.duration} />}
                </Focusable>
              );
            })}
          </FocusGroup>
        </section>
      )}
      <FocusGroup focusKey="LIB-GRID" className="grid">
        {list.map((t) => (
          <PosterCard key={t.hash} t={t} onPress={() => navigate({ name: 'torrent', hash: t.hash })} onFocused={() => setFocusedHash(t.hash)} />
        ))}
      </FocusGroup>
      {loaded && !list.length && <div class="empty">Нет торрентов. Добавьте через «Добавить» или веб-интерфейс TorrServer на телефоне.</div>}
      <div class="hints">OK — открыть · <KeyDot color="red" /> удалить · <KeyDot color="blue" /> настройки · Назад — выход</div>
    </FocusGroup>
  );
}
