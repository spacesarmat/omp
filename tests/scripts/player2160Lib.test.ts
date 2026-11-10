import { describe, it, expect } from 'vitest';
// @ts-ignore node builtin, no @types/node in this project
import { readFileSync } from 'node:fs';
import {
  parsePlayerFile,
  comparePlayer,
  commitFromLsRemote,
  playerCoreVersion,
  patchPlayerGradle,
  assessPlayerRelease,
  playerNotes,
  upsertPlayerNotes,
  playerSummary,
} from '../../scripts/player2160-lib.mjs';

const sha = 'ab'.repeat(32);
const tag = 'v0.2.26';
const aar = {
  name: 'player-core-0.2.26.aar',
  size: 16_000_000,
  digest: 'sha256:' + sha,
  browser_download_url: 'https://github.com/spacesarmat/2160player/releases/download/v0.2.26/player-core-0.2.26.aar',
};
const apk = {
  name: '2160player-0.2.26-arm64-v8a-release.apk',
  size: 19_000_000,
  digest: 'sha256:' + 'c'.repeat(64),
  browser_download_url: 'https://github.com/spacesarmat/2160player/releases/download/v0.2.26/2160player-0.2.26-arm64-v8a-release.apk',
};

describe('player2160-lib', () => {
  it('compares versions and peels an annotated tag', () => {
    expect(parsePlayerFile('0.2.25\n')).toBe('0.2.25');
    expect(() => parsePlayerFile('v0.2.25')).toThrow();
    expect(comparePlayer('0.2.26', '0.2.25')).toBe(1);
    expect(comparePlayer('0.2.25', '0.2.25')).toBe(0);
    const remote = [
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa refs/tags/v0.2.26',
      'cae50cfa8b959e3c182f43ca243538ebb30636c1 refs/tags/v0.2.26^{}',
    ].join('\n');
    expect(commitFromLsRemote(remote, 'v0.2.26')).toBe('cae50cfa8b959e3c182f43ca243538ebb30636c1');
  });

  it('accepts a stable release with an aar and an apk, and patches gradle', () => {
    const release = { tag_name: tag, assets: [aar, apk] };
    const ok = assessPlayerRelease(release, '0.2.25');
    expect(ok.ok).toBe(true);
    expect(assessPlayerRelease(release, '0.2.26').ok).toBe(false);
    expect(assessPlayerRelease({ ...release, draft: true }, '0.2.25').ok).toBe(false);
    expect(assessPlayerRelease({ ...release, assets: [aar] }, '0.2.25').reason).toMatch(/apk/);
    expect(playerCoreVersion('version = providers.gradleProperty("playerCoreVersion").getOrElse("0.2.26")')).toBe('0.2.26');
    const gradle = 'implementation \'tv.p2160:player-core:0.2.25\'\n// (v0.2.25)\n';
    expect(patchPlayerGradle(gradle, '0.2.26')).toContain('player-core:0.2.26');
    expect(patchPlayerGradle(gradle, '0.2.26')).toContain('(v0.2.26)');
  });

  it('replaces player lines under «Не выпущено» and keeps the TorrServer line', () => {
    const ru = '# Изменения\n\n## Не выпущено\n\n- [phone] Встроенный плеер 2160 обновлён до 0.2.24. old\n- Встроенный TorrServer обновлён до MatriX.150\n\n## 0.1.0\n\n- a\n';
    const notes = playerNotes('0.2.26', 'cae50cfa8b959e3c182f43ca243538ebb30636c1', 'AC3', false);
    const out = upsertPlayerNotes(ru, notes, false);
    expect(out).toContain('[phone] Встроенный плеер 2160 обновлён до 0.2.26. AC3');
    expect(out).toContain('Встроенный TorrServer обновлён до MatriX.150');
    expect(out).not.toContain('0.2.24');
    const released = '# Изменения\n\n## Не выпущено\n\n- [phone] Встроенный плеер 2160 обновлён до 0.2.24. old\n\n## 0.20.11\n\n- [phone] Встроенный плеер 2160 обновлён до 0.2.24. В AVI поддержаны WMV и VC-1\n';
    const kept = upsertPlayerNotes(released, notes, false);
    expect(kept).toContain('## 0.20.11\n\n- [phone] Встроенный плеер 2160 обновлён до 0.2.24. В AVI поддержаны WMV и VC-1');
    expect(kept).not.toContain('0.2.24. old');
    expect(playerSummary('**Звук**\n\nAC3 \u2014 fix\n\n**English:**\n\nOther')).toBe('Звук AC3 - fix');
  });

  it('the committed version matches the player-core coordinate', () => {
    const version = parsePlayerFile(readFileSync('player2160.version', 'utf8'));
    expect(readFileSync('android/app/build.gradle', 'utf8')).toContain("tv.p2160:player-core:" + version);
  });
});
