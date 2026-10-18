package com.spacesarmat.omp.player

import com.spacesarmat.omp.I18n

/** What the engine reported, independent of the torrent swarm. */
enum class EngineFault { NONE, NETWORK, DECODE, FORMAT, OTHER }

/**
 * What the viewer should see. [BUFFERING] means keep waiting (peers are here, data is not).
 * [OTHER] keeps the engine's own generic text.
 */
enum class FailureKind { BUFFERING, NO_SEEDERS, SERVER, CODEC, OTHER }

/** TorrServer's view of the swarm at one moment. */
data class SwarmStats(
    val activePeers: Int = 0,
    val totalPeers: Int = 0,
    val seeders: Int = 0,
    val preloadedBytes: Long = 0,
    /** Cache filled, preloaded, or bytes already stored for the torrent — whichever is known. */
    val loadedBytes: Long = 0,
    val downloadSpeed: Double = 0.0,
)

/** `Absent`: the item is not a TorrServer stream. `Pending`: the stat request has not answered. */
sealed class SwarmLookup {
    data object Pending : SwarmLookup()
    data object Unreachable : SwarmLookup()
    data object Absent : SwarmLookup()
    data class Known(val stats: SwarmStats) : SwarmLookup()
}

/**
 * A media error is not a codec failure until TorrServer has delivered data. No connected peers and an empty
 * buffer is a dead swarm; peers with nothing buffered yet means keep waiting. Total peers do not count.
 */
object PlaybackFailure {
    /** Below this, nothing playable has arrived. */
    const val EMPTY_BYTES = 64 * 1024L

    /** Slower than this, with an empty buffer, is not data flowing. */
    const val QUIET_SPEED = 1024.0

    /** Reopen the stream while peers are connected but the engine already gave up. */
    const val RETRY_MS = 3_000L

    fun faultOf(kind: ErrorKind): EngineFault = when (kind) {
        ErrorKind.NETWORK -> EngineFault.NETWORK
        ErrorKind.DECODER -> EngineFault.DECODE
        ErrorKind.UNSUPPORTED_FORMAT -> EngineFault.FORMAT
        ErrorKind.OTHER -> EngineFault.OTHER
    }

    fun statsOf(t: TorrentStats): SwarmStats = SwarmStats(
        activePeers = t.activePeers.coerceAtLeast(0),
        totalPeers = t.totalPeers.coerceAtLeast(0),
        seeders = t.seeders.coerceAtLeast(0),
        preloadedBytes = t.preloaded.coerceAtLeast(0),
        loadedBytes = maxOf(t.preloaded, t.cacheFilled, t.loadedSize).coerceAtLeast(0),
        downloadSpeed = if (t.downSpeed.isNaN()) 0.0 else t.downSpeed.coerceAtLeast(0.0),
    )

    fun classify(fault: EngineFault, swarm: SwarmLookup, played: Boolean): FailureKind {
        if (fault == EngineFault.NONE) return FailureKind.BUFFERING
        if (swarm is SwarmLookup.Pending) return FailureKind.BUFFERING
        if (swarm is SwarmLookup.Unreachable) return FailureKind.SERVER
        if (swarm is SwarmLookup.Absent) {
            return if (fault == EngineFault.FORMAT || fault == EngineFault.DECODE) FailureKind.CODEC else FailureKind.OTHER
        }
        val s = (swarm as SwarmLookup.Known).stats
        val bytes = maxOf(s.preloadedBytes, s.loadedBytes)
        val flowing = played || bytes >= EMPTY_BYTES
        val peers = s.activePeers > 0 || s.seeders > 0
        val quiet = bytes < EMPTY_BYTES && s.downloadSpeed < QUIET_SPEED
        if (!flowing && quiet && !peers) return FailureKind.NO_SEEDERS
        if (!flowing) return FailureKind.BUFFERING
        if (fault == EngineFault.FORMAT || fault == EngineFault.DECODE) return FailureKind.CODEC
        if (fault == EngineFault.NETWORK) return if (peers) FailureKind.BUFFERING else FailureKind.SERVER
        return FailureKind.OTHER
    }

    fun message(kind: FailureKind): String = when (kind) {
        FailureKind.NO_SEEDERS -> I18n.s("player.errNoSeeders")
        FailureKind.SERVER -> I18n.s("player.errServer")
        FailureKind.CODEC -> I18n.s("player.errFormat")
        FailureKind.OTHER -> I18n.s("player.errOther")
        FailureKind.BUFFERING -> ""
    }

    /** «Подключаемся… пиров: N, скорость …» while the first bytes have not arrived. */
    fun connectingText(peers: Int, bytesPerSec: Double): String {
        val rate = PlayerInfoText.rateParts(if (bytesPerSec.isNaN()) 0.0 else bytesPerSec)
        return I18n.s("player.connecting", "n" to peers.coerceAtLeast(0).toString(), "speed" to (rate.first + " " + rate.second))
    }
}

/**
 * A torrent the player is still waiting on, with 0 connected seeders and 0 downloaded bytes, for [MS].
 * Any seeder or any downloaded byte clears the streak. Not active clears it too.
 */
object DeadRelease {
    const val MS = 60_000L

    data class State(val since: Long?, val dead: Boolean)

    fun step(since: Long?, now: Long, active: Boolean, seeders: Int, bytes: Long): State {
        if (!active || seeders > 0 || bytes > 0L) return State(null, false)
        val start = since ?: now
        return State(start, now - start >= MS)
    }
}
