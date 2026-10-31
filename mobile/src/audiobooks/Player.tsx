// The audiobook player: play/pause, ±30s, previous/next chapter, speed and a sleep timer.
// Sound, the shade and the lock screen belong to the native session. This screen only drives it.
import { useEffect, useState } from 'preact/hooks';
import { AUDIO_SEEK_MS, AUDIO_SPEEDS, SLEEP_CHOICES, trackPlace } from '../../../src/lib/audiobookPlayback';
import { formatDuration } from '../../../src/lib/format';
import { saveProgress } from '../../../src/store/progress';
import { t } from '../../../src/i18n';
import type { AudioPlayState } from '../platform/native';
import { audioBridge, audioLaunch, audioNow, rememberAudio } from './launch';
import { AudiobookBar } from './bar';
import { useHint } from '../ui/Hint';

const SLEEP_LABEL: { [k: string]: () => string } = {
  off: () => t('audiobooks.sleepOff'),
  '15': () => t('audiobooks.sleep15'),
  '30': () => t('audiobooks.sleep30'),
  '60': () => t('audiobooks.sleep60'),
  chapter: () => t('audiobooks.sleepChapter'),
};

export function AudioPlayer({ hash, token }: { hash: string; token: number }) {
  useHint('audiobookPlayer');
  const launch = audioLaunch.value;
  // token 0 is the notification deep link: the session that is already playing this book.
  const mine = launch && launch.hash === hash && (token === 0 || launch.token === token) ? launch : null;
  const [state, setState] = useState<AudioPlayState | null>(null);
  const [error, setError] = useState('');
  const [speed, setSpeed] = useState(1);
  const [sleep, setSleep] = useState('off');

  useEffect(() => {
    if (!mine) return;
    let alive = true;
    const b = audioBridge();
    const playing = audioNow.value;
    // Opening the item that is already loaded must not rebuild the queue (that resets speed, sleep and position).
    const same = !!(playing && playing.active && playing.token === mine.token && playing.hash === mine.hash);
    const started = same ? b.state() : b.play(mine);
    started.then(
      (s) => {
        if (!alive) return;
        if (!s) setError(t('audiobooks.playerUnavailable'));
        else {
          rememberAudio(s);
          setState(s);
          if (s.error) setError(s.error);
        }
      },
      (err) => alive && setError(err && err.message ? String(err.message) : t('audiobooks.playerUnavailable')),
    );
    const off = b.onState((s) => {
      if (!alive) return;
      rememberAudio(s);
      setState(s);
      if (s.error) setError(s.error);
    });
    return () => {
      alive = false;
      off();
    };
  }, [mine ? mine.token : 0]);

  useEffect(() => {
    if (!mine || !state || !state.active) return;
    const item = mine.items[state.index] || mine.items[mine.start];
    if (!item) return;
    const at = (item.startMs + state.positionMs) / 1000;
    const dur = state.durationMs > 0 ? (item.startMs + state.durationMs) / 1000 : 0;
    if (at >= 1) saveProgress(mine.hash, item.fileId, at, dur);
  }, [state ? state.positionMs : 0, state ? state.index : 0]);

  if (!mine) {
    return (
      <div class="m-screen" data-route="audiobook-player">
        <AudiobookBar title={t('audiobooks.player')} code="P32.1" />
        <p class="m-muted m-note">{t('audiobooks.nothingToPlay')}</p>
      </div>
    );
  }

  const shown = state && state.active ? state : null;
  const index = shown ? shown.index : mine.start;
  const item = mine.items[index] || mine.items[mine.start];
  const place = trackPlace(index, shown && shown.count > 0 ? shown.count : mine.items.length);
  const title = item ? item.title : (shown && shown.title) || mine.book;
  const playing = shown ? shown.playing : false;
  const position = shown ? shown.positionMs : 0;
  const duration = shown ? shown.durationMs : 0;
  const curSpeed = shown ? shown.speed : speed;
  const curSleep = shown ? shown.sleep : sleep;
  const sleepLeft = shown && shown.sleepLeftMs > 0 ? formatDuration(shown.sleepLeftMs / 1000) : '';

  const send = (cmd: 'toggle' | 'play' | 'seek' | 'next' | 'prev' | 'speed' | 'sleep', extra?: { ms?: number; speed?: number; sleep?: string }) => {
    const b = audioBridge();
    if (cmd === 'play' || cmd === 'toggle') setError('');
    b.control({ cmd, ...extra }).then(
      (s) => {
        if (!s) return;
        rememberAudio(s);
        setState(s);
        if (s.error) setError(s.error);
        if (typeof s.speed === 'number') setSpeed(s.speed);
        if (s.sleep) setSleep(s.sleep);
      },
      (err) => setError(err && err.message ? String(err.message) : t('audiobooks.playerUnavailable')),
    );
  };

  return (
    <div class="m-screen" data-route="audiobook-player">
      <AudiobookBar title={mine.book} code="P32.1" />
      <p class="m-audio-place" data-audio-place="">{place}</p>
      <p class="m-audio-title" data-audio-title="">{title}</p>
      <p class="m-audio-time" data-audio-time="">
        {duration > 0
          ? formatDuration(position / 1000) + ' / ' + formatDuration(duration / 1000)
          : formatDuration(position / 1000)}
      </p>
      {duration > 0 && (
        <input
          class="m-audio-range"
          type="range"
          min={0}
          max={duration}
          value={position}
          aria-label={t('audiobooks.player')}
          onChange={(e) => {
            const to = Number((e.target as HTMLInputElement).value);
            send('seek', { ms: to - position });
          }}
        />
      )}
      {error && <div class="m-error">{error}</div>}
      <div class="m-audio-transport">
        <div class="m-audio-chapters" data-audio-row="chapters">
          <button type="button" class="m-btn m-btn-secondary" data-audio="prev" onClick={() => send('prev')}>
            {t('audiobooks.prevChapter')}
          </button>
          <button type="button" class="m-btn m-btn-secondary" data-audio="next" onClick={() => send('next')}>
            {t('audiobooks.nextChapter')}
          </button>
        </div>
        <div class="m-audio-main" data-audio-row="main">
          <button type="button" class="m-btn m-btn-secondary" data-audio="back" onClick={() => send('seek', { ms: -AUDIO_SEEK_MS })}>
            {t('audiobooks.back30')}
          </button>
          <button type="button" class="m-btn m-btn-primary m-audio-toggle" data-audio="toggle" aria-label={playing ? t('audiobooks.pause') : t('audiobooks.resume')} onClick={() => send(playing && !error ? 'toggle' : 'play')}>
            {playing ? t('audiobooks.pause') : t('audiobooks.resume')}
          </button>
          <button type="button" class="m-btn m-btn-secondary" data-audio="forward" onClick={() => send('seek', { ms: AUDIO_SEEK_MS })}>
            {t('audiobooks.forward30')}
          </button>
        </div>
      </div>
      <div data-hint-anchor="audiobookPlayer">
        <section class="m-set-group">
          <div class="m-set-label">{t('audiobooks.speed')}</div>
          <div class="m-audio-chips" role="radiogroup" aria-label={t('audiobooks.speed')} data-audio-speed="">
            {AUDIO_SPEEDS.map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                class={'m-btn m-btn-secondary m-btn-sm' + (curSpeed === n ? ' on' : '')}
                aria-checked={curSpeed === n}
                aria-pressed={curSpeed === n}
                onClick={() => {
                  setSpeed(n);
                  send('speed', { speed: n });
                }}
              >
                {String(n) + '×'}
              </button>
            ))}
          </div>
        </section>
        <section class="m-set-group">
          <div class="m-set-label" data-sleep-label="">
            {t('audiobooks.sleep')}
            {sleepLeft ? ' · ' + sleepLeft : ''}
          </div>
          <div class="m-audio-chips" role="radiogroup" aria-label={t('audiobooks.sleep')} data-audio-sleep="">
            {SLEEP_CHOICES.map((id) => (
              <button
                key={id}
                type="button"
                role="radio"
                class={'m-btn m-btn-secondary m-btn-sm' + (curSleep === id ? ' on' : '')}
                aria-checked={curSleep === id}
                aria-pressed={curSleep === id}
                data-sleep={id}
                onClick={() => {
                  setSleep(id);
                  send('sleep', { sleep: id });
                }}
              >
                {SLEEP_LABEL[id]()}
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
