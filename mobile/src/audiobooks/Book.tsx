// One audiobook: its audio files from TorrServer, in listening order. A single m4b lists ffprobe chapters
// when the server has them. A tap opens the native audiobook player with that queue.
import { useEffect, useState } from 'preact/hooks';
import type { FfprobeResult, Torrent } from '../../../src/api/types';
import { fileListPhase } from '../../../src/lib/audiobookFiles';
import { chapterPlayItem, filePlayItem, type AudioPlayItem } from '../../../src/lib/audiobookPlayback';
import { formatDuration } from '../../../src/lib/format';
import { fmtBytes } from '../../../src/i18n';
import { libraryTitle } from '../../../src/lib/libraryView';
import {
  audiobookSections,
  m4bChapters,
  singleM4bFile,
  type AudiobookChapter,
} from '../../../src/lib/audiobookTracks';
import type { TorrentFile } from '../../../src/lib/episodes';
import { t } from '../../../src/i18n';
import { torrents } from '../../../src/store/library';
import { client } from '../../../src/store/servers';
import { Icon } from '../ui/Icon';
import { filesOf, recordPhoneWatch, streamUrlFor } from '../watch';
import { sharedResume } from '../lib/sharedProgress';
import { audioBridge, audioNow, currentLaunch, setAudioLaunch } from './launch';
import { navigate } from '../nav';
import { AudiobookBar } from './bar';

const PLAY = 'M8 5v14l11-7z';
/** Poll get() while metadata is still missing. /stream?stat is not used: a timeout there closes the torrent. */
const FILE_POLL_MS = 3000;
const FILE_POLL_TRIES = 40;

type Phase = 'wait' | 'ready' | 'empty' | 'timeout';

export function Book({ hash }: { hash: string }) {
  const c = client.value;
  const listed = torrents.value.find((x) => x.hash === hash);
  const [fetched, setFetched] = useState<Torrent | null | undefined>(undefined);
  const [loaded, setLoaded] = useState<Torrent | null>(null);
  const [phase, setPhase] = useState<Phase>('wait');
  const [attempt, setAttempt] = useState(0);
  const [probe, setProbe] = useState<FfprobeResult | null | undefined>(undefined);
  const [error, setError] = useState('');
  const tor = listed || (fetched && fetched.hash ? fetched : undefined);
  const own = tor ? filesOf(tor) : [];
  const allFiles = own.length ? own : loaded ? filesOf(loaded) : [];
  const m4b = singleM4bFile(allFiles);
  const filePhase: Phase = own.length ? 'ready' : phase;
  const now = audioNow.value;

  useEffect(() => {
    if (!c || listed) return;
    let alive = true;
    setFetched(undefined);
    c.get(hash).then(
      (r) => alive && setFetched(r && r.hash ? r : null),
      () => alive && setFetched(null),
    );
    return () => {
      alive = false;
    };
  }, [c, hash, !!listed]);

  useEffect(() => {
    if (!c || !tor || own.length) return;
    let alive = true;
    let tries = 0;
    let timer = 0;
    setPhase('wait');
    const fail = () => {
      if (alive) setPhase('timeout');
    };
    const tick = () => {
      c.get(hash).then(
        (info) => {
          if (!alive) return;
          const next = fileListPhase(info);
          if (next === 'ready') {
            setLoaded(info);
            setPhase('ready');
            return;
          }
          if (next === 'empty') {
            setLoaded(info);
            setPhase('empty');
            return;
          }
          tries++;
          if (tries >= FILE_POLL_TRIES) {
            setPhase('timeout');
            return;
          }
          timer = window.setTimeout(tick, FILE_POLL_MS);
        },
        fail,
      );
    };
    // A retry re-adds the magnet so a torrent TorrServer closed can come back. Nothing here removes it.
    if (attempt > 0) {
      c.add({
        link: 'magnet:?xt=urn:btih:' + hash,
        title: tor.title,
        category: tor.category || 'audiobook',
      }).then(tick, tick);
    } else tick();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [c, hash, !!tor, own.length, attempt]);

  // Chapters only for a single m4b. probe() is null when TorrServer has no ffprobe.
  useEffect(() => {
    if (!m4b) {
      setProbe(null);
      return;
    }
    if (!c) {
      setProbe(null);
      return;
    }
    let alive = true;
    setProbe(undefined);
    c.probe(hash, m4b.id).then(
      (r) => alive && setProbe(r),
      () => alive && setProbe(null),
    );
    return () => {
      alive = false;
    };
  }, [c, hash, m4b ? m4b.id : -1]);

  const play = (items: AudioPlayItem[], start: number, file: TorrentFile, at: number) => {
    if (!tor) return;
    if (!c) {
      setError(t('audiobooks.noServer'));
      return;
    }
    setError('');
    const item = items[start] || items[0];
    const same = item ? currentLaunch(hash, item.fileId, item.startMs) : null;
    if (same) {
      navigate({ name: 'audiobookPlayer', hash, token: same.token });
      return;
    }
    const open = () => {
      const launch = setAudioLaunch({
        hash,
        book: libraryTitle(tor).title,
        items,
        start,
        positionMs: Math.max(0, Math.round(at * 1000)),
      });
      void recordPhoneWatch(c, hash, file.id, at, 0);
      navigate({ name: 'audiobookPlayer', hash, token: launch.token });
    };
    // The permission dialog belongs on the book card, before the player covers the screen.
    audioBridge().prepare().then(open, open);
  };

  if (!tor) {
    const loading = !!c && fetched === undefined;
    return (
      <div class="m-screen" data-route="audiobook">
        <AudiobookBar title={t('audiobooks.title')} code="P31.1" />
        <p class="m-muted m-note">{loading ? t('audiobooks.loading') : t('audiobooks.notFound')}</p>
      </div>
    );
  }

  const name = libraryTitle(tor);
  const chapters = m4b && probe ? m4bChapters(m4b, probe) : [];
  const sections = audiobookSections(allFiles);
  const showChapters = chapters.length > 0;
  const queue: AudioPlayItem[] = !c
    ? []
    : showChapters
      ? chapters.map((ch) => chapterPlayItem(streamUrlFor(c, tor, ch.file), ch.title, ch.file.id, ch.start, ch.end))
      : sections.reduce((acc, section) => {
          section.tracks.forEach((tr) => acc.push(filePlayItem(streamUrlFor(c, tor, tr.file), tr.label, tr.file.id)));
          return acc;
        }, [] as AudioPlayItem[]);

  return (
    <div class="m-screen" data-route="audiobook">
      <AudiobookBar title={name.title} code="P31.1" />
      {name.meta && <p class="m-muted m-small">{name.meta}</p>}
      {error && <div class="m-error">{error}</div>}
      {filePhase === 'wait' || (m4b && probe === undefined) ? (
        <p class="m-muted m-note" data-book-loading="">
          {t('audiobooks.loading')}
        </p>
      ) : filePhase === 'timeout' ? (
        <div data-files="timeout">
          <p class="m-muted m-note">{t('audiobooks.filesTimeout')}</p>
          <button type="button" class="m-btn m-btn-secondary" data-files="retry" onClick={() => setAttempt((n) => n + 1)}>
            {t('audiobooks.retry')}
          </button>
        </div>
      ) : showChapters ? (
        <section class="m-set-group" data-chapters="">
          <div class="m-set-label">{t('audiobooks.chapters')}</div>
          {chapters.map((ch, i) => (
            <TrackRow
              key={ch.index}
              label={ch.title}
              meta={chapterMeta(ch)}
              playing={!!now && now.hash === hash && now.fileId === ch.file.id && now.startMs === Math.round(ch.start * 1000)}
              onClick={() => play(queue, i, ch.file, ch.start)}
            />
          ))}
        </section>
      ) : sections.length === 0 ? (
        <p class="m-muted m-note" data-empty="audio">
          {t('audiobooks.noAudio')}
        </p>
      ) : (
        <div data-tracks="">
          {sections.map((section) => (
            <section key={section.title || 'root'} class="m-set-group">
              {section.title && <div class="m-set-label">{section.title}</div>}
              {section.tracks.map((tr) => {
                const index = queue.findIndex((item) => item.fileId === tr.file.id && item.title === tr.label);
                return (
                  <TrackRow
                    key={tr.file.id}
                    label={tr.label}
                    meta={tr.file.length > 0 ? fmtBytes(tr.file.length) : ''}
                    path={tr.file.path}
                    playing={!!now && now.hash === hash && now.fileId === tr.file.id && now.startMs === 0}
                    onClick={() => play(queue, index < 0 ? 0 : index, tr.file, sharedResume(hash, tr.file.id))}
                  />
                );
              })}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function chapterMeta(ch: AudiobookChapter): string {
  return ch.start >= 1 ? t('audiobooks.from', { time: formatDuration(ch.start) }) : '';
}

function TrackRow(p: { label: string; meta: string; path?: string; playing?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      class={'m-set-row m-set-pick' + (p.playing ? ' m-track-on' : '')}
      data-track={p.path || p.label}
      data-playing={p.playing ? '' : undefined}
      aria-current={p.playing ? 'true' : undefined}
      aria-label={t('audiobooks.play', { name: p.label })}
      onClick={p.onClick}
    >
      <span class="m-set-text">
        <span>{p.label}</span>
        {p.meta && <span class="m-muted m-small">{p.meta}</span>}
      </span>
      <Icon d={PLAY} size={18} />
    </button>
  );
}
