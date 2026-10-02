package com.spacesarmat.omp.player

/**
 * Port of src/player/seek.ts (LG ◀/▶ rule): the step grows every 4 repeats up to ×6 —
 * seekStep(10, 0) = 10, seekStep(10, 3) = 10, seekStep(10, 4) = 20, seekStep(10, 100) = 60.
 */
fun seekStep(base: Int, repeat: Int): Int = base * minOf(1 + repeat / 4, 6)

/**
 * Port of SeekAccumulator (src/player/seek.ts): repeated presses (including key auto-repeat) collect into one
 * target; a press within [repeatWindowMs] of the previous one counts as a repeat. The owner commits the target
 * [COMMIT_DELAY_MS] after the last press ([take]), or drops it ([cancel]); both reset the acceleration.
 * Times are in ms, [base] in seconds. Cases of tests/player/seek.test.ts (in seconds there):
 * - press(+1, 100, 1000, 10) = 110, then within the window press(+1, 100, 1000, 10) = 120 (pending 120, applied once);
 * - clamps to [0, duration − 1 s]: press(−1, 5, 1000, 10) = 0; press(+1, 995, 1000, 10) = 999;
 * - five quick presses, then take()/cancel(), then a press = base step again (10).
 */
class SeekAccumulator(
    private val now: () -> Long,
    private val repeatWindowMs: Long = 900,
) {
    private var target: Long? = null
    private var repeat = 0
    private var lastAt = NEVER

    fun press(dir: Int, currentMs: Long, durationMs: Long, base: Int): Long {
        val t = now()
        repeat = if (t - lastAt < repeatWindowMs) repeat + 1 else 0
        lastAt = t
        val from = target ?: currentMs
        val max = if (durationMs > 0) maxOf(0L, durationMs - 1000) else Long.MAX_VALUE
        val next = (from + dir * seekStep(base, repeat) * 1000L).coerceIn(0L, max)
        target = next
        return next
    }

    fun pending(): Long? = target

    /** The target to apply now (null when none); resets the acceleration. */
    fun take(): Long? {
        val v = target
        reset()
        return v
    }

    fun cancel() = reset()

    private fun reset() {
        target = null
        repeat = 0
        lastAt = NEVER
    }

    companion object {
        const val COMMIT_DELAY_MS = 700L
        private const val NEVER = Long.MIN_VALUE / 2
    }
}
