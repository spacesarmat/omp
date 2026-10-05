package com.spacesarmat.omp.sources

import com.spacesarmat.omp.control.CloudflareRelay
import okhttp3.HttpUrl

/** Where a browser sign-in goes: this device's jar, or the TV that asked the phone («Войти на телефоне»). */
sealed class LoginTarget {
    /** [ua] = the User-Agent the session was made with when it is not this device's (the phone's); throws when storage fails. */
    class Local(val store: (root: HttpUrl, pairs: List<Pair<String, String>>, ua: String?) -> Unit) : LoginTarget()

    /** [answer] sends the session (null = cancelled) and returns the TV's HTTP status (-1 = no answer). */
    class Tv(val answer: (host: String?, pairs: List<Pair<String, String>>?, ua: String) -> Int) : LoginTarget()
}

/**
 * «Войти через браузер» (pure, JVM-tested; [CloudflareCheckDialog] is its screen): the person signs in to the site in a
 * visible page themselves (any captcha too). Waits up to [gateWaitMs] for [CloudflareSolver.WEB_CHECKS], opens the login
 * page [start] with this device's User-Agent, and every [pollMs] reads the cookies of the site's [hosts]. When they look
 * signed in ([SiteSession.ready]) and changed since the last try, they are checked with a native request ([verify]: the
 * check page with only those cookies) at most every [verifyEveryMs]; a verified session goes to [target]. On every way
 * out the dialog is dismissed first, then the page's own cookies and storage are expired and the page destroyed, then
 * the gate is left; [done] is called exactly once on the scheduler thread. TV: «Войти на телефоне» asks the paired
 * phone through [relay]; its session is checked the same way before it is kept. Cookies are never logged.
 */
class BrowserLogin(
    private val start: HttpUrl,
    private val hosts: List<String>,
    private val check: SiteSession.Check,
    private val site: String,
    private val source: String,
    private val texts: CheckTexts,
    private val browsers: () -> CloudflareBrowser,
    private val scheduler: CloudflareSolver.Scheduler,
    private val userAgent: () -> String,
    /** Runs blocking work (the check request, storage, the TV answer, the relay) off the scheduler thread. */
    private val background: (() -> Unit) -> Unit,
    /** Blocking: the session [pairs] on [root] with [ua] opens the check page as a signed-in one. */
    private val verify: (root: HttpUrl, pairs: List<Pair<String, String>>, ua: String) -> Boolean,
    private val target: LoginTarget,
    private val relay: CloudflareRelay?,
    private val done: (CheckResult) -> Unit,
    private val gate: CheckGate = CloudflareSolver.WEB_CHECKS,
    private val gateWaitMs: Long = VisibleCheck.GATE_WAIT_MS,
    private val pollMs: Long = POLL_MS,
    private val verifyEveryMs: Long = VERIFY_EVERY_MS,
    private val maxOpenMs: Long = MAX_OPEN_MS,
    /** TV «Войти на телефоне» from the login dialog: the phone is asked as soon as the page is open. */
    private val askPhoneFirst: Boolean = false,
) : CheckControl {
    private var ui: CheckUi? = null
    private var browser: CloudflareBrowser? = null
    private var entered = false
    // read on the background thread before a late phone session is stored
    @Volatile
    private var ended = false
    private var reported = false
    private var asking = false
    private var verifying = false
    private var lastKey: String? = null
    private var lastVerify = Long.MIN_VALUE / 2
    /** Per root: the cookie names already seen (the guest cookies on the first sight, then every name tried). */
    private val baseline = HashMap<String, MutableSet<String>>()
    private var opened = 0L

    /** The roots whose cookies are read: the login page's host first, then the other mirrors. */
    private val roots: List<HttpUrl> = run {
        val first = CloudflareSolver.siteRoot(start)
        val out = arrayListOf(first)
        for (h in hosts) {
            if (h == first.host) continue
            try {
                out.add(first.newBuilder().host(h).build())
            } catch (e: IllegalArgumentException) {
                // not a host
            }
        }
        out
    }

    override fun start(screen: CheckUi) {
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
            b.open(start.toString(), userAgent(), object : CloudflareBrowser.Events {
                override fun onFinished() {}
                // an error page is shown as it is: «Отмена» closes it
                override fun onError() {}
                override fun onBlocked() {
                    scheduler.post(0) { if (!ended) ui?.setHint(texts.blocked) }
                }
            })
            ui?.showPage(b)
        } catch (e: Throwable) {
            return finish(CheckResult("failed"))
        }
        opened = scheduler.now()
        // a sign-in signal may be checked at once; the slow path counts from the page's opening
        lastVerify = opened - verifyEveryMs
        if (relay != null) {
            val phone = relay.phone()
            ui?.setHint(if (phone != null) texts.hint?.replace("%s", phone) else noPhoneText())
        }
        scheduler.post(pollMs) { poll() }
        if (askPhoneFirst) askPhone()
    }

    private fun noPhoneText(): String? = if (relay?.anyPaired() == true) texts.phoneClosed ?: texts.noPhone else texts.noPhone

    private fun poll() {
        if (ended) return
        val b = browser ?: return
        if (scheduler.now() - opened >= maxOpenMs) return cancel()
        if (!verifying && scheduler.now() - lastVerify >= verifyEveryMs) {
            for (root in roots) {
                val pairs = try {
                    SiteSession.clean(CloudflareSolver.parseCookieHeader(b.cookies(root.toString())))
                } catch (e: Throwable) {
                    emptyList()
                }
                val names = pairs.filter { !CloudflareCookies.isCloudflare(it.first) && it.second.isNotEmpty() }.map { it.first }
                if (names.isEmpty()) continue
                val seen = baseline[root.host]
                if (seen == null) {
                    // the first cookies of this root are the guest's: a sign-in brings a named or a new cookie
                    baseline[root.host] = names.toMutableSet()
                    if (check.cookies.none { it in names }) continue
                }
                val key = root.host + "\n" + pairs.sortedBy { it.first }.joinToString(";") { it.first + "=" + it.second }
                val since = scheduler.now() - lastVerify
                val signal = check.cookies.any { it in names } || names.any { seen != null && it !in seen }
                // a sign-in signal: at once when the cookies changed, the same ones again after a while; without one,
                // any site cookie is tried only every SLOW_MS (no cookie names known for the site)
                val due = if (signal) key != lastKey || since >= RETRY_SAME_MS else since >= SLOW_MS
                if (!due) continue
                lastKey = key
                baseline.getOrPut(root.host) { HashSet() }.addAll(names)
                tryVerify(root, pairs)
                break
            }
        }
        scheduler.post(pollMs) { poll() }
    }

    private fun tryVerify(root: HttpUrl, pairs: List<Pair<String, String>>) {
        verifying = true
        lastVerify = scheduler.now()
        val ua = userAgent()
        background {
            val ok = try {
                verify(root, pairs, ua)
            } catch (e: Throwable) {
                false
            }
            scheduler.post(0) {
                verifying = false
                if (ok && !ended) signedIn(root, pairs, ua)
            }
        }
    }

    /** Verified here: the page is closed, then the session stored or sent to the TV. */
    private fun signedIn(root: HttpUrl, pairs: List<Pair<String, String>>, ua: String) {
        if (ended) return
        relay?.cancel()
        close()
        background {
            val r = when (val t = target) {
                is LoginTarget.Tv -> when (t.answer(root.host, pairs, ua)) {
                    200 -> CheckResult("ok", sent = true, host = root.host)
                    410 -> CheckResult("done")
                    else -> CheckResult("ok", sent = false, host = root.host)
                }
                is LoginTarget.Local -> try {
                    t.store(root, pairs, null)
                    CheckResult("ok", via = "here", host = root.host)
                } catch (e: Exception) {
                    // signed in, but the encrypted storage refused it: nothing is kept, the page says so
                    CheckResult(STORE_FAILED)
                }
            }
            scheduler.post(0) { report(r) }
        }
    }

    /** «Отмена», Back, the dialog dismissed, the activity gone, or open too long. */
    override fun cancel() {
        if (ended) return
        relay?.cancel()
        close()
        val t = target
        if (t is LoginTarget.Tv) background { t.answer(null, null, "") }
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
        try {
            ui?.dismiss()
        } catch (e: Throwable) {
            // the activity is gone
        }
        ui = null
        val b = browser
        browser = null
        if (b != null) {
            // the page's own copy of the session (and everything else it saw, every mirror) goes: it lives on in the jar only
            for (u in listOf(start.toString()) + roots.map { it.toString() }) {
                try {
                    b.forget(u)
                } catch (e: Throwable) {
                    // nothing to drop
                }
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

    // ---- «Войти на телефоне» (TV) ----

    override fun askPhone() {
        val r = relay ?: return
        if (asking || ended || browser == null) return
        val phone = r.phone()
        if (phone == null) {
            ui?.setHint(noPhoneText())
            return
        }
        asking = true
        ui?.setHint(texts.waiting?.replace("%s", phone))
        val root = CloudflareSolver.siteRoot(start)
        background {
            val got = r.askLogin(site, root, source, hosts)
            val s = got.session
            // the phone's session is checked here, with the phone's User-Agent, before it is kept
            var outcome = got.outcome.name
            var result: CheckResult? = null
            if (got.outcome == CloudflareRelay.Outcome.SOLVED && s != null) {
                val sRoot = try {
                    root.newBuilder().host(s.host).build()
                } catch (e: IllegalArgumentException) {
                    null
                }
                val pairs = SiteSession.clean(s.cookies)
                val ok = sRoot != null && try {
                    verify(sRoot, pairs, s.ua)
                } catch (e: Throwable) {
                    false
                }
                if (!ok || sRoot == null) {
                    outcome = UNVERIFIED
                } else {
                    val t = target
                    result = if (ended) {
                        // «Отмена» while the phone answered: the late session is dropped, never stored
                        outcome = CloudflareRelay.Outcome.CANCELLED.name
                        null
                    } else if (t is LoginTarget.Local) {
                        try {
                            t.store(sRoot, pairs, s.ua)
                            CheckResult("ok", via = "phone", host = sRoot.host)
                        } catch (e: Exception) {
                            outcome = CloudflareRelay.Outcome.STORE_FAILED.name
                            null
                        }
                    } else {
                        null
                    }
                }
            }
            scheduler.post(0) {
                asking = false
                if (ended) return@post
                when {
                    result != null -> finish(result!!)
                    outcome == CloudflareRelay.Outcome.NO_PHONE.name -> ui?.setHint(noPhoneText())
                    else -> ui?.setHint(texts.errors[outcome])
                }
            }
        }
    }

    companion object {
        const val POLL_MS = 1_000L
        const val VERIFY_EVERY_MS = 3_000L
        const val RETRY_SAME_MS = 15_000L
        /** Without a sign-in signal (no known cookie name, no new cookie) a check at most this often. */
        const val SLOW_MS = 30_000L
        /** The result of a sign-in the encrypted storage refused. */
        const val STORE_FAILED = "store_failed"
        /** A sign-in left open this long is closed as cancelled (the WebView and the gate are not held forever). */
        const val MAX_OPEN_MS = 10L * 60 * 1000
        /** The errors key of a phone session that did not open the check page. */
        const val UNVERIFIED = "UNVERIFIED"
    }
}
