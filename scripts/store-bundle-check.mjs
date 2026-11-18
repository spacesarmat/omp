// Strings that must not ship in the LG store bundle, and Luna calls the store build still makes.
export const STORE_BUNDLE_BANNED = [
  'org.webosbrew',
  'com.palmdts.devmode',
  'luna://com.webos.applicationManager/',
  'luna://com.webos.settingsservice/',
  'luna://org.webosbrew.hbchannel.service/',
];

export const STORE_BUNDLE_REQUIRED = [
  'luna://com.webos.service.connectionmanager/getStatus',
  'luna://com.webos.media/selectTrack',
  'luna://com.webos.media/setSubtitleEnable',
];

export function scanStoreBundle(text) {
  const banned = STORE_BUNDLE_BANNED.filter((s) => text.includes(s));
  const missing = STORE_BUNDLE_REQUIRED.filter((s) => !text.includes(s));
  return { banned, missing };
}
