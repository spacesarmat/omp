package com.spacesarmat.omp.player

import android.content.Context
import android.util.Log
import java.io.File
import java.util.concurrent.Executors

/**
 * Whether libVLC can run on this device. LibVLC.loadLibraries() calls System.exit when its native libraries do not
 * load (an x86 box: the APK carries arm64-v8a / armeabi-v7a only), so no libVLC class is touched before this
 * says yes: the libraries must be in the app's native library dir (legacy packaging extracts them there) and load.
 */
object VlcAvailability {
    /** The libraries LibVLC.loadLibraries() loads, as files and as System.loadLibrary names. */
    val FILES = listOf("libc++_shared.so", "libvlc.so", "libvlcjni.so")
    private val NAMES = listOf("c++_shared", "vlc", "vlcjni")

    fun libsPresent(dir: File?): Boolean = dir != null && FILES.all { File(dir, it).isFile }

    /** [load]: System.loadLibrary; any failure (missing file, wrong ABI) → unavailable. */
    fun check(dir: File?, load: (String) -> Unit): Boolean {
        if (!libsPresent(dir)) return false
        return try {
            NAMES.forEach(load)
            true
        } catch (_: Throwable) {
            false
        }
    }

    @Volatile
    private var cached: Boolean? = null

    fun available(context: Context): Boolean {
        cached?.let { return it }
        val dir = context.applicationInfo.nativeLibraryDir?.let { File(it) }
        val ok = check(dir) { System.loadLibrary(it) }
        if (!ok) Log.w("OmpPlayer", "VLC unavailable on this device")
        cached = ok
        return ok
    }
}

/**
 * The libVLC thread: stop / setMedia / play / release and the other player calls run here, one at a time and in
 * order (they join libVLC's input thread and can block for seconds on a stalled stream). Events still arrive on the
 * main thread; nothing on the main thread waits for this one.
 */
object VlcThread {
    private val executor = Executors.newSingleThreadExecutor { r -> Thread(r, "omp-vlc").apply { isDaemon = true } }

    fun post(block: () -> Unit) {
        executor.execute {
            try {
                block()
            } catch (t: Throwable) {
                Log.w("OmpPlayer", "VLC call failed: " + t.javaClass.simpleName)
            }
        }
    }
}

/**
 * One LibVLC per player activity (loading libVLC's modules is slow on TV boxes): created on the first VLC engine,
 * shared by the engines of all runs and switches, released on the libVLC thread after them ([release] in
 * onDestroy). Only touched after [VlcAvailability] said yes.
 */
class VlcLibrary(context: Context) {
    private val app = context.applicationContext
    private var lib: org.videolan.libvlc.LibVLC? = null

    fun get(): org.videolan.libvlc.LibVLC = lib ?: org.videolan.libvlc.LibVLC(app, OPTIONS).also { lib = it }

    fun release() {
        val l = lib ?: return
        lib = null
        VlcThread.post { l.release() }
    }

    companion object {
        /** No log output: libVLC messages may carry the URL with the credentials. */
        private val OPTIONS = arrayListOf("--verbose=-1")
    }
}
