// One audiobook: its audio files from TorrServer, in listening order. A single m4b lists ffprobe chapters
// when the server has them. A tap plays through the phone's current player (the audio player is a later change).
import { useEffect, useState } from 'preact/hooks';
import type { FfprobeResult, Torrent } from '../../../src/api/types';
import { errorMessage } from '../../../src/api/http';
import { formatBytes, formatDuration } from '../../../src/lib/format';
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
import { filesOf, watchOnPhone } from '../watch';
import { sharedResume } from '../lib/sharedProgress';
import { AudiobookBar } from './bar';

const PLAY = 'M8 5v14l11-7z';

export function Book({ hash }: { hash: string }) {
  const c = client.value;
  const listed = torrents.value.find((x) => x.hash === hash);
  const [fetched, setFetched] = useState<Torrent | null | undefined>(undefined);
  const [loaded, setLoaded] = useState<Torrent | null>(null);
  const [probe, setProbe] = useState<FfprobeResult | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const tor = listed || (fetched && fetched.hash ? fetched : undefined);
  const own = tor ? filesOf(tor) : [];
  const allFiles = own.length ? own : loaded ? filesOf(loaded) : [];
  const m4b = singleM4bFile(allFiles);
  const waitingFiles = !!c && !!tor && !own.length && !loaded;

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
    c.loadInfo(hash).then(
      (info) => alive && setLoaded(info),
      () => alive && setLoaded(infoEmpty()),
    );
    return () => {
      alive = false;
    };
  }, [c, hash, !!tor, own.length]);

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

  const play = async (file: TorrentFile, title: string, at: number) => {
    if (!tor || busy) return;
    if (!c) {
      setError(t('audiobooks.noServer'));
      return;
    }
    setBusy(true);
    setError('');
    const withFiles = allFiles.length ? { ...tor, file_stats: allFiles } : tor;
    try {
      await watchOnPhone(c, withFiles, { hash, file, title, at, duration: 0 });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (!tor) {
    const loading = !!c && fetched === undefined;
    return (
      <div class="m-screen" data-route="audiobook">
        <AudiobookBar title={t('audiobooks.title')} />
        <p class="m-muted m-note">{loading ? t('audiobooks.loading') : t('audiobooks.notFound')}</p>
      </div>
    );
  }

  const name = libraryTitle(tor);
  const chapters = m4b && probe ? m4bChapters(m4b, probe) : [];
  const sections = audiobookSections(allFiles);
  const showChapters = chapters.length > 0;

  return (
    <div class="m-screen" data-route="audiobook">
      <AudiobookBar title={name.title} />
      {name.meta && <p class="m-muted m-small">{name.meta}</p>}
      {error && <div class="m-error">{error}</div>}
      {waitingFiles || (m4b && probe === undefined) ? (
        <p class="m-muted m-note" data-book-loading="">
          {t('audiobooks.loading')}
        </p>
      ) : showChapters ? (
        <section class="m-set-group" data-chapters="">
          <div class="m-set-label">{t('audiobooks.chapters')}</div>
          {chapters.map((ch) => (
            <TrackRow key={ch.index} label={ch.title} meta={chapterMeta(ch)} busy={busy} onClick={() => void play(ch.file, ch.title, ch.start)} />
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
              {section.tracks.map((tr) => (
                <TrackRow
                  key={tr.file.id}
                  label={tr.label}
                  meta={tr.file.length > 0 ? formatBytes(tr.file.length) : ''}
                  path={tr.file.path}
                  busy={busy}
                  onClick={() => void play(tr.file, tr.label, sharedResume(hash, tr.file.id))}
                />
              ))}
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

/** A failed file list is an empty torrent, so the card can say there are no audio files. */
function infoEmpty(): Torrent {
  return { hash: '', title: '', stat: 0, file_stats: [] };
}

function TrackRow(p: { label: string; meta: string; path?: string; busy: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      class="m-set-row m-set-pick"
      data-track={p.path || p.label}
      disabled={p.busy}
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
