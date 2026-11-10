import { useEffect, useState } from 'preact/hooks';
import type { TorrServerClient } from '../api/torrserver';
import { normalizeLang } from '../lib/tracks';
import { probeTracks, prefForStart, rememberTracks, type ProbeTrack } from './tracks';

export function useTrackChoice(c: TorrServerClient | null, hash: string, title: string, fileId: number | null) {
  const [audio, setAudio] = useState<ProbeTrack[]>([]);
  const [subs, setSubs] = useState<ProbeTrack[]>([]);
  const [audioI, setAudioI] = useState(0);
  const [subI, setSubI] = useState(-1);
  useEffect(() => {
    setAudio([]);
    setSubs([]);
    setAudioI(0);
    setSubI(-1);
    if (!c || !hash || fileId === null || fileId < 0) return undefined;
    let alive = true;
    c.ffprobeAvailable().then(
      (ok) => {
        if (!ok || !alive) return;
        c.probe(hash, fileId).then(
          (p) => {
            if (!alive || !p) return;
            const list = probeTracks(p);
            setAudio(list.audio);
            setSubs(list.subtitles);
            const pref = prefForStart(hash, title);
            let ai = 0;
            if (pref && pref.audioLabel) {
              for (let i = 0; i < list.audio.length; i++) if (list.audio[i].label === pref.audioLabel) ai = i;
            } else if (pref && pref.audioLang) {
              for (let i = 0; i < list.audio.length; i++) if (list.audio[i].language === pref.audioLang) ai = i;
            }
            setAudioI(ai);
            const sub = pref ? pref.sub : undefined;
            if (sub === 'off') setSubI(-1);
            else if (sub && sub.label) {
              let si = -1;
              for (let i = 0; i < list.subtitles.length; i++) if (list.subtitles[i].label === sub.label) si = i;
              setSubI(si);
            }
          },
          () => undefined,
        );
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [hash, fileId, title, c ? c.baseUrl : '']);

  const cycleAudio = () => {
    if (!audio.length) return;
    const next = (audioI + 1) % audio.length;
    setAudioI(next);
    const tr = audio[next];
    rememberTracks(hash, title, { audioLang: normalizeLang(tr.language), audioLabel: tr.label });
  };
  const cycleSub = () => {
    const next = subI + 1 >= subs.length ? -1 : subI + 1;
    setSubI(next);
    if (next < 0) rememberTracks(hash, title, { sub: 'off' });
    else rememberTracks(hash, title, { sub: { lang: normalizeLang(subs[next].language), label: subs[next].label } });
  };
  return { audio: audio, subs: subs, audioI: audioI, subI: subI, cycleAudio: cycleAudio, cycleSub: cycleSub };
}
