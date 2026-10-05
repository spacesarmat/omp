import { describe, it, expect } from 'vitest';
// @ts-ignore node builtins
import { readdirSync, readFileSync, statSync } from 'node:fs';
// @ts-ignore
import { join } from 'node:path';

/** Files still to migrate (each migration task removes its own; Task 14 leaves it empty). */
const PENDING: string[] = [
  'mobile/src/addResult.ts',
  'mobile/src/cloudflare.ts',
  'mobile/src/donate.ts',
  'mobile/src/faq.ts',
  'mobile/src/install/InstallBox.tsx',
  'mobile/src/install/devices.ts',
  'mobile/src/install/facts.ts',
  'mobile/src/install/installer.ts',
  'mobile/src/install/session.ts',
  'mobile/src/lib/backup.ts',
  'mobile/src/main.tsx',
  'mobile/src/monitor/host.ts',
  'mobile/src/monitor/page.ts',
  'mobile/src/monitor/text.ts',
  'mobile/src/monitor/ui.ts',
  'mobile/src/platform/native.ts',
  'mobile/src/platform/qr.ts',
  'mobile/src/screens/Add.tsx',
  'mobile/src/screens/Backup.tsx',
  'mobile/src/screens/Connect.tsx',
  'mobile/src/screens/Faq.tsx',
  'mobile/src/screens/FlareSolverr.tsx',
  'mobile/src/screens/InstallAssistant.tsx',
  'mobile/src/screens/Library.tsx',
  'mobile/src/screens/LocalServer.tsx',
  'mobile/src/screens/Log.tsx',
  'mobile/src/screens/Monitor.tsx',
  'mobile/src/screens/News.tsx',
  'mobile/src/screens/NowPlaying.tsx',
  'mobile/src/screens/Remote.tsx',
  'mobile/src/screens/ServerSettings.tsx',
  'mobile/src/screens/Settings.tsx',
  'mobile/src/screens/SourceSite.tsx',
  'mobile/src/screens/Sources.tsx',
  'mobile/src/screens/SourcesIndexers.tsx',
  'mobile/src/screens/SubFindings.tsx',
  'mobile/src/screens/Torrent.tsx',
  'mobile/src/screens/Tv.tsx',
  'mobile/src/server/localServer.ts',
  'mobile/src/supportCode.ts',
  'mobile/src/tv/ssap.ts',
  'mobile/src/tv/tvClient.ts',
  'mobile/src/ui/BrowserLoginButton.tsx',
  'mobile/src/ui/CatalogUnavailable.tsx',
  'mobile/src/ui/CodeSheet.tsx',
  'mobile/src/ui/DonateSheet.tsx',
  'mobile/src/ui/LaunchError.tsx',
  'mobile/src/ui/MiniPlayer.tsx',
  'mobile/src/ui/NavBar.tsx',
  'mobile/src/ui/OldTvDialog.tsx',
  'mobile/src/ui/RenameSheet.tsx',
  'mobile/src/ui/ReplaceSheet.tsx',
  'mobile/src/ui/ResultCard.tsx',
  'mobile/src/ui/ResumeSheet.tsx',
  'mobile/src/ui/Sheet.tsx',
  'mobile/src/ui/SubSheet.tsx',
  'mobile/src/ui/TorrentRenameSheet.tsx',
  'mobile/src/ui/TouchpadSheet.tsx',
  'mobile/src/ui/TrackerLogin.tsx',
  'mobile/src/ui/TracksSheet.tsx',
  'mobile/src/ui/TvChip.tsx',
  'mobile/src/ui/UpdateSheet.tsx',
  'mobile/src/ui/WhatsNewSheet.tsx',
  'mobile/src/ui/useResultRows.tsx',
  'mobile/src/watch.ts',
  'src/app.tsx',
  'src/monitor/replace.ts',
  'src/player/Controls.tsx',
  'src/player/DonateCard.tsx',
  'src/player/Overlays.tsx',
  'src/player/chapters.ts',
  'src/player/nativeEngine.ts',
  'src/player/nativePlayer.ts',
  'src/player/resume.ts',
  'src/player/stats.ts',
  'src/player/subtitleOffset.ts',
  'src/player/trackOptions.ts',
  'src/player/useVideoState.ts',
  'src/screens/Add.tsx',
  'src/screens/Connect.tsx',
  'src/screens/Library.tsx',
  'src/screens/NativePlayer.tsx',
  'src/screens/PairPhone.tsx',
  'src/screens/Player.tsx',
  'src/screens/Playlist.tsx',
  'src/screens/Settings.tsx',
  'src/screens/Sources.tsx',
  'src/screens/Torrent.tsx',
  'src/screens/Update.tsx',
  'src/screens/connect/EditServerDialog.tsx',
  'src/screens/connect/ServerHistory.tsx',
  'src/ui/MarksDialog.tsx',
  'src/ui/TopBar.tsx',
  'src/ui/TrackerLoginDialog.tsx',
  'src/ui/UpdateDialog.tsx',
  'src/ui/WhatsNewDialog.tsx',
  'src/ui/components.tsx',
  'src/ui/dialog.tsx',
];
/** Not copy: tracker parsers and patterns (reason each). */
const ALLOWLIST: { [file: string]: string } = {
  'src/i18n/ru.ts': 'the Russian dictionary',
  'src/i18n/languageNames.ts': 'language names in their own language',
  'mobile/src/faq.ru.ts': 'Russian FAQ texts',
  'src/lib/faqLinks.ts': 'FAQ question keys, matched by text against the Russian FAQ (faq.ru.ts)',
  'src/lib/librarySearch.ts': 'title matching (ё→е normalization)',
  'src/lib/tracks.ts': 'language names in their own language and audio-language tokens of file names (parsing)',
  'src/monitor/episodes.ts': 'tracker page parsing (season/episode patterns in tracker titles)',
  'src/sources/bigfangroup.ts': 'tracker page parsing (the site «nothing found» text)',
  'src/sources/html.ts': 'tracker page parsing (relative dates «вчера»)',
  'src/sources/kinozal.ts': 'tracker page parsing (copy migrated): category labels matched by the category mapper, «сейчас» in dates',
  'src/sources/merge.ts': 'tracker title matching (ё→е normalization)',
  'src/sources/rustorka.ts': 'tracker page parsing (copy migrated): the login form value sent to the site',
  'src/sources/rutracker.ts': 'tracker page parsing (login form value, «дн» in the seeders cell)',
};

function files(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.(ts|tsx)$/.test(n) && !/\.d\.ts$/.test(n)) out.push(p.replace(/\\/g, '/'));
  }
  return out;
}

/** Cyrillic in string/template literals or JSX text; comments are stripped first. */
export function russianCopy(src: string): string[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  const hits: string[] = [];
  const re = /(['"`])((?:\\.|(?!\1)[^\\\n])*[А-Яа-яЁё](?:\\.|(?!\1)[^\\\n])*)\1|>([^<>{}]*[А-Яа-яЁё][^<>{}]*)</g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) hits.push((m[2] || m[3]).trim());
  return hits;
}

describe('no Russian copy outside the dictionaries', () => {
  const all = files('src').concat(files('mobile/src'));
  it('every file with Russian copy is migrated, allowlisted or still pending', () => {
    const offenders = all.filter((f) => !ALLOWLIST[f] && PENDING.indexOf(f) < 0 && russianCopy(readFileSync(f, 'utf8')).length > 0);
    expect(offenders).toEqual([]);
  });
  it('PENDING lists only files that still have Russian copy', () => {
    const done = PENDING.filter((f) => all.indexOf(f) < 0 || russianCopy(readFileSync(f, 'utf8')).length === 0);
    expect(done).toEqual([]);
  });
});
