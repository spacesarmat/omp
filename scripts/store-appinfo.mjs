// requiredACG for the LG Content Store ipk only. Sideload packaging (scripts/package.mjs) does not
// set the field: on webOS TV 26 a present field turns ACG enforcement on, and the sideload build
// still calls applicationManager for Homebrew Channel and Developer Mode.
//
// Mapping (https://webostv.developer.lge.com/develop/guides/acg-guide), TV bundle only.
// Phone SSAP calls are not Luna calls of this ipk.
//
// Kept:
//   luna://com.webos.service.connectionmanager/getStatus  -> network.query
//     The guide lists com.palm.connectionmanager/getStatus as network.query. The TV app already
//     calls the webOS TV service of the same method (src/api/discovery.ts, local IP for the scan).
//   luna://com.webos.media/selectTrack
//   luna://com.webos.media/setSubtitleEnable
//     Not in the public ACG table. No group is invented. Playback uses them only when the HTML
//     track lists are empty (src/platform/webosMedia.ts).
//
// Removed from the store bundle, so their groups are not requested:
//   com.webos.settingsservice/getSystemSettings     settings.query (device name; store shows «LG webOS TV»)
//   com.webos.applicationManager/launch            application.launcher (Homebrew Channel, Developer Mode)
//   com.webos.applicationManager/getAppInfo        not listed (getAppLoadStatus is application.query)
//   org.webosbrew.hbchannel.service/*              not an LG service
export const STORE_REQUIRED_ACG = ['network.query'];

export function storeAppInfo(appinfo, version) {
  if (appinfo.splashBackground || appinfo.bgImage) {
    throw new Error('store appinfo has a splash or launcher image; flatten it to an opaque PNG before packaging');
  }
  const rest = { ...appinfo };
  delete rest.requiredACG;
  return { ...rest, version: String(version).split('-')[0], requiredACG: STORE_REQUIRED_ACG.slice() };
}
