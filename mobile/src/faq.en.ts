import { HB_REPO_URL, RELEASES_URL } from '../../src/lib/updateInfo';
import type { FaqLine, FaqText } from './faq';

// The English FAQ texts, keyed by item id (same ids and the same number of lines as faq.ru.ts).
// Menu paths use the English UI labels from src/i18n/en.ts.
const TORRSERVER_URL = 'https://github.com/YouROK/TorrServer';
const ROOTING_URL = 'https://www.webosbrew.org/rooting/';
const RELEASE_LINK: FaqLine = { text: 'OMP release on GitHub', url: RELEASES_URL };
const DOWNLOAD_LINK: FaqLine = { text: 'Download the release on GitHub', url: RELEASES_URL };
const TELEGRAM_LINK: FaqLine = { text: 't.me/ompplyaer — the OMP channel on Telegram', url: 'https://t.me/ompplyaer' };

export const FAQ_EN: { [id: string]: FaqText } = {
  // ---- Installation ----
  'lg-version': {
    q: 'Will my TV work?',
    short: [
      'OMP needs webOS 4.0 or newer — roughly TVs from 2018 and later.',
      'Version: Settings → All settings → General → About this TV.',
    ],
    more: [
      'The item names depend on the model year, look for something like this.',
      'TVs of other brands: see the question about Samsung.',
    ],
  },
  'lg-root': {
    q: 'Do I need root?',
    short: [
      'Not necessarily: OMP works fully without root.',
      '1. With root and Homebrew Channel — the easiest way, but not every model has root.',
      '2. Without root — through Developer Mode: you need a computer and an LG account.',
    ],
    more: [
      'There are two ways:',
      '1. With root and Homebrew Channel — the easiest way, but root is available only on some models and firmware versions. Check your model on the sites below.',
      '2. Without root — through Developer Mode. It works on TVs with webOS 4.0+, but you need a computer and an LG developer account.',
      'OMP works fully without root. Homebrew Channel also starts without root, but without the features that need root.',
      { text: 'cani.rootmy.tv — can your model be rooted', url: 'https://cani.rootmy.tv' },
      { text: 'webosbrew.org/rooting — how to get root', url: ROOTING_URL },
    ],
  },
  'lg-devmode': {
    q: 'Install without root (Developer Mode)',
    short: [
      '1. An LG developer account, confirm the email.',
      '2. On the TV: the “Developer Mode” app → sign in, Dev Mode Status and Key Server.',
      '3. On the computer: webOS Dev Manager, add the TV (IP and passphrase).',
      '4. Install Homebrew Channel in Dev Manager.',
      '5. In it, add the OMP repository and install OMP.',
    ],
    more: [
      'The quickest way is from the phone: Settings → “Install OMP on the TV” → choose the TV. The assistant shows the steps and installs OMP itself once you enter the code from Developer Mode (details — in the question “Install from the phone (assistant)”). Below is the manual way through a computer.',
      'Follow the steps strictly in order.',
      '1. Create an LG developer account and confirm the email from the message. One account works on only one TV at a time.',
      '2. On the TV open the LG Content Store, install the “Developer Mode” app and sign in to the account. Turn on Dev Mode Status (the TV restarts), open the app again and turn on Key Server. Write down the TV IP and the passphrase from the screen.',
      '3. On a computer in the same network install webOS Dev Manager (Windows, macOS or Linux) and add the TV: the IP and passphrase from Developer Mode.',
      '4. Install Homebrew Channel in Dev Manager: from its app list or with the .ipk file from the release page.',
      '5. On the TV open Homebrew Channel → Settings → Add repository, add the OMP repository and install OMP. The repository: ' + HB_REPO_URL,
      'If you do not need Homebrew Channel: download OMP-<version>-webOS.ipk from the release page and install it right in Dev Manager.',
      { text: 'LG developer account', url: 'https://webostv.developer.lge.com' },
      { text: 'webOS Dev Manager', url: 'https://github.com/webosbrew/dev-manager-desktop/releases/latest' },
      { text: 'Homebrew Channel (.ipk)', url: 'https://github.com/webosbrew/webos-homebrew-channel/releases/latest' },
      RELEASE_LINK,
    ],
  },
  'lg-hbc': {
    q: 'Install through Homebrew Channel (with root)',
    short: [
      '1. In Homebrew Channel open Settings → Add repository.',
      '2. Add the OMP repository: ' + HB_REPO_URL,
      '3. Find OMP in the list and press “Install”.',
    ],
    more: [
      'Suitable for a rooted TV that already has Homebrew Channel.',
      'The repository can also be added with one button from OMP on the TV: Settings → “Add the OMP repository to Homebrew Channel”.',
      { text: 'How to get root and Homebrew Channel', url: ROOTING_URL },
    ],
  },
  'lg-devmode-expiry': {
    q: 'Developer Mode and 1000 hours',
    short: [
      'Developer Mode lasts 1000 hours (about 40 days), then the apps installed through it are removed from the TV.',
      '1. Open the “Developer Mode” app on the TV in advance.',
      '2. Press the extend (timer reset) button — the countdown starts over.',
    ],
    more: ['If OMP is already gone: reset the timer and install OMP again.'],
  },
  'lg-update': {
    q: 'How to update OMP',
    short: [
      'With Homebrew Channel: in OMP open Settings → “Update”, or update OMP in Homebrew Channel itself.',
      'Without it: download the new OMP-<version>-webOS.ipk and install it again through Dev Manager.',
    ],
    more: [
      'For advanced users: from the command line — npx ares-install --device tv OMP-<version>-webOS.ipk (a configured ares is needed, see the README).',
      RELEASE_LINK,
    ],
  },
  'atv-install': {
    q: 'Install on Android TV',
    short: [
      'It is easier from the phone: Settings → “Install OMP on the TV” (needs “Network debugging”).',
      'Manually:',
      '1. Download the APK from the release page on GitHub: arm64 for a 64-bit system, armv7 for a 32-bit one, the universal OMP-<version>.apk if you are not sure (details — “Which APK to download”).',
      '2. Install the file on the TV: “Downloader”, “Send Files to TV”, a USB drive or adb.',
      '3. Allow installs from unknown sources when the system asks.',
    ],
    more: [
      'It is easier from the phone: Settings → “Install OMP on the TV” installs OMP on Android TV over the network if “Network debugging” is turned on on the box (see the question about the install assistant). If it did not work — the manual way:',
      '1. Download the APK from the release page on GitHub: OMP-<version>-arm64.apk for a 64-bit system, OMP-<version>-armv7.apk for a 32-bit one (many boxes run a 32-bit system even with a 64-bit processor), the universal OMP-<version>.apk if you are not sure (details — the question “Which APK to download”).',
      '2. Install the file on the TV in one of these ways: the “Downloader” app (enter the link), “Send Files to TV” from the phone, a USB drive with a file manager, or adb (see the question about adb).',
      '3. The system asks to allow installs from unknown sources. On Android 8 and newer the permission is given to the app you install from (Downloader, the file manager), not to OMP.',
      DOWNLOAD_LINK,
    ],
  },
  'atv-adb': {
    q: 'Install through adb',
    short: [
      '1. Turn on developer mode: Settings → System → About, press “Build” 7 times.',
      '2. In “Developer options” turn on “Network debugging” (or USB debugging) and find out the TV IP.',
      '3. On the computer: adb connect <IP>:5555, then adb install OMP-<version>.apk.',
    ],
    more: [
      'On Android 11 and newer use “Wireless debugging” instead: it shows a pairing code — first adb pair <IP>:<port> and the code, then adb connect. The install assistant on the phone cannot do this pairing yet — on such boxes install the APK from a computer or another way above.',
    ],
  },
  'atv-boxes': {
    q: 'Which boxes OMP works on',
    short: [
      'OMP works on any Android TV and Google TV with Android 8 and newer.',
      'The built-in TorrServer runs only on 64-bit devices (arm64).',
    ],
    more: ['On 32-bit boxes run TorrServer on another device in the network.'],
  },
  'apk-choice': {
    q: 'Which APK to download',
    short: [
      'Not sure — take the universal OMP-<version>.apk: it fits everything, but is bigger.',
      '64-bit system (almost all modern phones) — OMP-<version>-arm64.apk.',
      '32-bit system (many Android TV boxes, even with a 64-bit processor) — OMP-<version>-armv7.apk.',
      'The install assistant and the updates inside OMP pick the right file themselves.',
    ],
    more: [
      'Every release on GitHub has three APKs: universal (both architectures inside), arm64 and armv7. They have the same version and signature, so any of them installs over another — nothing needs to be removed.',
      'Almost all modern phones run a 64-bit system (arm64). Many Android TV boxes run a 32-bit one (armv7) even with a 64-bit processor: the arm64 file will not install on them (“App not installed”). If you are not sure — install the universal one.',
      'The built-in TorrServer works on devices with a 64-bit processor, whichever APK OMP was installed from.',
      'The update feed in the app and the install assistant choose the APK for the device architecture themselves.',
      'All builds are also published in the OMP Telegram channel: files up to 50 MB are attached to the post, larger ones are given as a GitHub link.',
      TELEGRAM_LINK,
      DOWNLOAD_LINK,
    ],
  },
  'atv-update': {
    q: 'How to update OMP',
    short: ['In OMP on the TV open Settings → “Update” and install the new version.', 'The APK is chosen for the box architecture automatically.'],
  },
  'beta': {
    q: 'Beta versions',
    short: [
      'Want new features first — turn on “Get beta versions”: on the phone in Settings → “Update”, on the TV in “Update” → “Beta versions”.',
      'A beta may have bugs. When the main version is out, OMP offers it and it replaces the beta.',
      'If you turn the switch off, the beta stays until the next main version is out.',
    ],
  },
  'phone-install': {
    q: 'Install OMP on the phone',
    short: [
      '1. Download the APK from the release page on GitHub (usually OMP-<version>-arm64.apk, which to choose — “Which APK to download”) and open the file.',
      '2. Allow the install from the browser or file manager when Android asks.',
      'After that updates come inside the app.',
    ],
    more: ['OMP checks for a new version at launch and offers to install it: the APK for your phone architecture is taken from the update feed.', 'Every release is also posted in the OMP Telegram channel.', TELEGRAM_LINK, DOWNLOAD_LINK],
  },
  'after-install': {
    q: 'What to do after installing',
    short: [
      '1. The phone, the TV and TorrServer must be in the same network.',
      '2. Connect the phone to the TV (the “Connecting” section).',
    ],
    more: [
      'The TV IP: on LG — Settings → Network → Advanced, on Android TV — Settings → Network & Internet (item names depend on the firmware).',
    ],
    by: {
      lg: {
        short: ['1. The phone, the TV and TorrServer must be in the same network.', '2. Connect the phone to the TV: “Connect the phone to the TV” in the “Connecting” section.'],
        more: ['The TV IP: Settings → Network → Advanced (item names depend on the firmware).'],
      },
      atv: {
        short: ['1. The phone, the TV and TorrServer must be in the same network.', '2. Connect the phone to the TV: “Connect the phone to the TV” in the “Connecting” section.'],
        more: ['The TV IP: Settings → Network & Internet (item names depend on the firmware).'],
      },
    },
  },
  'samsung': {
    q: 'Is there OMP for Samsung?',
    short: ['Not yet. Samsung (Tizen) support is planned for a future release.'],
    more: [
      'The install assistant cannot install on Samsung yet: Tizen needs a separate app build, and installing on such a TV works differently than on LG and Android TV. The assistant marks such a TV as “Not supported”.',
    ],
  },
  'apk-fail': {
    q: 'Android says “App not installed”',
    short: [
      '1. If OMP with a different signature is already installed (for example, built by hand), remove the old one first, then install the new one.',
      '2. Check the free space.',
    ],
    more: ['32 or 64 bits does not get in the way of the install: it is the signature or the space.'],
  },
  'lg-gone': {
    q: 'OMP disappeared from the TV',
    short: [
      'Most likely the Developer Mode period (1000 hours) has run out.',
      'Open “Developer Mode”, reset the timer and install OMP again (through Dev Manager or Homebrew Channel).',
    ],
  },
  'devmgr': {
    q: 'Dev Manager does not connect to the TV',
    short: [
      '1. The computer and the TV are in the same network.',
      '2. In “Developer Mode” on the TV, Dev Mode Status and Key Server are turned on.',
      '3. The passphrase is entered exactly as on the TV screen.',
      '4. The TV is not asleep and not turned off.',
    ],
  },
  'helper': {
    q: 'Install from the phone (assistant)',
    short: [
      'Open Settings → “Install OMP on the TV”. The phone and the TV must be in the same network.',
      '1. The assistant looks for LG and Android TV; if it did not find yours — “Enter the IP manually”.',
      '2. LG: enter the code (Passphrase) from “Developer Mode” or install through Homebrew Channel. Android TV: turn on “Network debugging” and allow debugging on the TV.',
      '3. The phone downloads OMP, checks it and installs it.',
    ],
    more: [
      'Open Settings → “Install OMP on the TV” (or the “Install assistant” link on the “TV” screen). The phone and the TV must be in the same network. The assistant looks for LG and Android TV; if the TV was not found, tap “Enter the IP manually”.',
      'For each TV found it shows the model, the system version and whether OMP is already on it. If OMP is already installed and a new version is out, the assistant offers to update.',
      'LG (webOS 4.0 and newer). If Homebrew Channel is already on the TV, OMP can be installed through it or straight from the phone. If not — the way through Developer Mode: an LG developer account, the “Developer Mode” app on the TV, Dev Mode Status and Key Server turned on. Then enter on the phone the code (Passphrase) from the Developer Mode screen: the phone downloads OMP from GitHub, checks the checksum and installs it on the TV. If you wish, the assistant also installs Homebrew Channel.',
      'Developer Mode on LG lasts 1000 hours. After the install the assistant offers a reminder: it arrives in about 928 hours (3 days before the end) — then open “Developer Mode” on the TV and extend the period. The countdown starts from the install, while the Developer Mode timer itself may have started earlier, so it is better to extend the period right after the install. The reminder is set for each TV separately.',
      'Android TV and Google TV. On the box turn on developer mode (Settings → System → About, press “Build” 7 times) and “Network debugging” (port 5555). The assistant connects over the network, “Allow debugging?” appears on the TV — confirm it. Then the phone downloads the APK, checks it and installs it.',
      'Limitation: “Wireless debugging” on Android 11 and newer (pairing by code) is not supported by the phone yet. If the box has no “Network debugging” item, the assistant offers “Download APK”: install it manually or from a computer through adb (see the question about adb).',
      'The phone contacts only the TV and GitHub (to download OMP and Homebrew Channel). The code and keys are needed only during the install and do not get into the log. About security — in the question “Security: Key Server and network debugging”.',
      RELEASE_LINK,
    ],
    by: {
      lg: {
        short: [
          'Open Settings → “Install OMP on the TV”. The phone and the TV must be in the same network.',
          '1. Choose your LG (not in the list — “Enter the IP manually”).',
          '2. If Homebrew Channel is there — install through it. If not — turn on Dev Mode Status and Key Server in “Developer Mode”.',
          '3. Enter on the phone the code (Passphrase) from the Developer Mode screen.',
          '4. The phone downloads OMP, checks the checksum and installs it.',
        ],
        more: [
          'Open Settings → “Install OMP on the TV” (or the “Install assistant” link on the “TV” screen). The phone and the TV must be in the same network. The assistant looks for LG and Android TV; if the TV was not found, tap “Enter the IP manually”.',
          'For each TV found it shows the model, the system version and whether OMP is already on it. If OMP is already installed and a new version is out, the assistant offers to update.',
          'LG (webOS 4.0 and newer). If Homebrew Channel is already on the TV, OMP can be installed through it or straight from the phone. If not — the way through Developer Mode: an LG developer account, the “Developer Mode” app on the TV, Dev Mode Status and Key Server turned on. Then enter on the phone the code (Passphrase) from the Developer Mode screen: the phone downloads OMP from GitHub, checks the checksum and installs it on the TV. If you wish, the assistant also installs Homebrew Channel.',
          'Developer Mode on LG lasts 1000 hours. After the install the assistant offers a reminder: it arrives in about 928 hours (3 days before the end) — then open “Developer Mode” on the TV and extend the period. The countdown starts from the install, while the Developer Mode timer itself may have started earlier, so it is better to extend the period right after the install. The reminder is set for each TV separately.',
          'The phone contacts only the TV and GitHub (to download OMP and Homebrew Channel). The code and keys are needed only during the install and do not get into the log. About security — in the question about Key Server.',
          RELEASE_LINK,
        ],
      },
      atv: {
        short: [
          'Open Settings → “Install OMP on the TV”. The phone and the TV must be in the same network.',
          '1. Turn on developer mode (Settings → System → About, press “Build” 7 times).',
          '2. Turn on “Network debugging” (port 5555).',
          '3. On the TV confirm the “Allow debugging?” prompt.',
          '4. The phone downloads the APK, checks it and installs it.',
        ],
        more: [
          'Open Settings → “Install OMP on the TV” (or the “Install assistant” link on the “TV” screen). The phone and the TV must be in the same network. The assistant looks for LG and Android TV; if the TV was not found, tap “Enter the IP manually”.',
          'For each TV found it shows the model, the system version and whether OMP is already on it. If OMP is already installed and a new version is out, the assistant offers to update.',
          'Android TV and Google TV. On the box turn on developer mode (Settings → System → About, press “Build” 7 times) and “Network debugging” (port 5555). The assistant connects over the network, “Allow debugging?” appears on the TV — confirm it. Then the phone downloads the APK, checks it and installs it.',
          'Limitation: “Wireless debugging” on Android 11 and newer (pairing by code) is not supported by the phone yet. If the box has no “Network debugging” item, the assistant offers “Download APK”: install it manually or from a computer through adb (see the question about adb).',
          'The phone contacts only the TV and GitHub (to download OMP). The code and keys are needed only during the install and do not get into the log. About security — in the question about network debugging.',
          RELEASE_LINK,
        ],
      },
    },
  },
  'safety': {
    q: 'Security: Key Server and network debugging',
    short: [
      'While Key Server (LG) and “Network debugging” (Android TV) are on, every device in your network can reach the TV.',
      'At home that is fine. On a shared network (a hotel, a dorm, open Wi‑Fi) it is better not to install this way.',
      'After the install turn off Key Server and “Network debugging”.',
    ],
    more: [
      'Key Server on LG serves the key over plain HTTP, and “Network debugging” on Android TV opens adb without encryption: while they are on, every device in your home network can reach the TV. If only your own devices are on the network, this is enough.',
      'To turn off: Key Server — in the “Developer Mode” app on LG, “Network debugging” — on Android TV. During the install the phone contacts only the TV and GitHub, nothing else.',
    ],
    by: {
      lg: {
        q: 'Security: Key Server',
        short: [
          'While Key Server is on, every device in your network can reach the TV.',
          'At home that is fine. On a shared network (a hotel, a dorm, open Wi‑Fi) it is better not to install this way.',
          'After the install turn off Key Server in “Developer Mode”.',
        ],
        more: [
          'Key Server on LG serves the key over plain HTTP: while it is on, every device in your home network can reach the TV. If only your own devices are on the network, this is enough.',
          'To turn off: in the “Developer Mode” app on LG. During the install the phone contacts only the TV and GitHub, nothing else.',
        ],
      },
      atv: {
        q: 'Security: network debugging',
        short: [
          'While “Network debugging” is on, every device in your network can reach the TV.',
          'At home that is fine. On a shared network (a hotel, a dorm, open Wi‑Fi) it is better not to install this way.',
          'After the install turn off “Network debugging”.',
        ],
        more: [
          '“Network debugging” on Android TV opens adb without encryption: while it is on, every device in your home network can reach the TV. If only your own devices are on the network, this is enough.',
          'During the install the phone contacts only the TV and GitHub, nothing else.',
        ],
      },
    },
  },

  // ---- Connecting ----
  'lg-connect': {
    q: 'Connect the phone to LG',
    short: [
      '1. Settings → “Choose” in the “TV” section, pick the TV in the list.',
      '2. Press “Allow” on the TV — the phone remembers it.',
    ],
    more: [
      'You do not have to enter the server address: in OMP on the TV open Settings → “Connect a phone”, and on the phone tap “Scan the QR from the TV”.',
    ],
    by: { lg: { q: 'Connect the phone to the TV' } },
  },
  'atv-connect': {
    q: 'Connect the phone to Android TV',
    short: [
      '1. On the TV open OMP: Settings → “Connect a phone” — a 4-digit code appears.',
      '2. On the phone: “TV” → choose “Android TV” → enter the code.',
    ],
    by: { atv: { q: 'Connect the phone to the TV' } },
  },
  'wake': {
    q: 'Turn on the TV from the phone',
    short: [
      'The power button on the remote in OMP turns the TV on over the network.',
      'On the TV turn on “General → Devices → Mobile TV On”.',
    ],
    more: ['On some models this item is called “Turn on via Wi‑Fi”.'],
  },

  // ---- Player ----
  'skip': {
    q: 'Skipping the intro and credits',
    short: [
      'If the file has chapters, OMP takes the intro and credits from them: “Skip intro” appears on the TV, and after the credits the next episode starts.',
      'No chapters — mark the intro by hand in the player menu (start and end).',
      'To turn skipping on: the torrent card → the “Skip” block.',
    ],
    more: [
      'If the file has chapters (intro, credits), OMP takes them from there: the “Skip intro” button appears on the TV, and after the credits the next episode starts right away.',
      'If the file has no chapters, the intro can be marked by hand: in the player menu mark the start and the end of the intro — the marks are remembered for this torrent.',
      'The marks can also be set on the TV itself (LG and Android TV), without the phone: in the torrent card, in the “Skip” block, press OK on the “Intro and credits” row. The window has three values: “Intro from”, “Intro to” and “Credits: last”. The left and right arrows move the value by 5 seconds, and if you hold the arrow — by 30 seconds. “Reset” removes the marks, “Save” remembers them, “Back” closes the window without changes. The marks are shared by the TV and the phone.',
      'Skipping is turned on in the torrent card, in the “Skip” block: “Skip the intro automatically” and “Skip the credits”. The setting is shared by the TV and the phone.',
      'Chapters can be flipped: on the TV remote CH+ and CH− go to the next and previous chapter, and on the “Now playing” screen on the phone there is a chapter list and jump buttons.',
    ],
    by: {
      lg: {
        short: [
          'If the file has chapters, “Skip intro” appears on the TV, and after the credits the next episode starts.',
          'No chapters — mark the intro: the torrent card → “Skip” → OK on “Intro and credits”.',
          'CH+ and CH− on the remote — the next and previous chapter.',
        ],
      },
      atv: {
        short: [
          'If the file has chapters, “Skip intro” appears on the TV, and after the credits the next episode starts.',
          'No chapters — mark the intro: the torrent card → “Skip” → OK on “Intro and credits”.',
          'CH+ and CH− on the remote — the next and previous chapter.',
        ],
      },
      phone: {
        short: [
          'If the file has chapters, OMP takes the intro and credits from them.',
          'No chapters — mark the intro in the player menu (start and end).',
          'To turn skipping on: the torrent card → the “Skip” block.',
          'On “Now playing” there is a chapter list and jump buttons.',
        ],
      },
    },
  },
  'sound-subs': {
    q: 'Sound, subtitles and seeking',
    short: [
      'Seeking, audio tracks and subtitles are on the “Now playing” screen.',
      'The choice is remembered for each torrent.',
    ],
    more: ['If the file has a saved position, the app asks at launch: “Continue” or “From the start”.'],
  },
  'control': {
    q: 'Control playback from the phone',
    short: [
      '“Watch on TV” starts the movie on the TV.',
      'Then “Now playing” and the mini player at the bottom: pause, seeking, episodes, volume.',
    ],
    more: [
      '“Watch on TV” starts the movie on the TV, then the “Now playing” screen and the mini player at the bottom control it: pause, seeking, previous and next episode, volume.',
    ],
  },
  'player-engine': {
    q: 'Player: built-in or VLC',
    short: [
      'Android TV has two players: “Built-in” (the system Android player with the FFmpeg decoder) and VLC.',
      'The choice: Settings → “Player”: “Auto” (the default), “Built-in” or “VLC”.',
      'VLC is needed when the built-in one cannot open a file or you need ASS subtitles with styles (anime). It opens a file a little slower.',
      'For one torrent the player is changed in the player menu: the first row “Change player: … → …”. The choice is remembered for this torrent.',
    ],
    more: [
      'The whole player interface — buttons, chapters, “Skip intro”, the “Support” card, the “Next episode” countdown, remembering the position — is the same in both players. The name of the current player is written at the right of the bottom bar.',
      'When you change the player, playback continues from the same place, and the chosen audio and subtitles are kept.',
      'If VLC cannot start on this device, the “VLC” item in the settings is inactive and labeled “VLC is not available on this device”, and the built-in player plays.',
      'The switch is written to the log (“player: switching to VLC”) without the file name.',
    ],
  },
  'player-auto': {
    q: 'What “Auto” is and when VLC turns on',
    short: [
      'In “Auto” mode OMP starts with the built-in player.',
      'VLC turns on from the same place if the built-in one could not open the file (format or decoder, before the first frame) or ASS/SSA subtitles are selected in the file.',
      'It switches no more than once per viewing and does not go back by itself.',
      'An explicit choice of “Built-in” or “VLC” never switches by itself.',
    ],
    more: [
      'OMP learns about ASS subtitles from the file data a few seconds after the start, so the switch to VLC because of them does not happen instantly, but a couple of seconds into playback. Subtitles that are not shown (turned off) do not call VLC.',
      'If VLC turned on for one episode, it stays for the next episodes of this torrent.',
      'When VLC turns on because of an error, the message “The built-in player could not open this file — VLC is on” appears on the screen.',
      'A manual change in the player menu turns off the automatic decisions until the end of the viewing.',
    ],
  },
  'player-audio': {
    q: 'DTS and TrueHD sound, output to a receiver (passthrough)',
    short: [
      'The built-in player decodes DTS, AC3, E-AC3 and TrueHD itself (FFmpeg), even if the box cannot do it in hardware.',
      'If the TV or receiver accepts such sound “as is” (passthrough), the built-in player first passes it on without decoding.',
      'VLC always decodes the sound to PCM, without passthrough: the receiver gets plain PCM.',
      'No sound — choose another track or change the player in the player menu.',
    ],
    more: [
      'The built-in player order: first the box hardware decoder or passthrough, and only if they are missing — FFmpeg. So with a Dolby or DTS receiver the sound goes without re-encoding.',
      'Software decoding is heavier than hardware: on a weak box with a heavy track it is better to choose another one (AC3, AAC).',
      'Whether passthrough turns on depends on the sound settings of the box and the TV themselves (the HDMI output format); OMP does not change them.',
    ],
  },

  // ---- If something does not work ----
  'no-server': {
    q: 'The TV or the phone does not see the server',
    short: [
      '1. The devices are on the same Wi‑Fi network.',
      '2. Turn the VPN off or allow local network access in it.',
      '3. In the router turn off client isolation (the guest network).',
      '4. On the connection screen tap “Find on network” or enter the address by hand.',
    ],
  },
  'no-sound': {
    q: 'No sound (AC3, DTS)',
    short: [
      'AC3 and DTS play only if the TV or the receiver supports them.',
      '1. Choose another audio track in the player (for example, AAC).',
      '2. Check the sound settings of the TV.',
    ],
    by: {
      atv: {
        short: [
          'The OMP built-in player decodes AC3, DTS and TrueHD itself, but if there is still no sound:',
          '1. Choose another audio track (for example, AAC).',
          '2. Change the player in the player menu: “Change player: Built-in → VLC”.',
          '3. Check the sound settings of the box and the TV.',
        ],
        more: ['Details — in the question about DTS, TrueHD and passthrough.'],
      },
    },
  },
  'notifications': {
    q: 'Notifications are late or do not arrive',
    short: [
      '1. In the battery settings allow OMP to run in the background without restrictions.',
      '2. “Settings → Monitoring”: “Wi-Fi only” skips the check without Wi‑Fi.',
      '3. Allow notifications for OMP in the Android settings.',
      '4. For the “Add” button in the notification the server must be reachable.',
    ],
    more: [
      'Android decides itself when to run background checks and postpones them to save battery. If notifications are rare, open the battery settings for OMP and allow background work without restrictions (on phones of some makers this is called “Autostart” or “Unrestricted”).',
      'The “Wi-Fi only” switch is on in “Settings → Monitoring”: without Wi‑Fi the check is skipped until the next time. The check runs once every few hours — 3 hours by default, the interval is changed in the same place.',
      'Notifications need a permission: OMP asks for it once. If you refused, turn on notifications for OMP in the Android settings; the “Allow notifications” button in “Settings → Monitoring” also leads there. Without the permission you can learn about new items only by opening the “New” tab.',
      'The “Add” button in the notification works even when OMP is closed, but it needs a reachable server: if you use TorrServer on this phone, it must be running. If the server is not reachable, the torrent will not be added, and the new item stays in the “New” tab.',
    ],
  },
  'phone-no-control': {
    q: 'The phone does not control the player on the TV',
    short: [
      '1. The TV needs OMP version 0.8 or newer — update it.',
      '2. The phone and the TV are in the same network.',
      '3. On Android 10+ open OMP on the TV by hand.',
    ],
    more: ['On Android 10+ the TV may not bring OMP to the foreground.'],
    by: {
      lg: {
        short: ['1. The TV needs OMP version 0.8 or newer — update it.', '2. The phone and the TV are in the same network.'],
        more: [],
      },
    },
  },

  // ---- Search and setup ----
  'sources': {
    q: 'Where OMP searches and how to turn on rutracker',
    short: [
      '“Add” searches all the turned-on sources at once and merges identical torrents; a magnet link goes under the search, “Add by magnet link”.',
      'To turn sources on and off: Settings → “Search sources”.',
      'The sources: Jackett and Prowlarr directly, the TorrServer search and the built-in sites: rutor, nnmclub, rutracker, Anidub, BigFANGroup, torrent.by, Kinozal, rustorka.',
      'rutracker, Kinozal and rustorka require sign-in: “Sign in” right on the site row. NNM-Club searches without an account too; it needs the sign-in to download a torrent.',
      'Kinozal, rustorka and NNM-Club are behind the Cloudflare check — see the question “Sites behind Cloudflare”.',
    ],
    more: [
      'On the phone “Add” searches all the turned-on sources at once and merges identical torrents into one row. There are three kinds of sources: Jackett and Prowlarr connected directly (the “Indexers” section), the search of TorrServer itself (rutor and Torznab) and the built-in sites — rutor, nnmclub, rutracker, Anidub, BigFANGroup, torrent.by, Kinozal and rustorka.',
      'Sources are turned on and off in Settings → “Search sources”. It also shows which of them is answering. Kinozal and rustorka are off by default. For Kinozal, rustorka and NNM-Club “Sign in” is right on the site row (on the phone this is the “Built-in · on the phone” group), and › opens the site page: the password sign-in, the Cloudflare bypass, sending the sign-in to the TV.',
      'rutracker requires a sign-in: tap “Sign in” next to it in “Search sources” and enter your rutracker username and password. The password is stored only in the protected Android storage and is sent nowhere except rutracker. If the site asks for a captcha, tap “Sign in with browser”.',
      'If rutracker or another site is behind bot protection (Cloudflare) and has no bypass switch (Kinozal and rustorka have it), the built-in search cannot reach it: connect the tracker through Jackett or Prowlarr, as described in the question “Jackett and Prowlarr: other trackers”.',
      'Android TV has its own “Search sources” screen: Settings → “Search sources”. It has the same switches and the state of each source. You can sign in to a site right on the TV (type the username and password with the remote or with the “Keyboard” on the phone) or send the sign-in from the phone — see the question “Send the sources and sign-ins to Android TV”. LG has no built-in sources: the search goes through TorrServer there.',
    ],
  },
  'sources-transfer': {
    q: 'Send the sources and sign-ins to Android TV',
    short: [
      '1. Connect the phone to Android TV.',
      '2. Settings → “Search sources” → “Send to TV”.',
      'What is sent: the turned-on sources, the Jackett and Prowlarr connections, the FlareSolverr address and the Cloudflare switches.',
      'The “With sign-ins” tick sends the rutracker, Kinozal and rustorka logins too: no need to type the password on the TV.',
    ],
    more: [
      'Connect the phone to Android TV (the question about connecting the phone to the TV). Open Settings → “Search sources”: a card with your TV and the “Send to TV” button appear.',
      'What is sent: the turned-on sources, the connections to Jackett and Prowlarr (with the API keys), the FlareSolverr address and the “Bypass the Cloudflare check” switches. The logins and passwords, and the sign-in through the browser, go only if you keep the tick: they go only to your TV over the pairing channel and are stored there encrypted. You do not need to type a password or a key with the remote.',
      'You can also send the sign-in to one site separately: the “Send the sign-in to the TV” button on the site page.',
      'After sending, the phone shows “Sent”, and on the TV in “Search sources” you can see the time of the last transfer and the phone name. If the login did not fit, the phone shows the reason, and the previous sign-in on the TV does not change. If the TV did not answer, open OMP on the TV and try again.',
      'If the TV has an old OMP version, it does not accept part of the data (connections, sign-ins, Cloudflare): the phone sends the rest and says “update OMP on the TV”.',
      'For LG sending does not work: it has no built-in sources. The pairing channel in the home network is not encrypted — see the question about security.',
    ],
  },
  'jackett': {
    q: 'Jackett and Prowlarr: other trackers',
    short: [
      'Jackett and Prowlarr know hundreds of trackers, including private ones. OMP searches them directly, without TorrServer.',
      '1. Settings → “Search sources” → “Indexers”: OMP looks for them in your network itself (“Search the network”).',
      '2. Found — “Connect” and the API key (in Jackett on the main page, in Prowlarr: Settings → General). Not found — “Add Jackett or Prowlarr” and the address by hand.',
      'Each tracker shows its state: working, sign-in needed, Cloudflare, not responding; “state unknown” — if Jackett is password-protected.',
      'The connection can be sent to Android TV: “Send to TV”.',
    ],
    more: [
      'Install Jackett or Prowlarr on a computer or a server in the same network and add the trackers you need in it (private ones — with your own login). The direct connection works on the phone and Android TV; on LG the search goes only through TorrServer.',
      'The network search looks only at your Wi‑Fi subnet and only at ports 9117 (Jackett) and 9696 (Prowlarr). It starts by itself no more than once a day, and once more with the “Search the network” button. On mobile data the search does not work: connect to Wi‑Fi.',
      'If the TorrServer settings already have a Torznab address and key, OMP offers to connect with that key. When the same Jackett is connected directly, the “Torznab (TorrServer)” source is hidden so the results do not repeat.',
      'States. Jackett: “working”, “sign-in needed”, “Cloudflare”, “not responding”, “error”. If Jackett has an administrator password, OMP does not see the tracker states and writes “state unknown” — it does not affect the search. Prowlarr shows “off” or “error” without a reason.',
      'Key security. The API key is stored in the protected storage of the phone, not in the log, not in the result lists and not in the backup (the backup keeps only the address and the “key set” mark, the key has to be entered again). On Android TV the key arrives over the pairing channel and is also stored encrypted.',
      'If Jackett or Prowlarr is open over plain http outside the home network, the key goes over the network unencrypted: OMP warns about it. Keep them in the home network or behind https.',
      'Through TorrServer: in its web interface open Settings → “Search through Torznab”, turn on “Enable Torznab search”, press “Add server”, enter the address (Jackett http://<address>:9117, Prowlarr http://<address>:9696) and the key. OMP uses this way if there is no direct connection.',
    ],
    by: {
      atv: {
        short: [
          'Jackett and Prowlarr know hundreds of trackers. On the TV you do not need to type the key with the remote: connect them on the phone and send to the TV.',
          '1. On the phone: Settings → “Search sources” → “Indexers” → connect Jackett or Prowlarr.',
          '2. “Send to TV”.',
          '3. On the TV: Settings → “Search sources” → “Indexers”: the trackers and their states are visible.',
          'If the key was not sent, the row says “API key needed — send it from the phone”.',
        ],
      },
      server: {
        short: [
          'The TorrServer search can go to Jackett or Prowlarr: hundreds of trackers, including private ones.',
          '1. Install Jackett or Prowlarr in the same network, add the trackers, copy the API key.',
          '2. In the TorrServer web interface: Settings → “Search through Torznab” → “Add server”.',
          '3. Enter the address (Jackett http://<address>:9117, Prowlarr http://<address>:9696) and the key.',
          'OMP on the phone and Android TV can also connect to them directly — see the question on the “Phone” tab.',
        ],
      },
      lg: {
        short: [
          'Jackett and Prowlarr know hundreds of trackers (including private ones). On LG the search goes through TorrServer.',
          '1. Install Jackett or Prowlarr in the same network, add the trackers, copy the API key.',
          '2. In the TorrServer web interface: Settings → “Search through Torznab” → “Add server”.',
          '3. Enter the address (Jackett http://<address>:9117, Prowlarr http://<address>:9696) and the key.',
          '4. In OMP on the TV, on the search screen choose “Torznab (Jackett)” above the search.',
        ],
        more: [
          'In the TorrServer web interface open Settings → “Search through Torznab”: turn on “Enable Torznab search”, press “Add server”, in “Torznab host URL” enter the Jackett address (usually http://<address>:9117) or Prowlarr (http://<address>:9696), in “API key” — the key.',
          'The key is stored in TorrServer, OMP on the TV does not see it.',
        ],
      },
    },
  },
  'flaresolverr': {
    q: 'How to install FlareSolverr',
    short: [
      'FlareSolverr passes the Cloudflare check instead of OMP. It is needed only if the built-in check does not pass.',
      'Install it with one Docker command on a computer or NAS that is always on:',
      'docker run -d --name flaresolverr -p 8191:8191 --restart unless-stopped ghcr.io/flaresolverr/flaresolverr:latest',
      'In OMP: Settings → “Search sources” → FlareSolverr → “Find on network” or the address http://<address>:8191 → “Check”.',
    ],
    more: [
      'How it works. OMP first passes the check itself with a hidden window inside the app. If that did not work and the FlareSolverr address is set, FlareSolverr passes the check. This concerns only the sites that have “Bypass the Cloudflare check” turned on (Kinozal, rustorka).',
      '1. Install Docker on a computer, a mini PC or a NAS (Windows and macOS — Docker Desktop, Linux and NAS — the docker package).',
      '2. Run the command from the answer above. The container starts by itself after a reboot.',
      '3. Open http://<address>:8191 in a browser — “FlareSolverr is ready!” should appear.',
      '4. In OMP: Settings → “Search sources” → FlareSolverr. “Find on network” looks for port 8191 in your network; “Check” shows the version and the answer time and remembers the address. The address and the state are also visible on Android TV, and from the phone they can be sent to the TV.',
      'FlareSolverr is open without a password: keep it only in the home network and do not forward the port outside.',
      { text: 'github.com/FlareSolverr/FlareSolverr', url: 'https://github.com/FlareSolverr/FlareSolverr' },
    ],
  },
  'cloudflare': {
    q: 'Sites behind Cloudflare: the bypass and “Pass on the phone”',
    short: [
      'Kinozal, rustorka and NNM-Club are behind the Cloudflare check. Each has a “Bypass the Cloudflare check” switch: Settings → “Search sources” → › on the site row. It is off by default.',
      'Signing in with the browser (“Sign in” on the site row) turns the bypass on by itself.',
      'When on, it lets OMP pass the check: first with a hidden window inside the app, then through FlareSolverr (if connected).',
      'The bypass may break the rules of the site: turn it on at your own risk, OMP warns you when you turn it on.',
      'If the “I am not a robot” tick is needed, OMP opens the check on the screen — tick it yourself.',
      'On the TV tap “Pass on the phone”: the check opens on the phone, and the permission is sent to the TV.',
    ],
    more: [
      'Without the bypass the site answers “Cloudflare”, and the search in it does not work. OMP contacts only the site itself and your FlareSolverr, nothing else. The log records “Cloudflare: check passed / tick needed / failed” with the site name, without addresses and cookies.',
      'When the check is passed, the site page shows “check passed · valid until …”. The check cookies are stored encrypted and valid for a limited time, then OMP passes the check again.',
      'If the tick cannot be avoided, a window with the site opens at the bottom of the phone: tick it, and the window closes by itself.',
      'Android TV. The check window opens on the TV with the buttons “Pass on the phone”, “Tick with the remote” and “Cancel”. “Pass on the phone”: a phone with OMP (in the same network and connected to the TV) gets a request, you pass the check on it, and the permission is sent to the TV. If OMP is closed on the phone, a notification “The TV asks to pass a check on …” arrives. “Tick with the remote” — put the tick with the remote, which is inconvenient.',
      'The switch on the TV: in “Search sources” the “Sites behind Cloudflare” group, OK on a row turns the bypass on (after a warning) and, if the check is needed, opens it. The phone has no separate group: these sites are in “Built-in · on the phone”, with “Sign in” next to them.',
      'If the built-in check does not pass, connect FlareSolverr (the question “How to install FlareSolverr”). For sites without a switch (rutracker and others) there is one way — Jackett or Prowlarr.',
    ],
    by: {
      atv: {
        q: 'Sites behind Cloudflare and “Pass on the phone”',
        short: [
          'Kinozal, rustorka and NNM-Club are behind the Cloudflare check. On the TV they are in Settings → “Search sources” → “Sites behind Cloudflare”.',
          'OK on a site row turns the bypass on (after a warning: it may break the rules of the site, at your own risk).',
          'If the “I am not a robot” tick is needed, tap “Pass on the phone”: the check opens on the phone, and the permission is sent to the TV.',
          'You can also “Tick with the remote”, but it is inconvenient.',
          'You can turn the bypass on and send the sign-in from the phone: “Send to TV”.',
        ],
      },
    },
  },
  'sites-login': {
    q: 'Kinozal, rustorka and NNM-Club: sign-in, mirrors and “Sign in with browser”',
    short: [
      'Kinozal and rustorka search only after you sign in, NNM-Club searches without it: Settings → “Search sources” → “Sign in” on the site row (the “Built-in · on the phone” group).',
      'The username and password are entered on the site page — › on its row.',
      'The password is stored encrypted only on the phone and goes only to the site itself.',
      'The site asks for a captcha or does not accept the password — tap “Sign in with browser”: sign in on the site yourself in the OMP window, OMP does not see the password. Such a sign-in turns “Bypass the Cloudflare check” on by itself.',
      'Kinozal is sometimes blocked by DNS: OMP tries the mirrors kinozal.me, kinozal.guru and kinozal.tv itself.',
      'The sign-in can be sent to Android TV: “Send the sign-in to the TV” on the site page.',
    ],
    more: [
      'The sign-in is needed because without it Kinozal and rustorka do not give out the .torrent. The username and password are checked at sign-in: if the password is wrong, OMP says so, even when the previous sign-in is still valid.',
      '“Sign in with browser” opens the site sign-in page in a window inside OMP. You sign in yourself (with the captcha, if there is one), and OMP only remembers the sign-in after checking that you really signed in. After signing in you do not need to press anything: OMP writes “Checking the sign-in…”, the window closes by itself, and “Signed in to …” appears at the bottom. If the sign-in was not confirmed, OMP says so — tap “Check again” or sign in again. The window can be closed with the “Cancel” or “Back” button; without a sign-in it closes after 10 minutes. The password and cookies do not get into the log.',
      'The browser sign-in is valid for about 30 days (the site does not tell the exact term). When it ends, the site shows “sign-in needed” — sign in again. “Sign out” on the site page erases the sign-in on all mirrors.',
      'Kinozal. The address depends on availability: OMP tries kinozal.me, kinozal.guru and kinozal.tv and remembers the working one. If OMP moved to another mirror and you signed in through the browser, you may have to sign in again. Kinozal does not give the torrent without a sign-in or when the daily download limit is used up: OMP signs in again once by itself, and then writes “Kinozal did not give the torrent — sign in again or check the daily download limit”.',
      'rustorka. The sign-in is like rutracker: username and password or “Sign in with browser”. Torrents under moderation are not shown in the results.',
      'NNM-Club. The site is behind Cloudflare: “Sign in” → “Sign in with browser”, the window closes by itself once the sign-in is confirmed. The search works without an account; the sign-in is needed to download a torrent.',
      'Android TV. You can enter the sign-in right on the TV (“Sign in” on the site row, with the remote or with the “Keyboard” on the phone); the sign-in window has “Sign in with browser” and “Sign in on the phone” (the sign-in is done on the phone, checked and sent to the TV). Or send the sign-in from the phone: “sign-in sent from the phone” appears on the site row.',
    ],
    by: {
      atv: {
        short: [
          'Kinozal and rustorka search only after you sign in, NNM-Club searches without it: Settings → “Search sources” → “Sites behind Cloudflare” → “Sign in”.',
          'The username and password can be typed with the remote or sent from the phone (“Send to TV”).',
          'It asks for a captcha — “Sign in with browser” (the window on the TV) or “Sign in on the phone”.',
          'Kinozal is sometimes blocked by DNS: OMP tries the mirrors kinozal.me, kinozal.guru and kinozal.tv itself.',
        ],
      },
    },
  },
  'accounts': {
    q: 'Where to get an account for rutracker, Kinozal, rustorka and NNM-Club',
    short: [
      'Registration is free on each of the four sites; OMP does not create accounts for you.',
      { text: 'rutracker — sign up', url: 'https://rutracker.org/forum/profile.php?mode=register' },
      { text: 'Kinozal — sign up', url: 'https://kinozal.tv/signup.php' },
      { text: 'rustorka — sign up', url: 'https://rustorka.com/forum/profile.php?mode=register' },
      { text: 'NNM-Club — sign up', url: 'https://nnmclub.to/forum/profile.php?mode=register' },
      'After signing up, sign in to OMP: “Search sources” → the site → “Sign in” or “Sign in with browser”.',
    ],
    more: [
      'On the phone the “Sign in to …” screen of each site also has a “No account? Sign up on …” link, and on Android TV the sign-in window shows a QR code: point the phone camera at it to open the registration page.',
      'If a site is blocked in your country, open its registration page through a mirror or a VPN; Kinozal mirrors: kinozal.me, kinozal.guru, kinozal.tv.',
    ],
  },
  'discover': {
    q: 'What is “Discover”',
    short: [
      'In “Catalog” switch “Mine / Discover”: new films and series from TMDB, search by title and a card with the description.',
      'In the card “Find torrents” searches your sources, “Want to watch” subscribes you in “New”.',
      'If the catalog is unavailable, set a TMDB key or mirror in the TorrServer settings.',
    ],
    more: [
      'A film card has the description, the rating and the cast. A series has season chips on top: pick a season to see the list of episodes and tap “Find torrents for the season”. If the film or series is already on the server, “Open in library” takes the place of the search.',
      '“Want to watch” creates a subscription: OMP tells you in “New” when a torrent appears on your sources (for a series, when new episodes come out). Such a subscription has “Better quality only” on.',
      'The scale changes with two fingers: in “Mine” it is the catalog view, in “Discover” it is 2 or 3 posters in a row. After you come back from a card, “Discover” stays where it was. The data comes from TMDB; for the key and the mirror see the question “TMDB key for “Discover””.',
      'You can delete from “Mine” with a long press on a poster: a menu opens, and several can be chosen at once there.',
    ],
  },
  'add-magnet': {
    q: 'Add a torrent by magnet link',
    short: [
      'The “Add” screen starts with search; the magnet link is tucked under it.',
      'Tap “Add by magnet link”: the field opens in place.',
      'Paste a magnet link or a 40-character hash and add it.',
    ],
    more: [
      'Magnet links from the browser open in OMP on their own — via “Share”.',
    ],
  },
  'search-filters': {
    q: 'Search filters for torrents',
    short: [
      'On the “Add” screen, after a search, tap “Filters”: they apply to the results at once.',
      'Resolution and HDR / DV; the source and “Hide camrips”; the size from and to, GB; seeds, at least; voice-over (dub, multi-voice, original) and Russian subtitles.',
      'For series — a season or “Full season only”. “Reset” clears everything.',
    ],
    more: [
      'OMP remembers the chosen filters and shows them as chips under the search field. “Subscribe” takes the quality of the subscription from the filters.',
      'The filters look at the title of a torrent: if it has no resolution or voice-over in it, the torrent may not pass a filter. “Show N torrents” in the filters window tells how many will be left.',
    ],
  },
  'better-quality': {
    q: 'Better quality: a better torrent',
    short: [
      'Turn “Better quality only” on in a subscription: OMP reports only when the quality is higher than the earlier findings.',
      'OMP checks films from the catalog once a day: if a torrent in better quality is out, a card appears in “New” in the “Better quality” section.',
      '“Replace” in the notification or the card adds the new torrent and moves the history and “Skip” into it.',
    ],
    more: [
      'Following the films is turned on in “Settings → Monitoring” (“Better quality of films”) and, for one film, in its card.',
      'This is separate from “Find in better quality” on the torrent screen: see the question “Find in better quality: search on demand”.',
      '“Replace” works as for new episodes (the question “New episodes and the “Replace” button”): the old torrent is removed from the server only once the new one is added. A card in “New” can be dismissed with “Hide”.',
    ],
  },
  'find-better': {
    q: 'Find in better quality: search on demand',
    short: [
      'On the torrent screen (a film or a series) tap “Find in better quality”: OMP searches now instead of waiting for the nightly check.',
      'The best torrents come first; “Replace” adds the chosen one, moves watch positions and “Skip” and only then removes the old one.',
      'The automatic “Better quality” check runs by itself once a day and reports in “New”; the button is for searching right away.',
    ],
    more: [
      'If a torrent has few seeds, OMP warns you and puts such torrents last. A torrent covering several seasons is marked. If a replace fails (no seeds, a site needs a sign-in), OMP explains why and your torrent stays untouched. “Cancel” stops a replace.',
      'For a series the search is for the season open on the screen; switch seasons with the chips above the episode list.',
    ],
  },
  'series-card': {
    q: 'A series as one card, and the series screen',
    short: [
      'In “Mine” a series’ seasons are grouped into one card.',
      'Tap it to open the series screen: a backdrop and overview from TMDB, years · rating · genres, and the seasons with episode count and year.',
      'Missing seasons are shown with a “Find torrents” button.',
    ],
    more: [
      'Tapping a season opens the torrent screen, where episode names come from TMDB and seasons switch with chips. A TMDB key is needed (the question “TMDB key for “Discover””).',
    ],
  },
  'torrent-by-code': {
    q: 'torrent.by asks for a code',
    short: [
      'If torrent.by has blocked your IP, OMP says “torrent.by asks for a verification code”.',
      'Tap “Enter the code” in “Search sources”, enter the code from the picture on the site page and close the window.',
      'OMP checks the site again after the window is closed.',
    ],
    more: [
      'On the TV the code is entered on the phone (OMP → “Search sources”) or in any browser on the same network.',
    ],
  },
  'tmdb-key': {
    q: 'TMDB key for “Discover”',
    short: [
      '“Discover” uses the TMDB key from the TorrServer settings.',
      'The key is free: register at themoviedb.org → Settings → API → request an API key (Developer, personal use).',
      'Paste the key in TorrServer: the web page → Settings → TMDB.',
      'OMP picks the key up at once, no restart needed.',
    ],
    more: [
      { text: 'themoviedb.org — registration', url: 'https://www.themoviedb.org/signup' },
      'The same key is also used by TorrServer for posters of new torrents.',
    ],
  },
  'names': {
    q: 'Clear names and “Rename”',
    short: [
      'If a torrent has a technical name (a hash, “New folder”, a file name), OMP makes up a clear one from the files: the name of the movie or series.',
      'OMP writes this name to the server once, and it is visible everywhere: in the catalog, the history and on the TV.',
      'Your own name: on the phone, the pencil button “Rename” in the torrent card (up to 200 characters).',
    ],
    more: [
      'OMP takes the name from the top folder or from the torrent files and removes the episode and season number. A torrent you added yourself from the search gets the name from the result.',
      'If writing to the server failed, OMP tries again later (no more than three times); the name on the screen is still clear meanwhile.',
      'Subscriptions and “Replace” search by the saved name: after renaming, check that the name and the season of the series are still in it.',
    ],
    by: {
      atv: {
        short: [
          'If a torrent has a technical name (a hash, “New folder”, a file name), OMP makes up a clear one from the files.',
          'This name is visible in the catalog, the history and the player.',
          'Your own name is set on the phone: the pencil button “Rename” in the torrent card.',
        ],
      },
      lg: {
        short: [
          'If a torrent has a technical name (a hash, “New folder”, a file name), OMP makes up a clear one from the files.',
          'This name is visible in the catalog, the history and the player.',
          'Your own name is set on the phone in the torrent card (“Rename”).',
        ],
        more: [],
      },
    },
  },
  'torrserver': {
    q: 'What TorrServer is and where to get it',
    short: [
      'TorrServer downloads torrents and serves the video over the network. OMP shows its catalog and starts movies on the TV.',
      'Install it on a computer, a NAS or another device in your network.',
      { text: 'github.com/YouROK/TorrServer', url: TORRSERVER_URL },
    ],
  },
  'ts-phone': {
    q: 'Run TorrServer on the phone',
    short: [
      'No server of your own — OMP runs TorrServer right on the phone: from the connection screen (server not found) or in Settings.',
      'Only for arm64 phones.',
      'On the first run OMP downloads TorrServer from GitHub (about 61 MB, better over Wi‑Fi) and checks the file.',
      'While the server runs, the notification shade has a “TorrServer is running” notification with a “Stop” button.',
      'The server is open without a password and visible to all devices of the Wi‑Fi network.',
    ],
    more: [
      'The phone and the TV must be in the same Wi‑Fi network. The server is open without a password and visible to all devices of this network.',
      'TorrServer is downloaded once and stored in the private OMP folder. When a new version is pinned in OMP, “Update” appears in Settings. On Android 10 and newer the server is started through the system loader, on Android 8–9 — directly.',
    ],
  },
  'ts-settings': {
    q: 'Where the server settings are',
    short: [
      'Settings → “Server settings”: cache, preload, connections, speed.',
      'For a server on the phone the item is in the “TorrServer on the phone” block while the server is running.',
    ],
  },
  'ts-covers': {
    q: 'No posters for new torrents',
    short: [
      '1. Get a free key at themoviedb.org (Settings → API).',
      '2. Enter it in “Server settings” → “TMDB key for posters”.',
    ],
    more: [
      'Posters are looked up in the TMDB database with the key stored in TorrServer.',
      'The key needs TorrServer version MatriX.138 or newer; older versions do not have this item.',
    ],
  },

  // ---- New and subscriptions ----
  'subscriptions': {
    q: 'How subscriptions and “New” work',
    short: [
      '“New” is a feed of fresh torrents: “Movies”, “Series”, “Anime”, the 1080p+ filter.',
      'A subscription is a query with rules (sources, quality, seeds): “+ New subscription” on the “Subscriptions” tab.',
      'OMP checks the subscriptions itself and reports new items with a notification and a badge.',
    ],
    more: [
      'The “New” tab is a feed of fresh torrents from rutor, nnmclub and torrent.by: “Movies”, “Series”, “Anime” and the 1080p+ filter. Each torrent has “Add” and “On TV”. The sources must be turned on in “Search sources”.',
      'A subscription is a query with rules: sources, the minimum quality and the number of seeds. Create it with the “+ New subscription” button on the “Subscriptions” tab. OMP checks the subscriptions itself and reports new torrents with a notification and a badge on the “New” tab.',
      'The first check of a new subscription goes without notifications: the torrents already on the sites are considered known. Notifications come only about what appeared later.',
      'You can also check by hand: the refresh button in the “New” header. How often OMP checks by itself and whether Wi‑Fi is needed for it — in “Settings → Monitoring” (the monitoring icon in the “New” header and the “Monitoring settings” button at the bottom lead there too).',
      'Each subscription has its own check button. Subscriptions and found torrents can be searched with the search field and sorted: new findings, by name, by date added.',
    ],
  },
  'new-episodes': {
    q: 'New episodes and the “Replace” button',
    short: [
      'For series from the catalog OMP looks for a fuller torrent itself: a card “Episodes 9–10 are out · you have 1–8” appears.',
      '“Replace” adds the new torrent and moves into it the history, the stop positions, “Skip” and the category.',
      '“Stop following” turns the check off for this series.',
    ],
    more: [
      'For series from the catalog OMP looks for a fuller torrent of the same series and season itself. If new episodes are out, a card “Episodes 9–10 are out · you have 1–8” appears in “New” on the “Subscriptions” tab.',
      '“Replace” adds the new torrent to the server and moves into it the watch history, the stop positions, the “Skip” settings and the category. The old torrent is removed from the server only after the new one is added successfully: if something goes wrong, the old one stays in place. The name and the poster are taken from the new torrent.',
      '“Watch on TV” on the new episodes card first does the replace, and then starts playback. If there are several suitable torrents, you can choose “Another release” in the replace window.',
      '“Stop following” turns off the new episodes check for this series. For all series at once it can be turned off in “Settings → Monitoring” (the monitoring icon in the “New” header).',
    ],
  },

  // ---- Log and backup ----
  'log': {
    q: 'The error log: what is recorded in it',
    short: [
      'The last 500 events: errors, warnings, the results of the subscription checks, launches.',
      'Personal data (passwords, cookies, addresses, torrent names) does not get into the log; it is stored only on the device.',
      'To open: Settings → “Error log”. “Clear” erases it.',
    ],
    more: [
      'The log is a list of the last 500 events of the app: errors and warnings (the server did not answer, a source site is closed, an install error), the results of the background subscription check, the app launch. Each entry has a time, a level (INFO, WARNING, ERROR) and an area (app, server, search, monitoring, TV, install).',
      'Passwords, cookies, server and TV addresses, torrent names, hashes, logins and addresses with parameters do not get into the log: everything personal is cut out before writing. The log is stored only on the device and is not sent anywhere by itself.',
      'It can be opened in Settings → “Error log”. The filters: “All”, “Errors”, “Monitoring”. The “Clear” button erases the log. There is also a short log in the TV settings (LG and Android TV).',
    ],
  },
  'report-bug': {
    q: 'Report an error and share the log',
    short: [
      'Settings → “Error log” → “Report an error on GitHub”: a new issue opens, the log is copied — paste it.',
      '“Share log” sends the file through the system “Share”.',
      'Nothing is sent until you press the create-issue button on GitHub yourself.',
    ],
    more: [
      'Settings → “Error log” → “Report an error on GitHub”. The new issue page in the OMP repository opens; the text already has the OMP version, the Android version and the device model. The log is copied to the clipboard — paste it into the issue (a long log does not fit into the link whole). Nothing is sent until you press the create-issue button on GitHub yourself.',
      '“Share log” sends the file omp-log-<date>.txt through the system “Share” (to Telegram, by mail, to a drive). Personal data is cut out of the log, but it is still worth looking through before sending.',
    ],
  },
  'backup': {
    q: 'Backup: save and restore',
    short: [
      'Save: Settings → “Backup” → “Save the backup…”, send the omp-backup-<date>.json file to yourself.',
      'Restore: “Restore from a file…”, check the contents and confirm “Replace the data on the phone”.',
      'The file contains the TorrServer password and the pairing keys — keep it like a password.',
    ],
    more: [
      'Settings → “Backup” → “Save the backup…” creates the omp-backup-<date>.json file and opens the system “Share”: send it to yourself in Telegram, to a drive or save it to a phone folder.',
      'The backup includes: the TorrServer servers and their names (and the access password to your TorrServer, if set), the TVs and the pairing keys with them, the subscriptions and the monitoring settings, the turned-on search sources, the app and touchpad settings, the catalog view, the favorite playlists and the track choices.',
      'The backup does not include the tracker passwords and cookies (the rutracker sign-in has to be done again), nor the watch history and “Skip” — they are stored on TorrServer. The error log and temporary data are not saved either.',
      'Attention: the file contains server addresses, the TorrServer password and the pairing keys with the TVs — keep it like a password and do not post it publicly.',
      '“Restore from a file…”: choose the backup file, the app checks it and shows what is in it (how many servers, TVs, subscriptions), and only after you confirm “Replace the data on the phone” replaces the data on this phone with it. If the file is damaged, nothing changes.',
    ],
  },

  // ---- About the project ----
  'support': {
    q: 'How to support OMP',
    short: [
      'OMP is free and has no ads, all features are available to everyone.',
      'To support: Settings → “About” → “Support OMP” (a page opens in the browser).',
      'Already supported? Enter the Boosty code in “Support OMP” → “Already supported?”.',
    ],
    more: [
      'OMP is free and has no ads, all features are available to everyone. If the app is useful to you, you can support the development: Settings → “About” → “Support OMP”.',
      'The app sends nothing when you do this: the button just opens a page in the browser.',
      'On the TV, on pause and during the final credits, a card with a QR code appears — point the phone camera at it.',
      'Already supported? Boosty subscribers get a support code, it changes every month. Enter it in “Support OMP” → “Already supported?” — until the end of the month OMP will not ask for support, neither on the phone nor on the TVs. The code is checked on the phone, only the end date is written to the server.',
      { text: 'Boosty — support OMP', url: 'https://boosty.to/djmaker/donate' },
    ],
  },
  'telegram': {
    q: 'Where to get new versions (Telegram)',
    short: [
      'Every release is published in the OMP Telegram channel: t.me/ompplyaer.',
      'All builds up to 50 MB are attached to the post; files larger than this limit are given as a GitHub link.',
      'You can also update inside OMP: in Settings → “Update” (on the phone — at launch).',
    ],
    more: [
      'The post has what is new and buttons to download the builds, to support the project and to see the list of changes.',
      TELEGRAM_LINK,
      RELEASE_LINK,
    ],
  },
};
