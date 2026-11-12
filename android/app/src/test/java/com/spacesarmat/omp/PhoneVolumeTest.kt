package com.spacesarmat.omp

import android.view.KeyEvent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PhoneVolumeTest {
    @Test
    fun volumeKeysBecomeWebNames() {
        assertEquals("AudioVolumeUp", PhoneVolume.webKey(KeyEvent.KEYCODE_VOLUME_UP))
        assertEquals("AudioVolumeDown", PhoneVolume.webKey(KeyEvent.KEYCODE_VOLUME_DOWN))
        assertEquals("AudioVolumeMute", PhoneVolume.webKey(KeyEvent.KEYCODE_VOLUME_MUTE))
        assertNull(PhoneVolume.webKey(KeyEvent.KEYCODE_BACK))
    }
}
