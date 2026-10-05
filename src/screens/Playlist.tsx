import { t } from '../i18n';
import { useEffect, useRef, useState } from 'preact/hooks';
import { client } from '../store/servers';
import { request, errorMessage } from '../api/http';
import { parseM3U, isHlsPlaylist, parseStreamUrl, PlaylistEntry } from '../lib/m3u';
import { formatDuration } from '../lib/format';
import type { PlayItem } from '../player/types';
import { navigate, replaceRoute } from '../ui/nav';
import { FocusGroup, Focusable, Button, TextInput, Spinner } from '../ui/components';
import { restoreFocus } from '../ui/focus';
import { favorites, isFavorite, toggleFavorite } from '../store/favorites';
import { toast } from '../ui/toast';

export function PlaylistScreen(p: { url?: string; title?: string }) {
  const c = client.value;
  const alive = useRef(true);
  const req = useRef(0);
  const [url, setUrl] = useState(p.url || '');
  const [entries, setEntries] = useState<PlaylistEntry[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);

  const load = (u: string) => {
    const target = u.trim();
    if (!target) return;
    setBusy(true);
    setError(null);
    setEntries(null);
    setLoadedUrl(null);
    const currentReq = ++req.current;
    const text = c ? c.fetchText(target) : request<string>(target, { responseType: 'text', timeoutMs: 15000 });
    text.then(
      (body) => {
        if (!alive.current || currentReq !== req.current) return;
        setBusy(false);
        if (isHlsPlaylist(body)) {
          replaceRoute({ name: 'player', queue: [{ url: target, title: p.title || target }], index: 0 });
          return;
        }
        const list = parseM3U(body, target);
        if (!list.length) setError(t('playlist.empty'));
        setEntries(list);
        setLoadedUrl(target);
      },
      (e) => {
        if (!alive.current || currentReq !== req.current) return;
        setBusy(false);
        setError(errorMessage(e));
      },
    );
  };

  useEffect(() => {
    if (p.url) load(p.url);
    else restoreFocus('PLAYLIST');
    return () => { alive.current = false; };
  }, []);

  useEffect(() => {
    if (entries && entries.length) restoreFocus('PLAYLIST-ENTRIES');
  }, [entries]);

  const playable = (entries || []).filter((e) => !e.isPlaylist);
  const queue: PlayItem[] = playable.map((e) => {
    const ref = parseStreamUrl(e.url);
    return {
      url: e.url,
      title: e.title,
      poster: e.logo,
      torrentTitle: p.title || undefined,
      hash: ref ? ref.hash : undefined,
      fileIndex: ref ? ref.fileIndex : undefined,
    };
  });

  return (
    <FocusGroup focusKey="PLAYLIST" className="screen playlist">
      <h1>{p.title || t('playlist.title')}</h1>
      {!p.url && (
        <div class="row">
          <TextInput focusKey="pl-url" value={url} onChange={setUrl} placeholder={t('playlist.urlPlaceholder')} type="url" onSubmit={() => load(url)} />
          <Button label={t('playlist.open')} onPress={() => load(url)} />
          {c && (
            <Button
              label={t('playlist.allTorrents')}
              onPress={() => {
                const u = c.allPlaylistUrl();
                setUrl(u);
                load(u);
              }}
            />
          )}
        </div>
      )}
      {!p.url && !entries && favorites.value.length > 0 && (
        <FocusGroup focusKey="PL-FAVORITES">
          <h2>{t('playlist.favorites')}</h2>
          {favorites.value.map((f) => (
            <Focusable key={f.url} focusKey={'fav-' + f.url} className="list-item" onPress={() => navigate({ name: 'playlist', url: f.url, title: f.title })}>
              <div class="title">{f.title}</div>
              <div class="meta">{f.url}</div>
            </Focusable>
          ))}
        </FocusGroup>
      )}
      {busy && <Spinner text={t('playlist.loading')} />}
      {error && <div class="banner-error">{error}</div>}
      {entries && entries.length > 0 && (
        <FocusGroup focusKey="PLAYLIST-ENTRIES">
          {queue.length > 0 && <Button icon="play" label={t('playlist.playAll', { n: queue.length })} onPress={() => navigate({ name: 'player', queue, index: 0 })} />}
          {loadedUrl && (
            <Button
              icon="star"
              label={isFavorite(loadedUrl) ? t('playlist.unfavorite') : t('playlist.favorite')}
              onPress={() => {
                const title = p.title || loadedUrl.split('?')[0].split('/').pop() || loadedUrl;
                toast(toggleFavorite(loadedUrl, title) ? t('playlist.added') : t('playlist.removed'));
              }}
            />
          )}
          {entries.map((e, i) => {
            const playableIndex = e.isPlaylist ? -1 : playable.indexOf(e);
            return (
              <div key={i}>
                {e.group && (i === 0 || entries[i - 1].group !== e.group) && <h2>{e.group}</h2>}
                <Focusable focusKey={'pl-' + i} className="list-item" onPress={() => e.isPlaylist ? navigate({ name: 'playlist', url: e.url, title: e.title }) : navigate({ name: 'player', queue, index: playableIndex })}>
                  <div class="title">{e.title}</div>
                  {e.duration > 0 && <div class="meta">{formatDuration(e.duration)}</div>}
                </Focusable>
              </div>
            );
          })}
        </FocusGroup>
      )}
    </FocusGroup>
  );
}
