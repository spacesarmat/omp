// webOS second-screen protocol (SSAP): pure message builders, no I/O.

export type RemoteButton =
  | 'UP'
  | 'DOWN'
  | 'LEFT'
  | 'RIGHT'
  | 'ENTER'
  | 'BACK'
  | 'HOME'
  | 'MENU'
  | 'PLAY'
  | 'PAUSE'
  | 'REWIND'
  | 'FASTFORWARD'
  | 'CHANNELUP'
  | 'CHANNELDOWN';

export const OMP_TV_APP_ID = 'com.spacesarmat.torrplayer';

/**
 * Permissions OMP asks for: launch apps, volume, power, text input, pointer/buttons, app list,
 * plus a few for planned features (power state, media keys, running app, toasts) so that
 * adding them later does not force the user to pair again.
 */
const PERMISSIONS = [
  'LAUNCH',
  'CONTROL_AUDIO',
  'CONTROL_POWER',
  'CONTROL_INPUT_TEXT',
  'CONTROL_MOUSE_AND_KEYBOARD',
  'READ_INSTALLED_APPS',
  'READ_POWER_STATE',
  'CONTROL_INPUT_MEDIA_PLAYBACK',
  'READ_RUNNING_APPS',
  'WRITE_NOTIFICATION_TOAST',
];

// The `signed` block and its signature are copied verbatim from pairing.json of lgtv2
// (https://github.com/hobbyquaker/lgtv2, MIT License, (c) Sebastian Raff and contributors),
// fetched from GitHub. aiowebostv (Apache-2.0) was checked as well: it sends no `signed` block,
// only a permissions list. The signature covers `signed` only, so that block must not be edited; the top-level
// `permissions` list is OMP's own minimal set.
const SIGNED = {
  created: '20140509',
  appId: 'com.lge.test',
  vendorId: 'com.lge',
  localizedAppNames: {
    '': 'LG Remote App',
    'ko-KR': '리모컨 앱',
    'zxx-XX': 'ЛГ Rэмotэ AПП',
  },
  localizedVendorNames: {
    '': 'LG Electronics',
  },
  permissions: [
    'TEST_SECURE',
    'CONTROL_INPUT_TEXT',
    'CONTROL_MOUSE_AND_KEYBOARD',
    'READ_INSTALLED_APPS',
    'READ_LGE_SDX',
    'READ_NOTIFICATIONS',
    'SEARCH',
    'WRITE_SETTINGS',
    'WRITE_NOTIFICATION_ALERT',
    'CONTROL_POWER',
    'READ_CURRENT_CHANNEL',
    'READ_RUNNING_APPS',
    'READ_UPDATE_INFO',
    'UPDATE_FROM_REMOTE_APP',
    'READ_LGE_TV_INPUT_EVENTS',
    'READ_TV_CURRENT_TIME',
  ],
  serial: '2f930e2d2cfe083771f68e4fe7bb07',
};

const SIGNATURE =
  'eyJhbGdvcml0aG0iOiJSU0EtU0hBMjU2Iiwia2V5SWQiOiJ0ZXN0LXNpZ25pbmctY2VydCIsInNpZ25hdHVyZVZlcnNpb24iOjF9.hrVRgjCwXVvE2OOSpDZ58hR+59aFNwYDyjQgKk3auukd7pcegmE2CzPCa0bJ0ZsRAcKkCTJrWo5iDzNhMBWRyaMOv5zWSrthlf7G128qvIlpMT0YNY+n/FaOHE73uLrS/g7swl3/qH/BGFG2Hu4RlL48eb3lLKqTt2xKHdCs6Cd4RMfJPYnzgvI4BNrFUKsjkcu+WD4OO2A27Pq1n50cMchmcaXadJhGrOqH5YmHdOCj5NSHzJYrsW0HPlpuAx/ECMeIZYDh6RMqaFM2DXzdKX9NmmyqzJ3o/0lkk/N97gfVRLW5hA29yeAwaCViZNCP8iC9aO0q9fQojoa7NQnAtw==';

function manifest(signed: boolean): object {
  if (!signed) {
    // lgtv2 `unsignedPairing()`: when the TV answers "403 blacklisted certificate detected",
    // it drops only `signed` (keeping `signatures`) and sends appVersion 1.0.
    return {
      manifestVersion: 1,
      appVersion: '1.0',
      permissions: PERMISSIONS.slice(),
      signatures: [{ signatureVersion: 1, signature: SIGNATURE }],
    };
  }
  return {
    manifestVersion: 1,
    appVersion: '1.1',
    signed: JSON.parse(JSON.stringify(SIGNED)),
    permissions: PERMISSIONS.slice(),
    signatures: [{ signatureVersion: 1, signature: SIGNATURE }],
  };
}

export function registerMessage(id: string, clientKey?: string, signed = true): object {
  const payload: Record<string, unknown> = {
    forcePairing: false,
    pairingType: 'PROMPT',
    manifest: manifest(signed),
  };
  if (clientKey) payload['client-key'] = clientKey;
  return { type: 'register', id, payload };
}

export function requestMessage(id: string, uri: string, payload: object = {}): object {
  return { type: 'request', id, uri, payload };
}

export function buttonFrame(name: RemoteButton): string {
  return `type:button\nname:${name}\n\n`;
}

export function moveFrame(dx: number, dy: number): string {
  return `type:move\ndx:${Math.round(dx)}\ndy:${Math.round(dy)}\ndown:0\n\n`;
}

export function clickFrame(): string {
  return 'type:click\n\n';
}

export function launchOmpPayload(params: object): object {
  return { id: OMP_TV_APP_ID, params };
}
