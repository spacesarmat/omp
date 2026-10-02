import { describe, it, expect } from 'vitest';
import { changelogNotes, buildHomebrew, APP_ID, FEED_BASE } from '../../scripts/hb-lib.mjs';
import { sanitizeUpdateInfo } from '../../src/lib/updateInfo';

const MD = '# Изменения\n\n## 0.6.0\n\n- Окно обновления\n* Параметры запуска\n\n## 0.5.0\n\n- Новый каталог\n';

describe('hb-lib', () => {
  it('extracts notes for one version', () => {
    expect(changelogNotes(MD, '0.6.0')).toEqual(['Окно обновления', 'Параметры запуска']);
    expect(changelogNotes(MD, '0.5.0')).toEqual(['Новый каталог']);
    expect(changelogNotes(MD, '0.4.0')).toEqual([]);
    expect(changelogNotes(MD.replace(/\n/g, '\r\n'), '0.6.0')).toHaveLength(2);
  });
  it('builds manifest, repository and update feed', () => {
    const sha = 'e'.repeat(64);
    const r = buildHomebrew({
      tag: 'v0.6.0', version: '0.6.0', ipkName: 'com.spacesarmat.torrplayer_0.6.0_all.ipk', sha256: sha, size: 123,
      title: 'OMP', description: 'Open Movie Player', notes: ['Окно обновления'],
    }) as any;
    const ipkUrl = 'https://github.com/spacesarmat/omp/releases/download/v0.6.0/com.spacesarmat.torrplayer_0.6.0_all.ipk';
    expect(r.manifest).toEqual({
      id: APP_ID, version: '0.6.0', type: 'web', title: 'OMP', appDescription: 'Open Movie Player',
      iconUri: 'https://raw.githubusercontent.com/spacesarmat/omp/main/webos/largeIcon.png',
      sourceUrl: 'https://github.com/spacesarmat/omp', rootRequired: false, ipkUrl, ipkHash: { sha256: sha }, ipkSize: 123,
    });
    expect(r.apps.packages).toHaveLength(1);
    expect(r.apps.packages[0]).toMatchObject({
      id: APP_ID, title: 'OMP', pool: 'main', shortDescription: 'Open Movie Player',
      manifestUrl: FEED_BASE + APP_ID + '.manifest.json', manifest: r.manifest,
    });
    expect(r.update).toEqual({
      version: '0.6.0', ipkUrl, ipkHash: sha, ipkSize: 123, notes: ['Окно обновления'],
      releaseUrl: 'https://github.com/spacesarmat/omp/releases/tag/v0.6.0',
    });
    expect(sanitizeUpdateInfo(r.update)).toEqual(r.update);
  });
});
