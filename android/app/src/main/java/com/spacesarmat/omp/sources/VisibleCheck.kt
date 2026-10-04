package com.spacesarmat.omp.sources

import com.spacesarmat.omp.control.CloudflareRelay
import okhttp3.HttpUrl

/** The screen of a visible check (the Android dialog on the device, a fake in tests). Main thread only. */
interface CheckUi {
    /** Another WebView check holds the gate: the dialog says so while it waits. */
    fun showWaiting()

    /** The page is open in [browser]: the dialog shows it. */
    fun showPage(browser: CloudflareBrowser)

    fun setHint(text: String?)

    /** Closes the dialog (before the page is destroyed). */
    fun dismiss()
}

/** Where a passed check goes: this device's jar, or the TV that asked the phone. */
sealed class CheckTarget {
    /** Throws when the encrypted storage refuses the cookies. */
    class Local(val store: (pairs: List<Pair<String, String>>, until: Long) -> Unit) : CheckTarget()

    /** [answer] sends the solved body (null pairs = cancelled) and returns the TV's HTTP status (-1 = no answer). */
    class Tv(val answer: (pairs: List<Pair<String, String>>?, ua: String, until: Long) -> Int) : CheckTarget()
}

/**
 * The state machine of the visible Cloudflare check (pure, JVM-tested; [CloudflareCheckDialog] is its screen): waits
 * up to [gateWaitMs] for [CloudflareSolver.WEB_CHECKS] (showing «ждём другую проверку»), opens the site root with this
 * device's User-Agent, polls `cf_clearance` every [pollMs], gives up after [maxOpenMs]. On every way out the dialog is
 * dismissed first, then the page's own cookies are expired and the page destroyed, then the gate is left; [done] is
 * called exactly once on the scheduler thread. TV: «Пройти на телефоне» asks the paired phone through [relay].
 */
class VisibleCheck(
    private val root: HttpUrl,
    private val site: String,
    private val texts: CheckTexts,
    private val browsers: () -> CloudflareBrowser,
    private val scheduler: CloudflareSolver.Scheduler,
    private val userAgent: () -> String,
    private val wallClock: () -> Long,
    /** Runs blocking work (storage, the TV answer, the relay) off the scheduler thread. */
    private val background: (() -> Unit) -> Unit,
    private val target: CheckTarget,
    private val relay: CloudflareRelay?,
    private val done: (CheckResult) -> Unit,
    private val gate: CheckGate = CloudflareSolver.WEB_CHECKS,
    private val gateWaitMs: Long = GATE_WAIT_MS,
    private val pollMs: Long = POLL_MS,
    private val maxOpenMs: Long = MAX_OPEN_MS,
) {
    private var ui: CheckUi? = null
    private var browser: CloudflareBrowser? = null
    private var entered = false
    private var ended = false
    private var reported = false
    private var asking = false
    private var opened = 0L

    fun start(screen: CheckUi) {
        ui = screen
        enter(scheduler.now(), first = true)
    }

    private fun enter(since: Long, first: Boolean) {
        if (ended) return
        if (gate.tryEnter()) {
            entered = true
            return open()
        }
        if (first) ui?.showWaiting()
        if (scheduler.now() - since >= gateWaitMs) return finish(CheckResult("busy"))
        scheduler.post(pollMs) { enter(since, first = false) }
    }

    private fun open() {
        val b = try {
            browsers()
        } catch (e: Throwable) {
            return finish(CheckResult("failed"))
        }
        browser = b
        try {
            b.open(root.toString(), userAgent(), object : CloudflareBrowser.Events {
                override fun onFinished() {}
                // an error page is shown to the person as it is: «Отмена» closes it
                override fun onError() {}
            })
            ui?.showPage(b)
        } catch (e: Throwable) {
            return finish(CheckResult("failed"))
        }
        opened = scheduler.now()
        if (relay != null) {
            val phone = relay.phone()
            ui?.setHint(if (phone != null) texts.hint?.replace("%s", phone) else noPhoneText())
        }
        scheduler.post(pollMs) { poll() }
    }

    private fun noPhoneText(): String? = if (relay?.anyPaired() == true) texts.phoneClosed ?: texts.noPhone else texts.noPhone

    private fun poll() {
        if (ended) return
        val b = browser ?: return
        val pairs = try {
            CloudflareSolver.parseCookieHeader(b.cookies(root.toString()))
        } catch (e: Throwable) {
            emptyList()
        }
        if (pairs.any { it.first == CloudflareSolver.CLEARANCE }) return cleared(pairs)
        if (scheduler.now() - opened >= maxOpenMs) return cancel()
        scheduler.post(pollMs) { poll() }
    }

    /** Passed here: the cookies are taken, the page closed, then stored or sent to the TV. */
    private fun cleared(pairs: List<Pair<String, String>>) {
        if (ended) return
        relay?.cancel()
        val until = wallClock() + CloudflareSolver.COPIED_TTL_MS
        val ua = userAgent()
        close()
        background {
            val r = when (val t = target) {
                is CheckTarget.Tv -> when (t.answer(pairs, ua, until)) {
                    200 -> CheckResult("solved", sent = true)
                    // the TV passed it itself meanwhile: nothing to tell
                    410 -> CheckResult("done")
                    else -> CheckResult("solved", sent = false)
                }
                is CheckTarget.Local -> try {
                    t.store(pairs, until)
                    CheckResult("solved", via = "here")
                } catch (e: Exception) {
                    CheckResult("failed")
                }
            }
            scheduler.post(0) { report(r) }
        }
    }

    /** «Отмена», Back, the dialog dismissed, the activity gone, or open too long. */
    fun cancel() {
        if (ended) return
        relay?.cancel()
        close()
        val t = target
        if (t is CheckTarget.Tv) background { t.answer(null, "", 0) }
        report(CheckResult("cancelled"))
    }

    private fun finish(r: CheckResult) {
        if (ended) return
        close()
        report(r)
    }

    private fun report(r: CheckResult) {
        if (reported) return
        reported = true
        done(r)
    }

    private fun close() {
        ended = true
        // the page is detached from the dialog before it is destroyed
        try {
            ui?.dismiss()
        } catch (e: Throwable) {
            // the activity is gone
        }
        ui = null
        val b = browser
        browser = null
        if (b != null) {
            try {
                b.forget(root.toString())
            } catch (e: Throwable) {
                // nothing to drop
            }
            try {
                b.close()
            } catch (e: Throwable) {
                // closing a broken page must not lose the result
            }
        }
        if (entered) {
            entered = false
            gate.leave()
        }
    }

    // ---- «Пройти на телефоне» (TV) ----

    fun askPhone() {
        val r = relay ?: return
        if (asking || ended || browser == null) return
        val phone = r.phone()
        if (phone == null) {
            ui?.setHint(noPhoneText())
            return
        }
        asking = true
        ui?.setHint(texts.waiting?.replace("%s", phone))
        background {
            val outcome = r.ask(site, root)
            scheduler.post(0) {
                asking = false
                if (ended) return@post
                when (outcome) {
                    // the relay has stored the phone's cookies and User-Agent
                    CloudflareRelay.Outcome.SOLVED -> finish(CheckResult("solved", via = "phone"))
                    CloudflareRelay.Outcome.NO_PHONE -> ui?.setHint(noPhoneText())
                    else -> ui?.setHint(texts.errors[outcome.name])
                }
            }
        }
    }

    companion object {
        const val POLL_MS = 500L
        const val GATE_WAIT_MS = 25_000L
        /** A check left open this long is closed as cancelled (the WebView and the gate are not held forever). */
        const val MAX_OPEN_MS = 5L * 60 * 1000
    }
}
