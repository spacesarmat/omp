package com.spacesarmat.omp.player

import android.app.ActivityManager
import android.content.Context
import android.content.pm.ApplicationInfo

/**
 * How much media the player may hold in memory. ExoPlayer's default target for video is about 2000 × 64 KB
 * (≈131 MB): more than the whole Java heap of a 128 MB box (Dune HD), so a 4K stream ran out of memory after
 * ~10 s. The cap is a quarter of the app's heap, between 16 and 64 MB.
 */
object PlayerBuffer {
    const val MIN_BYTES = 16 * 1024 * 1024
    const val MAX_BYTES = 64 * 1024 * 1024

    /** A quarter of a [memoryClassMb] heap, clamped to 16–64 MB. */
    fun capBytes(memoryClassMb: Int): Int {
        val quarter = memoryClassMb.toLong() * 1024 * 1024 / 4
        return quarter.coerceIn(MIN_BYTES.toLong(), MAX_BYTES.toLong()).toInt()
    }

    /** The heap this app gets, in MB: the large one when android:largeHeap is granted. */
    fun memoryClassMb(context: Context): Int {
        val am = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager ?: return 0
        val large = (context.applicationInfo.flags and ApplicationInfo.FLAG_LARGE_HEAP) != 0
        return if (large) am.largeMemoryClass else am.memoryClass
    }

    /** True when [e] is, or was caused by, an OutOfMemoryError (Media3 wraps it in a source error). */
    fun causedByOom(e: Throwable?): Boolean {
        var c = e
        var depth = 0
        while (c != null && depth < 8) {
            if (c is OutOfMemoryError) return true
            c = c.cause
            depth++
        }
        return false
    }
}
