package com.spacesarmat.omp.player

import com.spacesarmat.omp.I18n
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test

/** A dead torrent is not an unsupported codec; peers with an empty buffer keep waiting. */
class PlaybackFailureTest {
    @After
    fun reset() {
        I18n.lang = "ru"
    }

    private fun known(s: SwarmStats) = SwarmLookup.Known(s)

    private val dead = SwarmStats(totalPeers = 40)
    private val peers = SwarmStats(activePeers = 3, seeders = 1, totalPeers = 12)
    private val flowing = SwarmStats(activePeers = 2, seeders = 1, preloadedBytes = PlaybackFailure.EMPTY_BYTES, downloadSpeed = 200_000.0)

    @Test
    fun deadSwarmIsNotACodec() {
        assertEquals(FailureKind.NO_SEEDERS, PlaybackFailure.classify(EngineFault.FORMAT, known(dead), played = false))
        assertEquals(FailureKind.NO_SEEDERS, PlaybackFailure.classify(EngineFault.DECODE, known(dead), played = false))
        assertEquals(FailureKind.NO_SEEDERS, PlaybackFailure.classify(EngineFault.NETWORK, known(dead), played = false))
        assertEquals(FailureKind.NO_SEEDERS, PlaybackFailure.classify(EngineFault.OTHER, known(dead), played = false))
        // listed, but nobody is connected, and nothing is loaded
        assertEquals(FailureKind.NO_SEEDERS, PlaybackFailure.classify(EngineFault.FORMAT, known(SwarmStats(totalPeers = 8)), played = false))
    }

    @Test
    fun peersWithNoDataKeepWaiting() {
        assertEquals(FailureKind.BUFFERING, PlaybackFailure.classify(EngineFault.FORMAT, known(peers), played = false))
        assertEquals(FailureKind.BUFFERING, PlaybackFailure.classify(EngineFault.NETWORK, known(peers), played = false))
        assertEquals(FailureKind.BUFFERING, PlaybackFailure.classify(EngineFault.DECODE, known(SwarmStats(seeders = 1, downloadSpeed = PlaybackFailure.QUIET_SPEED)), played = false))
        assertEquals(FailureKind.BUFFERING, PlaybackFailure.classify(EngineFault.FORMAT, known(SwarmStats(downloadSpeed = PlaybackFailure.QUIET_SPEED + 1)), played = false))
        assertEquals(FailureKind.BUFFERING, PlaybackFailure.classify(EngineFault.NONE, known(dead), played = false))
        assertEquals(FailureKind.BUFFERING, PlaybackFailure.classify(EngineFault.FORMAT, SwarmLookup.Pending, played = false))
    }

    @Test
    fun unreachableServer() {
        assertEquals(FailureKind.SERVER, PlaybackFailure.classify(EngineFault.FORMAT, SwarmLookup.Unreachable, played = false))
        assertEquals(FailureKind.SERVER, PlaybackFailure.classify(EngineFault.NETWORK, SwarmLookup.Unreachable, played = false))
        assertEquals(FailureKind.SERVER, PlaybackFailure.classify(EngineFault.DECODE, SwarmLookup.Unreachable, played = true))
    }

    @Test
    fun codecOnlyOnceDataFlowed() {
        assertEquals(FailureKind.CODEC, PlaybackFailure.classify(EngineFault.FORMAT, known(flowing), played = false))
        assertEquals(FailureKind.CODEC, PlaybackFailure.classify(EngineFault.DECODE, known(dead), played = true))
        assertEquals(FailureKind.CODEC, PlaybackFailure.classify(EngineFault.FORMAT, known(SwarmStats(loadedBytes = PlaybackFailure.EMPTY_BYTES)), played = false))
        assertEquals(FailureKind.BUFFERING, PlaybackFailure.classify(EngineFault.NETWORK, known(flowing), played = false))
        assertEquals(FailureKind.SERVER, PlaybackFailure.classify(EngineFault.NETWORK, known(SwarmStats(loadedBytes = PlaybackFailure.EMPTY_BYTES)), played = false))
    }

    @Test
    fun nonTorrentKeepsTheEngineText() {
        assertEquals(FailureKind.CODEC, PlaybackFailure.classify(EngineFault.FORMAT, SwarmLookup.Absent, played = false))
        assertEquals(FailureKind.OTHER, PlaybackFailure.classify(EngineFault.NETWORK, SwarmLookup.Absent, played = false))
    }

    @Test
    fun cacheStatsFeedTheLookup() {
        val t = TorrentStats(
            seeders = 2, activePeers = 4, totalPeers = 9, downSpeed = 1500.0,
            preloaded = 50, cacheFilled = 100, loadedSize = 80,
        )
        assertEquals(
            SwarmStats(activePeers = 4, totalPeers = 9, seeders = 2, preloadedBytes = 50, loadedBytes = 100, downloadSpeed = 1500.0),
            PlaybackFailure.statsOf(t),
        )
    }

    @Test
    fun textsInRussianAndEnglish() {
        I18n.lang = "ru"
        assertEquals("Нет раздающих — раздача сейчас недоступна. Попробуйте другую раздачу.", PlaybackFailure.message(FailureKind.NO_SEEDERS))
        assertEquals("Нет связи с TorrServer. Проверьте, что сервер включён и доступен в сети.", PlaybackFailure.message(FailureKind.SERVER))
        assertEquals("Формат видео не поддерживается", PlaybackFailure.message(FailureKind.CODEC))
        assertEquals("Подключаемся… пиров: 3, скорость 0 КБ/с", PlaybackFailure.connectingText(3, 0.0))
        I18n.lang = "en"
        assertEquals("No seeders — this torrent is unavailable right now. Try another release.", PlaybackFailure.message(FailureKind.NO_SEEDERS))
        assertEquals("Cannot reach TorrServer. Check that the server is on and reachable on the network.", PlaybackFailure.message(FailureKind.SERVER))
        assertEquals("The video format is not supported", PlaybackFailure.message(FailureKind.CODEC))
        assertEquals("Connecting… peers: 3, speed 0 KB/s", PlaybackFailure.connectingText(3, 0.0))
    }

    @Test
    fun deadReleaseNeedsAMinuteOfSilence() {
        val t0 = 1_000L
        val quiet = DeadRelease.step(null, t0, active = true, seeders = 0, bytes = 0)
        assertEquals(t0, quiet.since)
        assertEquals(false, quiet.dead)
        val later = DeadRelease.step(quiet.since, t0 + 59_000, true, 0, 0)
        assertEquals(false, later.dead)
        val dead = DeadRelease.step(quiet.since, t0 + DeadRelease.MS, true, 0, 0)
        assertEquals(true, dead.dead)
        val seeded = DeadRelease.step(quiet.since, t0 + DeadRelease.MS, true, 1, 0)
        assertEquals(null, seeded.since)
        assertEquals(false, seeded.dead)
        val bytes = DeadRelease.step(quiet.since, t0 + DeadRelease.MS, true, 0, 1)
        assertEquals(false, bytes.dead)
        val idle = DeadRelease.step(quiet.since, t0 + DeadRelease.MS, false, 0, 0)
        assertEquals(false, idle.dead)
    }
}
