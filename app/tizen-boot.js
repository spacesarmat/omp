// Spike bootstrap injected before OMP's bundle: registers remote keys and maps
// Samsung key codes onto the codes OMP's src/platform/keys.ts already understands.
(function () {
  var KEYS = [
    'MediaPlay', 'MediaPause', 'MediaPlayPause', 'MediaStop', 'MediaFastForward', 'MediaRewind',
    'MediaTrackPrevious', 'MediaTrackNext', 'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue',
    'ChannelUp', 'ChannelDown', 'Info',
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'
  ];
  try {
    if (window.tizen && tizen.tvinputdevice) {
      KEYS.forEach(function (k) { try { tizen.tvinputdevice.registerKey(k); } catch (e) { /* key absent on this remote */ } });
    }
  } catch (e) { /* not on Tizen */ }

  // Samsung Return = 10009 (webOS Back = 461); ChannelUp/Down = 427/428 (OMP expects PageUp/PageDown 33/34).
  var REMAP = { 10009: 461, 427: 33, 428: 34 };
  function remap(e) {
    var to = REMAP[e.keyCode];
    if (!to) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    var ev = document.createEvent('Event');
    ev.initEvent(e.type, true, true);
    try { Object.defineProperty(ev, 'keyCode', { get: function () { return to; } }); } catch (x) { /* ignore */ }
    try { Object.defineProperty(ev, 'which', { get: function () { return to; } }); } catch (x) { /* ignore */ }
    (e.target || document).dispatchEvent(ev);
  }
  window.addEventListener('keydown', remap, true);
  window.addEventListener('keyup', remap, true);
})();
