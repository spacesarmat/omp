package com.spacesarmat.omp

import android.view.KeyEvent

/**
 * Remote key → webOS key code understood by the TV interface (src/platform/keys.ts); null for a key the WebView
 * gets as is. Back is not here: it goes through the OnBackPressed callback only.
 */
object TvKeys {
    private val WEB_KEYS = mapOf(
        KeyEvent.KEYCODE_MEDIA_PLAY to 415,
        KeyEvent.KEYCODE_MEDIA_PAUSE to 19,
        KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE to 179,
        KeyEvent.KEYCODE_MEDIA_FAST_FORWARD to 417,
        KeyEvent.KEYCODE_MEDIA_REWIND to 412,
        // CH+ / CH− are Page Up / Page Down (33 / 34): chapters in the player; ⏭ / ⏮ are next / previous episode
        KeyEvent.KEYCODE_CHANNEL_UP to 33,
        KeyEvent.KEYCODE_CHANNEL_DOWN to 34,
        KeyEvent.KEYCODE_MEDIA_NEXT to 78,
        KeyEvent.KEYCODE_MEDIA_PREVIOUS to 80,
        KeyEvent.KEYCODE_MEDIA_STOP to 413,
        // the colour keys of a box remote (Dune HD and others) do what they do on LG: blue opens the settings, …
        KeyEvent.KEYCODE_PROG_RED to 403,
        KeyEvent.KEYCODE_PROG_GREEN to 404,
        KeyEvent.KEYCODE_PROG_YELLOW to 405,
        KeyEvent.KEYCODE_PROG_BLUE to 406,
    )

    fun webCode(keyCode: Int): Int? = WEB_KEYS[keyCode]
}
