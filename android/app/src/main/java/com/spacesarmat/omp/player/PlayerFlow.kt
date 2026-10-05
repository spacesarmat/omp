package com.spacesarmat.omp.player

import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.net.URLDecoder
import java.util.Base64

/**
 * The player's end-of-item decisions without Android: the «Следующая серия» countdown (5 s at the end, 10 s from
 * the credits), what Play does at the end of an item, and when to warm the next item up. The activity runs the
 * timers and draws; this class only decides.
 */
class PlayerFlow {
    /** Seconds left of the running countdown; -1: none. */
    var countdown = -1
        private set

    /** The running countdown started at the credits (pausing cancels it, Back dismisses it for this item). */
    var creditsCountdown = false
        private set

    /** The current item played to its end and nothing moved since (Play then continues to the next item). */
    var ended = false
        private set

    /** The queue item the next-item warm-up was sent for (once per item per run). */
    private var preloaded = -1

    enum class End { COUNTDOWN, CLOSE, NONE }

    enum class Play { PAUSE, PLAY, NEXT, CLOSE }

    /** A new queue. */
    fun reset() {
        cancel()
        ended = false
        preloaded = -1
    }

    /** Another item became current. */
    fun entered() {
        cancel()
        ended = false
    }

    /** The position moved (seek, retry): no longer at the end. */
    fun moved() {
        ended = false
    }

    fun cancel() {
        countdown = -1
        creditsCountdown = false
    }

    /** The engine reported the end of the item. */
    fun itemEnded(hasNext: Boolean, autoNext: Boolean): End {
        ended = true
        // a credits countdown still running at the end (short credits) gives way to the end-of-item one
        if (creditsCountdown) cancel()
        if (countdown >= 0) return End.NONE
        if (hasNext && autoNext) {
            countdown = NEXT_COUNTDOWN_S
            return End.COUNTDOWN
        }
        return End.CLOSE
    }

    /** The credits started (SkipState.countdownDue): true when the 10 s countdown starts now. */
    fun creditsDue(hasNext: Boolean, autoNext: Boolean, playing: Boolean): Boolean {
        if (countdown >= 0 || !autoNext || !hasNext || !playing) return false
        countdown = CREDITS_COUNTDOWN_S
        creditsCountdown = true
        return true
    }

    /** One second of the countdown passed: true when it ran out (go to the next item). */
    fun second(): Boolean {
        if (countdown < 0) return false
        countdown--
        return countdown <= 0
    }

    /**
     * Play / pause pressed (OK, ⏯, the phone): at the end of an item Play continues to the next one (or closes
     * on the last), as the old playlist player did after Back on the countdown.
     */
    fun playPressed(playing: Boolean, hasNext: Boolean): Play = when {
        playing -> Play.PAUSE
        ended -> if (hasNext) Play.NEXT else Play.CLOSE
        else -> Play.PLAY
    }

    /**
     * True once per next item when it should be warmed up: a countdown runs, or the current item is playing its
     * last [PRELOAD_BEFORE_END_MS].
     */
    fun preloadDue(index: Int, hasNext: Boolean, playing: Boolean, posMs: Long, durMs: Long): Boolean {
        if (!hasNext || preloaded == index + 1) return false
        val nearEnd = playing && durMs > 0 && durMs - posMs <= PRELOAD_BEFORE_END_MS
        if (countdown < 0 && !nearEnd) return false
        preloaded = index + 1
        return true
    }

    companion object {
        const val NEXT_COUNTDOWN_S = 5
        const val CREDITS_COUNTDOWN_S = 10
        const val PRELOAD_BEFORE_END_MS = 60_000L
    }
}

/**
 * Asks TorrServer to start loading a queue item before it plays (the old playlist player buffered the next item
 * ahead; one engine item at a time needs the hint): `/stream…?link=…&index=…&preload` without `play`.
 */
object NextPreload {
    /** A TorrServer request for the warm-up: the URL without credentials and the Basic header (or null). */
    data class Request(val url: String, val authorization: String?)

    /** Null for a URL that is not a TorrServer stream (`/stream` path with `link=`). */
    fun request(streamUrl: String): Request? {
        val u = try {
            URI(streamUrl)
        } catch (_: Exception) {
            return null
        }
        val scheme = u.scheme?.lowercase() ?: return null
        if (scheme != "http" && scheme != "https") return null
        val path = u.rawPath ?: return null
        if (!path.startsWith("/stream")) return null
        val params = (u.rawQuery ?: "").split('&').filter { it.isNotEmpty() }
        if (params.none { it.startsWith("link=") }) return null
        val kept = params.filter { val k = it.substringBefore('='); k != "play" && k != "preload" && k != "stat" }
        val host = u.rawAuthority?.substringAfter('@') ?: return null
        val url = "$scheme://$host$path?" + (kept + "preload").joinToString("&")
        val auth = u.rawUserInfo?.let { info ->
            val user = decode(info.substringBefore(':'))
            val pass = decode(info.substringAfter(':', ""))
            "Basic " + Base64.getEncoder().encodeToString("$user:$pass".toByteArray(Charsets.UTF_8))
        }
        return Request(url, auth)
    }

    /** Percent-decoding of the user info (a literal + stays a +). */
    private fun decode(s: String): String = URLDecoder.decode(s.replace("+", "%2B"), "UTF-8")

    /** Sends the warm-up in the background; the answer (TorrServer replies when the preload is done) is ignored. */
    fun send(streamUrl: String) {
        val r = request(streamUrl) ?: return
        val t = Thread {
            var c: HttpURLConnection? = null
            try {
                c = URL(r.url).openConnection() as HttpURLConnection
                c.connectTimeout = 10_000
                c.readTimeout = 120_000
                c.setRequestProperty("User-Agent", "OMP")
                r.authorization?.let { c.setRequestProperty("Authorization", it) }
                c.responseCode
            } catch (_: Exception) {
                // a hint only: playback opens the item anyway
            } finally {
                c?.disconnect()
            }
        }
        t.isDaemon = true
        t.start()
    }
}

/**
 * Drops a `nativePlayerState` identical to the previous one sent less than [windowMs] ago (one engine change can
 * produce several callbacks); the 1 s heartbeat still goes out.
 */
class StateDeduper(private val windowMs: Long = 500) {
    private var last: PlayerSnapshot? = null
    private var lastAt = 0L

    fun shouldEmit(s: PlayerSnapshot, nowMs: Long): Boolean {
        if (s == last && nowMs - lastAt < windowMs) return false
        last = s
        lastAt = nowMs
        return true
    }

    fun reset() {
        last = null
    }
}
