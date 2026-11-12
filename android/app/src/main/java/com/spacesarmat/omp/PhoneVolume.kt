package com.spacesarmat.omp

import android.view.KeyEvent

/** Phone volume keys while the remote screen is open. The page hears the same names as a keyboard. */
object PhoneVolume {
    @JvmField
    var capture: Boolean = false

    fun webKey(code: Int): String? = when (code) {
        KeyEvent.KEYCODE_VOLUME_UP -> "AudioVolumeUp"
        KeyEvent.KEYCODE_VOLUME_DOWN -> "AudioVolumeDown"
        KeyEvent.KEYCODE_VOLUME_MUTE -> "AudioVolumeMute"
        else -> null
    }

    fun js(name: String): String =
        "(function(){window.dispatchEvent(new KeyboardEvent('keydown',{key:'$name',bubbles:true,cancelable:true}));})()"
}
