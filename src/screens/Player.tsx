import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { client } from '../store/servers';
import { settings, updateSettings } from '../store/settings';
import { SUB_SIZE_OPTIONS, formatOffset, subtitleOffsetOptions } from '../player/subtitleOffset';
import { resumePosition } from '../store/progress';
import type { FfprobeResult } from '../api/types';
import { errorMessage } from '../api/http';
import { formatDuration } from '../lib/format';
import { getTrackPref, saveTrackPref } from '../store/trackPrefs';
import { pickAudio, pickSub, subPrefFromChoice } from '../player/trackPrefs';
import { parseSubtitles, decodeText, Cue } from '../lib/subtitles';
import { selectAudioTrack, selectTextTrack } from '../platform/webosMedia';
import type { PlayItem } from '../player/types';
import { SeekAccumulator } from '../player/seek';
import { audioOptions, embeddedSubOptions, subtitleMenu, defaultAudioIndex } from '../player/trackOptions';
import { introChapter } from '../player/chapters';
import { useVideoState } from '../player/useVideoState';
import { useProgressSync } from '../player/useProgressSync';
import { useNextEpisode } from '../player/useNextEpisode';
import { useCacheStats } from '../player/useCacheStats';
import { Controls } from '../player/Controls';
import { StatsOverlay, BufferingOverlay, SubtitleOverlay, NextBanner, SkipBanner, PlayerError } from '../player/Overlays';
import { goBack } from '../ui/nav';
import { useKeys } from '../ui/keys';
import { choose } from '../ui/dialog';
import { toast } from '../ui/toast';

interface Props {
  queue: PlayItem[];
  index: number;
  startAt?: number;
}

export function PlayerScreen({ queue, index: startIndex, startAt }: Props) {
  const c = client.value;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [index, setIndex] = useState(startIndex);
  const item = queue[index];
  const [readyFor, setReadyFor] = useState(-1);
  const ready = readyFor === index;
  const subReq = useRef(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [probe, setProbe] = useState<FfprobeResult | null>(null);
  const [controls, setControls] = useState(true);
  const [statsOn, setStatsOn] = useState(settings.value.showStats);
  const [seekTarget, setSeekTarget] = useState<number | null>(null);
  const [audioIdx, setAudioIdx] = useState(-1);
  const [subChoice, setSubChoice] = useState('off');
  const [cues, setCues] = useState<Cue[] | null>(null);
  const [skippedIntro, setSkippedIntro] = useState<number | null>(null);
  const [subOffset, setSubOffset] = useState(0);
  const startPos = useRef(0);
  const userTracks = useRef(false);
  const metaLoaded = useRef(false);
  const probeRef = useRef<FfprobeResult | null>(null);
  probeRef.current = probe;
  const startUsed = useRef(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const src = ready ? (c ? c.videoSrc(item.url) : item.url) : '';
  const vs = useVideoState(videoRef, index + ':' + reloadKey + ':' + src);
  const posRef = useRef({ time: 0, duration: 0 });
  posRef.current = { time: vs.time, duration: vs.duration };
  useProgressSync(c, item, posRef);

  const hasNext = index < queue.length - 1;
  const hasPrev = index > 0;
  const goNext = () => { if (hasNext) setIndex(index + 1); };
  const goPrev = () => { if (hasPrev) setIndex(index - 1); };

  const next = useNextEpisode({
    itemKey: index,
    enabled: settings.value.autoNext,
    hasNext,
    time: vs.time,
    duration: vs.duration,
    ended: vs.ended,
    paused: vs.paused,
    onNext: goNext,
    onEnd: () => goBack(),
  });

  const intro = introChapter(probe, vs.time);
  const showSkip = !!intro && skippedIntro !== intro.start && next.countdown === null;

  const cache = useCacheStats(c, item.hash, statsOn || (ready && vs.buffering));

  const showControls = () => {
    setControls(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      const v = videoRef.current;
      if (v && !v.paused) setControls(false);
    }, 4000);
  };

  // resume decision + ffprobe for every new item
  useEffect(() => {
    setSeekTarget(null);
    seeker.cancel();
    subReq.current++;
    setProbe(null);
    setCues(null);
    setSubOffset(0);
    setSkippedIntro(null);
    setSubChoice('off');
    setAudioIdx(-1);
    userTracks.current = false;
    metaLoaded.current = false;
    showControls();
    let cancelled = false;
    const decide = (): Promise<number> => {
      if (index === startIndex && startAt !== undefined && !startUsed.current) {
        startUsed.current = true;
        return Promise.resolve(startAt);
      }
      if (!item.hash || item.fileIndex === undefined) return Promise.resolve(0);
      const pos = resumePosition(item.hash, item.fileIndex);
      if (pos <= 0) return Promise.resolve(0);
      return choose('Продолжить просмотр?', [
        { label: 'Продолжить с ' + formatDuration(pos), value: pos },
        { label: 'Сначала', value: 0 },
      ]).then((v) => (v === null ? -1 : v));
    };
    decide().then((pos) => {
      if (cancelled) return;
      if (pos < 0) {
        goBack();
        return;
      }
      startPos.current = pos;
      setReadyFor(index);
    });
    if (c && item.hash && item.fileIndex !== undefined) {
      c.probe(item.hash, item.fileIndex).then((p) => { if (!cancelled) setProbe(p); });
    }
    return () => { cancelled = true; };
  }, [index]);

  // release the media pipeline when the <video> is re-keyed (episode change / retry) or removed
  useEffect(() => {
    const v = videoRef.current;
    return () => {
      if (!v) return;
      v.pause();
      v.removeAttribute('src');
      v.load();
    };
  }, [index + ':' + reloadKey]);

  useEffect(() => () => { if (hideTimer.current) clearTimeout(hideTimer.current); }, []);

  const seeker = useMemo(
    () => new SeekAccumulator((t) => {
      const v = videoRef.current;
      if (v) v.currentTime = t;
      setSeekTarget(null);
    }),
    [],
  );
  useEffect(() => () => seeker.cancel(), []);

  const seek = (dir: 1 | -1) => {
    const v = videoRef.current;
    if (!v) return;
    setSeekTarget(seeker.press(dir, v.currentTime, vs.duration, settings.value.seekStep));
    showControls();
  };

  const seekTo = (t: number) => {
    seeker.cancel();
    setSeekTarget(null);
    const v = videoRef.current;
    if (v) v.currentTime = t;
    showControls();
  };

  const togglePause = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      const p = v.play() as Promise<void> | undefined;
      if (p && p.catch) p.catch(() => undefined);
    } else {
      v.pause();
    }
    showControls();
  };

  const applySubChoice = (choice: string) => {
    const v = videoRef.current;
    if (!v) return;
    subReq.current++;
    setSubChoice(choice);
    setCues(null);
    if (choice === 'off') {
      selectTextTrack(v, -1);
      return;
    }
    const token = ++subReq.current;
    const n = +choice.slice(1);
    if (choice.charAt(0) === 'e') {
      selectTextTrack(v, n);
      return;
    }
    selectTextTrack(v, -1);
    const sub = (item.subtitles || [])[n];
    if (!sub || !c) return;
    c.fetchBytes(sub.url).then(
      (buf) => { if (subReq.current === token) setCues(parseSubtitles(decodeText(buf), sub.ext)); },
      (e) => { if (subReq.current === token) toast('Не удалось загрузить субтитры: ' + errorMessage(e), 'error'); },
    );
  };

  const applyDefaultTracks = () => {
    const v = videoRef.current;
    if (!v || userTracks.current) return;
    const s = settings.value;
    const pref = item.hash ? getTrackPref(item.hash) : null;
    const audio = audioOptions(probeRef.current, v);
    const ai = pickAudio(audio, pref, s.audioLang);
    if (ai >= 0) {
      setAudioIdx(ai);
      if (ai !== defaultAudioIndex(audio)) selectAudioTrack(v, ai);
    }
    applySubChoice(pickSub(embeddedSubOptions(probeRef.current, v), item.subtitles || [], pref, s));
  };

  // ffprobe often arrives after metadata: re-apply language defaults
  useEffect(() => {
    if (probe && metaLoaded.current) applyDefaultTracks();
  }, [probe]);

  const onMeta = () => {
    const v = videoRef.current;
    if (!v) return;
    metaLoaded.current = true;
    if (startPos.current > 0) {
      try { v.currentTime = startPos.current; } catch (e) { /* not seekable yet */ }
    }
    applyDefaultTracks();
  };

  const openTrackMenu = () => {
    const v = videoRef.current;
    if (!v) return;
    const audio = audioOptions(probe, v);
    const menu = subtitleMenu(embeddedSubOptions(probe, v), item.subtitles || []);
    const current = menu.find((o) => o.value === subChoice) || menu[0];
    const audioLabel = audio[audioIdx] ? audio[audioIdx].label : 'по умолчанию';
    const sizeLabel = (SUB_SIZE_OPTIONS.find((o) => o.value === settings.value.subSize) || SUB_SIZE_OPTIONS[1]).label;
    const root: { label: string; value: string }[] = [
      { label: 'Аудио: ' + audioLabel, value: 'audio' },
      { label: 'Субтитры: ' + current.label, value: 'subs' },
      { label: 'Размер субтитров: ' + sizeLabel, value: 'size' },
    ];
    if (cues) root.push({ label: 'Сдвиг субтитров: ' + formatOffset(subOffset), value: 'offset' });
    choose('Дорожки', root).then((kind) => {
      if (kind === 'audio') {
        if (audio.length < 2) {
          toast('Других аудиодорожек нет');
          return;
        }
        choose('Аудио', audio.map((a, i) => ({ label: a.label, value: i })), audioIdx).then((i) => {
          if (i === null) return;
          userTracks.current = true;
          setAudioIdx(i);
          selectAudioTrack(v, i);
          if (item.hash) saveTrackPref(item.hash, { audioLang: audio[i].language, audioLabel: audio[i].label });
        });
      } else if (kind === 'subs') {
        choose('Субтитры', menu, subChoice).then((ch) => {
          if (ch === null) return;
          userTracks.current = true;
          applySubChoice(ch);
          if (item.hash) saveTrackPref(item.hash, { sub: subPrefFromChoice(ch, embeddedSubOptions(probe, v), item.subtitles || []) });
        });
      } else if (kind === 'size') {
        choose('Размер субтитров', SUB_SIZE_OPTIONS, settings.value.subSize).then((v) => { if (v) updateSettings({ subSize: v }); });
      } else if (kind === 'offset') {
        choose('Сдвиг субтитров', subtitleOffsetOptions(), subOffset).then((v) => { if (v !== null) setSubOffset(v); });
      }
    });
  };

  const retry = () => {
    startPos.current = posRef.current.time;
    setReloadKey(reloadKey + 1);
  };

  useKeys((a) => {
    if (vs.error) return false; // error view buttons use spatial navigation
    if (next.countdown !== null) {
      if (a === 'enter') { goNext(); return true; }
      if (a === 'back') { next.dismiss(); return true; }
    }
    if (showSkip && intro) {
      if (a === 'enter') { seekTo(intro.end); setSkippedIntro(intro.start); return true; }
      if (a === 'back') { setSkippedIntro(intro.start); return true; }
    }
    switch (a) {
      case 'enter':
      case 'playpause':
        togglePause();
        return true;
      case 'play': {
        const v = videoRef.current;
        if (v && v.paused) togglePause();
        return true;
      }
      case 'pause': {
        const v = videoRef.current;
        if (v && !v.paused) togglePause();
        return true;
      }
      case 'stop':
        goBack();
        return true;
      case 'left':
      case 'rw':
        seek(-1);
        return true;
      case 'right':
      case 'ff':
        seek(1);
        return true;
      case 'up':
      case 'yellow':
        openTrackMenu();
        return true;
      case 'down':
        showControls();
        return true;
      case 'green':
      case 'info':
        setStatsOn(!statsOn);
        return true;
      case 'next':
        goNext();
        return true;
      case 'prev':
        goPrev();
        return true;
      case 'back':
        if (controls && !vs.paused) {
          setControls(false);
          return true;
        }
        goBack();
        return true;
    }
    return false;
  });

  if (!item) return null;

  return (
    <div class="player" onMouseMove={showControls}>
      <video key={index + ':' + reloadKey} ref={videoRef} src={ready ? src : undefined} autoplay onLoadedMetadata={onMeta} />
      <SubtitleOverlay cues={cues} time={vs.time} offset={subOffset} raised={controls} />
      {ready && vs.buffering && !vs.error && <BufferingOverlay cache={cache} />}
      {statsOn && <StatsOverlay cache={cache} probe={probe} />}
      {next.countdown !== null && hasNext && (
        <NextBanner seconds={next.countdown} title={queue[index + 1].title} onNext={goNext} />
      )}
      {showSkip && intro && <SkipBanner onSkip={() => { seekTo(intro.end); setSkippedIntro(intro.start); }} />}
      {(controls || vs.paused) && !vs.error && (
        <Controls
          title={item.title}
          time={vs.time}
          duration={vs.duration}
          paused={vs.paused}
          seekTarget={seekTarget}
          hasPrev={hasPrev}
          hasNext={hasNext}
          onToggle={togglePause}
          onSeekTo={seekTo}
          onPrev={goPrev}
          onNext={goNext}
          onTracks={openTrackMenu}
        />
      )}
      {vs.error && <PlayerError message={vs.error} probe={probe} onRetry={retry} onBack={() => goBack()} />}
    </div>
  );
}
