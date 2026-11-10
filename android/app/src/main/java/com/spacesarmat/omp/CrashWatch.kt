package com.spacesarmat.omp

import android.app.Application
import android.os.Handler
import android.os.Looper
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Writes a scrubbed native crash or ANR into filesDir/crash-queue.txt.
 * The page reads it and sends the report. The file never keeps a token or a magnet.
 */
object CrashWatch {
    private const val FILE = "crash-queue.txt"
    private var installed = false
    private var lastAnr = 0L

    fun install(app: Application) {
        if (installed) return
        installed = true
        val prev = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            write(app, "crash", error)
            prev?.uncaughtException(thread, error)
        }
        val main = Handler(Looper.getMainLooper())
        Thread({
            while (!Thread.currentThread().isInterrupted) {
                val ping = AtomicBoolean(false)
                main.post { ping.set(true) }
                try {
                    Thread.sleep(8000)
                } catch (e: InterruptedException) {
                    return@Thread
                }
                if (!ping.get()) write(app, "anr", RuntimeException("anr"))
            }
        }, "omp-anr").apply { isDaemon = true }.start()
    }

    fun take(app: Application): String {
        val file = File(app.filesDir, FILE)
        if (!file.exists()) return ""
        val text = file.readText()
        file.delete()
        return text
    }

    fun scrub(text: String): String {
        return text
            .replace(Regex("magnet:\\?\\S+", RegexOption.IGNORE_CASE), "magnet:[скрыто]")
            .replace(Regex("\\b(Bearer|Basic)\\s+\\S+"), "$1 [скрыто]")
            .replace(Regex("\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b"), "[ip]")
            .take(4000)
    }

    private fun write(app: Application, kind: String, error: Throwable) {
        if (kind == "anr") {
            val now = System.currentTimeMillis()
            if (now - lastAnr < 60_000) return
            lastAnr = now
        }
        try {
            val line = kind + "\n" + scrub(error.javaClass.simpleName + ": " + (error.message ?: "")) + "\n" + scrub(error.stackTraceToString()) + "\n---\n"
            File(app.filesDir, FILE).appendText(line)
        } catch (_: Exception) {
            /* a crash report must not crash again */
        }
    }
}
