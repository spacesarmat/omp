package com.spacesarmat.omp.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.file.Files

/** libVLC is only touched when its native libraries are in the app's library dir and load. */
class VlcAvailabilityTest {
    private fun dir(vararg files: String): File {
        val d = Files.createTempDirectory("vlclibs").toFile()
        files.forEach { File(d, it).writeText("x") }
        d.deleteOnExit()
        return d
    }

    @Test
    fun allLibrariesPresentAndLoaded() {
        val loaded = ArrayList<String>()
        assertTrue(VlcAvailability.check(dir("libc++_shared.so", "libvlc.so", "libvlcjni.so")) { loaded.add(it) })
        assertEquals(listOf("c++_shared", "vlc", "vlcjni"), loaded)
    }

    @Test
    fun aMissingLibraryMeansUnavailableWithoutLoadingAnything() {
        val loaded = ArrayList<String>()
        assertFalse(VlcAvailability.check(dir("libc++_shared.so", "libvlcjni.so")) { loaded.add(it) })
        assertFalse(VlcAvailability.check(null) { loaded.add(it) })
        assertFalse(VlcAvailability.check(File("/no/such/dir")) { loaded.add(it) })
        assertTrue(loaded.isEmpty())
    }

    @Test
    fun aLibraryThatDoesNotLoadMeansUnavailable() {
        val d = dir("libc++_shared.so", "libvlc.so", "libvlcjni.so")
        assertFalse(VlcAvailability.check(d) { if (it == "vlc") throw UnsatisfiedLinkError("wrong ABI") })
        assertFalse(VlcAvailability.check(d) { throw SecurityException() })
    }
}
