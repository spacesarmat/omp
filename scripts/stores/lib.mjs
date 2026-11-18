// Store manifest renderer. Same Android versionCode as src/lib/version.ts and android/app/build.gradle.
// Stable tags only: vX.Y.Z or desktop-X.Y.Z. Betas and anything with shell metacharacters are not stable.

export const REPO = 'spacesarmat/omp';
export const WINGET_ID = 'Spacesarmat.OMP';
export const MANIFEST_VERSION = '1.10.0';
export const FLATPAK_ID = 'com.spacesarmat.omp.desktop';

const TAG_RE = /^(?:v|desktop-)\d+\.\d+\.\d+(?:-beta\.\d+)?$/;

export function parseReleaseTag(tag) {
  const raw = String(tag || '').trim();
  if (!TAG_RE.test(raw)) return { tag: raw, version: '', stable: false };
  const version = raw.replace(/^desktop-/, '').replace(/^v/, '');
  return { tag: raw, version, stable: /^\d+\.\d+\.\d+$/.test(version) };
}

export function androidVersionCode(version) {
  const s = String(version || '').trim().replace(/^v/i, '');
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?/.exec(s);
  if (!m) return 0;
  const major = parseInt(m[1], 10);
  const minor = parseInt(m[2], 10);
  const patch = parseInt(m[3], 10);
  const beta = m[4] ? parseInt(m[4], 10) : 0;
  const slot = beta === 0 ? 99 : Math.min(beta, 98);
  return major * 1000000 + minor * 10000 + patch * 100 + slot;
}

export function userBullets(markdown, version) {
  const lines = String(markdown || '').split(/\r?\n/);
  let on = false;
  const out = [];
  for (const line of lines) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      on = heading[1] === version;
      continue;
    }
    if (!on) continue;
    const bullet = /^\s*[-*]\s+(.*\S)\s*$/.exec(line);
    if (!bullet) continue;
    let text = bullet[1];
    if (/^\[tech\]/i.test(text)) continue;
    text = text.replace(/^\[(phone|tv|lg|atv)\]\s*/i, '');
    if (text) out.push(text);
  }
  return out;
}

export function truncateUtf8(text, max) {
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= max) return text;
  let end = max;
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end -= 1;
  const cut = buf.subarray(0, end).toString('utf8');
  const nl = cut.lastIndexOf('\n');
  if (nl > 0) {
    const atNl = cut.slice(0, nl).trimEnd();
    if (atNl && Buffer.byteLength(atNl, 'utf8') <= max) return atNl;
  }
  const trimmed = cut.replace(/\s+\S*$/, '').trimEnd();
  if (trimmed && Buffer.byteLength(trimmed, 'utf8') <= max) return trimmed;
  return cut.trimEnd();
}

export function fastlaneChangelog(markdown, version) {
  const bullets = userBullets(markdown, version);
  const text = bullets.length ? bullets.join('\n') : `OMP ${version}`;
  return truncateUtf8(text, 500);
}

function assetName(version, suffix) {
  return `OMP-${version}-${suffix}`;
}

function byName(assets) {
  const map = new Map();
  for (const asset of assets || []) map.set(asset.name, asset);
  return map;
}

function sha256(asset) {
  const hex = String(asset && asset.digest || '').replace(/^sha256:/i, '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hex)) {
    throw new Error(`bad sha256 for ${asset && asset.name}`);
  }
  return hex;
}

function releaseDate(publishedAt) {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(publishedAt || ''));
  return m ? m[1] : '';
}

function downloadUrl(tag, name) {
  return `https://github.com/${REPO}/releases/download/${tag}/${name}`;
}

export function channelSkip(channel, opts = {}) {
  const token = opts.token || '';
  const listed = opts.listed || '';
  const repo = opts.repo || '';
  if (channel === 'winget') {
    if (!token) return 'WINGET_TOKEN is not set. Winget update PR skipped.';
    if (listed !== 'true') return 'WINGET_LISTED is not true. The first winget-pkgs PR stays manual.';
    return '';
  }
  if (channel === 'snap') {
    if (!token) return 'SNAPCRAFT_STORE_CREDENTIALS is not set. Snap build and upload skipped.';
    return '';
  }
  if (channel === 'homebrew-tap') {
    if (!token || !repo) return 'HOMEBREW_TAP_TOKEN or HOMEBREW_TAP_REPO is not set. External tap push skipped.';
    return '';
  }
  if (channel === 'flathub') {
    if (!token) return 'FLATHUB_TOKEN is not set. Flathub PR skipped.';
    return '';
  }
  if (channel === 'scoop-bucket') {
    if (!token || !repo) return 'SCOOP_BUCKET_TOKEN or SCOOP_BUCKET_REPO is not set. External bucket push skipped.';
    return '';
  }
  return `unknown channel ${channel}`;
}

function wingetInstaller({ version, url, hash, date }) {
  const dateLine = date ? `ReleaseDate: "${date}"\n` : '';
  return `# yaml-language-server: $schema=https://aka.ms/winget-manifest.installer.${MANIFEST_VERSION}.schema.json
PackageIdentifier: ${WINGET_ID}
PackageVersion: ${version}
Platform:
  - Windows.Desktop
MinimumOSVersion: 10.0.17763.0
InstallerType: nullsoft
Scope: user
UpgradeBehavior: install
${dateLine}Installers:
  - Architecture: x64
    InstallerUrl: ${url}
    InstallerSha256: ${hash}
    InstallerSwitches:
      Silent: /S
      SilentWithProgress: /S
ManifestType: installer
ManifestVersion: ${MANIFEST_VERSION}
`;
}

function wingetVersion(version) {
  return `# yaml-language-server: $schema=https://aka.ms/winget-manifest.version.${MANIFEST_VERSION}.schema.json
PackageIdentifier: ${WINGET_ID}
PackageVersion: ${version}
DefaultLocale: en-US
ManifestType: version
ManifestVersion: ${MANIFEST_VERSION}
`;
}

function wingetLocale({ version, locale, manifestType, publisher, name, short, description, licenseUrl, packageUrl, privacyUrl }) {
  return `# yaml-language-server: $schema=https://aka.ms/winget-manifest.${manifestType === 'defaultLocale' ? 'defaultLocale' : 'locale'}.${MANIFEST_VERSION}.schema.json
PackageIdentifier: ${WINGET_ID}
PackageVersion: ${version}
PackageLocale: ${locale}
Publisher: ${publisher}
PublisherUrl: https://github.com/spacesarmat
PublisherSupportUrl: https://github.com/${REPO}/issues
PrivacyUrl: ${privacyUrl}
Author: spacesarmat
PackageName: ${name}
PackageUrl: ${packageUrl}
License: GPL-3.0
LicenseUrl: ${licenseUrl}
ShortDescription: ${short}
Description: |-
  ${description}
Moniker: omp
Tags:
  - media-player
  - torrserver
  - video
ReleaseNotesUrl: https://github.com/${REPO}/releases/tag/v${version}
ManifestType: ${manifestType}
ManifestVersion: ${MANIFEST_VERSION}
`;
}

function scoopManifest({ version, url, hash }) {
  const body = {
    version,
    description: 'Media player for TorrServer on Windows',
    homepage: 'https://omp-player.online',
    license: 'GPL-3.0-only',
    architecture: {
      '64bit': { url, hash },
    },
    installer: { args: ['/S', '/D=$dir'] },
    uninstaller: { file: 'uninstall.exe', args: ['/S'] },
    shortcuts: [['omp-desktop.exe', 'OMP']],
    checkver: {
      github: `https://github.com/${REPO}`,
      regex: '/releases/tag/v([\\d.]+)',
    },
    autoupdate: {
      architecture: {
        '64bit': {
          url: `https://github.com/${REPO}/releases/download/v$version/OMP-$version-setup.exe`,
        },
      },
    },
  };
  return `${JSON.stringify(body, null, 2)}\n`;
}

function homebrewCask({ tag, version, arm, intel }) {
  return `cask "omp" do
  arch arm: "arm64", intel: "x64"

  version "${version}"
  sha256 arm:   "${arm}",
         intel: "${intel}"

  url "https://github.com/${REPO}/releases/download/${tag}/OMP-#{version}-macos-#{arch}.dmg",
      verified: "github.com/${REPO}/"
  name "OMP"
  desc "Media player for TorrServer"
  homepage "https://omp-player.online"

  livecheck do
    url :url
    strategy :github_latest
  end

  auto_updates true
  depends_on macos: ">= :big_sur"

  app "OMP.app"

  zap trash: [
    "~/Library/Application Support/com.spacesarmat.omp.desktop",
    "~/Library/Caches/com.spacesarmat.omp.desktop",
    "~/Library/Preferences/com.spacesarmat.omp.desktop.plist",
  ]

  caveats do
    "OMP is not signed with an Apple Developer ID. Open it with a right click and Open, or allow it in Privacy and Security."
  end
end
`;
}

function flatpakManifest({ tag, version, debName, hash, size }) {
  return `app-id: ${FLATPAK_ID}
runtime: org.gnome.Platform
runtime-version: '47'
sdk: org.gnome.Sdk
command: omp-desktop
finish-args:
  - --share=network
  - --share=ipc
  - --socket=fallback-x11
  - --socket=wayland
  - --socket=pulseaudio
  - --device=dri
  - --filesystem=home
modules:
  - name: omp
    buildsystem: simple
    build-commands:
      - bsdtar -xf omp.deb data.tar.gz
      - tar -xzf data.tar.gz
      - install -Dm755 usr/bin/omp-desktop /app/bin/omp-desktop
      - install -Dm644 ${FLATPAK_ID}.desktop /app/share/applications/${FLATPAK_ID}.desktop
      - install -Dm644 ${FLATPAK_ID}.metainfo.xml /app/share/metainfo/${FLATPAK_ID}.metainfo.xml
      - install -Dm644 usr/share/icons/hicolor/512x512/apps/omp-desktop.png /app/share/icons/hicolor/512x512/apps/${FLATPAK_ID}.png
      - install -Dm644 usr/share/icons/hicolor/512x512/apps/omp-desktop.png /app/share/icons/hicolor/512x512/apps/omp-desktop.png
    sources:
      - type: file
        path: ${FLATPAK_ID}.desktop
      - type: file
        path: ${FLATPAK_ID}.metainfo.xml
      - type: file
        dest-filename: omp.deb
        url: ${downloadUrl(tag, debName)}
        sha256: ${hash}
        size: ${size}
        x-checker-data:
          type: json
          url: https://api.github.com/repos/${REPO}/releases/latest
          version-query: .tag_name | sub("^v"; "")
          url-query: .assets[] | select(.name | test("-linux-x64.deb$")) | .browser_download_url
          timestamp-query: .published_at
`;
}

function metainfo({ version, date }) {
  const dateAttr = date ? ` date="${date}"` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<component type="desktop-application">
  <id>${FLATPAK_ID}</id>
  <name>OMP</name>
  <summary>Media player for TorrServer</summary>
  <metadata_license>CC0-1.0</metadata_license>
  <project_license>GPL-3.0-only</project_license>
  <developer id="com.spacesarmat">
    <name>spacesarmat</name>
  </developer>
  <description>
    <p>OMP plays movies and series from a TorrServer on the home network. This package is the Linux desktop app, installed from the GitHub release.</p>
  </description>
  <launchable type="desktop-id">${FLATPAK_ID}.desktop</launchable>
  <url type="homepage">https://omp-player.online</url>
  <url type="bugtracker">https://github.com/${REPO}/issues</url>
  <url type="vcs-browser">https://github.com/${REPO}</url>
  <content_rating type="oars-1.1"/>
  <releases>
    <release version="${version}"${dateAttr}/>
  </releases>
</component>
`;
}

function snapcraft({ tag, version, debName }) {
  return `name: omp-player
title: OMP
base: core24
version: '${version}'
summary: Media player for TorrServer
description: |
  OMP plays movies and series from a TorrServer on the home network.
  This snap packages the Linux desktop build from GitHub Releases.
grade: stable
confinement: strict
license: GPL-3.0
platforms:
  amd64:
    build-on: [amd64]
    build-for: [amd64]
apps:
  omp:
    command: usr/bin/omp-desktop
    extensions:
      - gnome
    plugs:
      - network
      - home
      - removable-media
      - audio-playback
      - desktop
      - desktop-legacy
      - wayland
      - x11
      - opengl
parts:
  omp:
    plugin: nil
    source: ${downloadUrl(tag, debName)}
    source-type: deb
    stage-packages:
      - libwebkit2gtk-4.1-0
      - libgtk-3-0
      - libayatana-appindicator3-1
    override-build: |
      craftctl default
      cp -a usr "$CRAFT_PART_INSTALL/"
`;
}

/** Stable fixtures whose version equals the winget directory being checked. */
export function matchingFixtures(releases, version) {
  return (releases || []).filter((release) => {
    const parsed = parseReleaseTag(release.tag || release.tagName || '');
    return parsed.stable && parsed.version === version;
  });
}

/** The five desktop assets the store renderer reads, in a stable order. */
export function releaseFixture(release, version) {
  const names = [
    `OMP-${version}-setup.exe`,
    `OMP-${version}-macos-arm64.dmg`,
    `OMP-${version}-macos-x64.dmg`,
    `OMP-${version}-linux-x64.deb`,
    `OMP-${version}-linux-x64.AppImage`,
  ];
  const by = new Map((release.assets || []).map((asset) => [asset.name, asset]));
  return {
    tag: release.tag || release.tagName,
    prerelease: false,
    publishedAt: release.publishedAt,
    assets: names.filter((name) => by.has(name)).map((name) => {
      const asset = by.get(name);
      return { name: asset.name, digest: asset.digest, size: asset.size };
    }),
  };
}

export function planRelease(release, extras = {}) {
  const tag = release.tag || release.tagName || '';
  const parsed = parseReleaseTag(tag);
  const prerelease = Boolean(release.prerelease || release.isPrerelease);
  if (prerelease || !parsed.stable) {
    return { skip: `not a stable release: ${tag}`, version: parsed.version, tag, files: {} };
  }
  const version = parsed.version;
  const assets = byName(release.assets);
  const names = {
    setup: assetName(version, 'setup.exe'),
    dmgArm: assetName(version, 'macos-arm64.dmg'),
    dmgIntel: assetName(version, 'macos-x64.dmg'),
    deb: assetName(version, 'linux-x64.deb'),
    appimage: assetName(version, 'linux-x64.AppImage'),
  };
  const missing = Object.values(names).filter((name) => !assets.has(name));
  if (missing.length) {
    return { skip: `missing ${missing.join(', ')}`, version, tag: parsed.tag, files: {} };
  }
  const debSize = Number(assets.get(names.deb).size);
  if (!Number.isFinite(debSize) || debSize <= 0) {
    return { skip: `missing size for ${names.deb}`, version, tag: parsed.tag, files: {} };
  }
  const setup = assets.get(names.setup);
  const deb = assets.get(names.deb);
  const date = releaseDate(release.publishedAt);
  const wingetDir = `packaging/winget/manifests/s/Spacesarmat/OMP/${version}`;
  const code = String(androidVersionCode(version));
  const ruLog = fastlaneChangelog(extras.changelog || '', version);
  const enLog = fastlaneChangelog(extras.changelogEn || '', version);
  const files = {
    [`${wingetDir}/Spacesarmat.OMP.yaml`]: wingetVersion(version),
    [`${wingetDir}/Spacesarmat.OMP.installer.yaml`]: wingetInstaller({
      version,
      url: downloadUrl(parsed.tag, names.setup),
      hash: sha256(setup),
      date,
    }),
    [`${wingetDir}/Spacesarmat.OMP.locale.en-US.yaml`]: wingetLocale({
      version,
      locale: 'en-US',
      manifestType: 'defaultLocale',
      publisher: 'spacesarmat',
      name: 'OMP',
      short: 'Media player for TorrServer on the home network',
      description: 'OMP plays movies and series from a TorrServer on the home network. This package installs the Windows desktop app for Windows 10 and 11 (x64).',
      licenseUrl: `https://github.com/${REPO}/blob/v${version}/LICENSE`,
      packageUrl: 'https://omp-player.online',
      privacyUrl: 'https://omp-player.online/privacy/en',
    }),
    [`${wingetDir}/Spacesarmat.OMP.locale.ru-RU.yaml`]: wingetLocale({
      version,
      locale: 'ru-RU',
      manifestType: 'locale',
      publisher: 'spacesarmat',
      name: 'OMP',
      short: 'Медиаплеер для TorrServer в домашней сети',
      description: 'OMP показывает фильмы и сериалы с TorrServer в домашней сети. Этот пакет ставит компьютерную версию для Windows 10 и 11 (x64).',
      licenseUrl: `https://github.com/${REPO}/blob/v${version}/LICENSE`,
      packageUrl: 'https://omp-player.online',
      privacyUrl: 'https://omp-player.online/privacy',
    }),
    'bucket/omp.json': scoopManifest({
      version,
      url: downloadUrl(parsed.tag, names.setup),
      hash: sha256(setup),
    }),
    'packaging/homebrew/Casks/omp.rb': homebrewCask({
      tag: parsed.tag,
      version,
      arm: sha256(assets.get(names.dmgArm)),
      intel: sha256(assets.get(names.dmgIntel)),
    }),
    [`packaging/flatpak/${FLATPAK_ID}.yml`]: flatpakManifest({
      tag: parsed.tag,
      version,
      debName: names.deb,
      hash: sha256(deb),
      size: debSize,
    }),
    [`packaging/flatpak/${FLATPAK_ID}.metainfo.xml`]: metainfo({ version, date }),
    'packaging/snap/snapcraft.yaml': snapcraft({ tag: parsed.tag, version, debName: names.deb }),
    [`fastlane/metadata/android/en-US/changelogs/${code}.txt`]: `${enLog}\n`,
    [`fastlane/metadata/android/ru-RU/changelogs/${code}.txt`]: `${ruLog}\n`,
  };
  return { skip: '', version, tag: parsed.tag, files };
}

export function renderRelease({ release, changelog, changelogEn }) {
  return planRelease(release, { changelog, changelogEn }).files;
}
