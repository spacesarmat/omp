// Where a tap on the series page starts.
// Root cause of the phone default: the series screen (and WatchSheet) treated "no saved TV" as
// "play here". The last watch in history is only a label. It does not choose the player.
// A saved paired TV is the one the rest of the phone can send to, so that is the default.
export function playWhere(tvSaved: boolean): 'tv' | 'phone' {
  return tvSaved ? 'tv' : 'phone';
}
