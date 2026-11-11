package com.spacesarmat.omp

import android.content.Intent
import androidx.core.net.toUri
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class MagnetIntakeTest {
    @Test
    fun viewKeepsAMagnet() {
        val intent = Intent(Intent.ACTION_VIEW, "magnet:?xt=urn:btih:abc".toUri())
        assertEquals("magnet:?xt=urn:btih:abc", OmpNativePlugin.magnetFrom(intent))
    }

    @Test
    fun viewKeepsATorrentUrl() {
        val intent = Intent(Intent.ACTION_VIEW, "https://x.test/a.torrent?dl=1".toUri())
        assertEquals("https://x.test/a.torrent?dl=1", OmpNativePlugin.magnetFrom(intent))
    }

    @Test
    fun viewIgnoresAnOrdinaryPage() {
        val intent = Intent(Intent.ACTION_VIEW, "https://x.test/page".toUri())
        assertNull(OmpNativePlugin.magnetFrom(intent))
    }

    @Test
    fun sendTextKeepsATorrentUrl() {
        val intent = Intent(Intent.ACTION_SEND)
            .setType("text/plain")
            .putExtra(Intent.EXTRA_TEXT, "see https://x.test/a.TORRENT?dl=1 now")
        assertEquals("https://x.test/a.TORRENT?dl=1", OmpNativePlugin.magnetFrom(intent))
    }
}
