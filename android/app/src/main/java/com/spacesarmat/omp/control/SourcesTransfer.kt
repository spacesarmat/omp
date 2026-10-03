package com.spacesarmat.omp.control

import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import org.json.JSONObject

/**
 * «Передать на телевизор» (POST /omp/sources, see src/sources/transfer.ts): the phone's source switches and,
 * when asked, the rutracker login. The password is never put into toString, logs, events or answers.
 */
class SourcesTransfer(val sources: Map<String, Boolean>, val login: Login?, val phone: String) {
    class Login(val username: String, val password: String) {
        override fun toString() = "Login(***)"
    }

    override fun toString() = "SourcesTransfer(${sources.size} sources, login=${login != null})"
}

/** What became of a transfer; the router turns it into the HTTP answer. */
sealed class SourcesOutcome {
    /** The page applied it; [rutracker] = ok | bad_login | captcha | error, null when no login came. */
    data class Applied(val rutracker: String?) : SourcesOutcome()
    /** Another transfer is still being applied. */
    object Busy : SourcesOutcome()
    /** The page did not answer in time (OMP is not running its interface). */
    object NoAnswer : SourcesOutcome()
    /** The page could not apply it. */
    object Failed : SourcesOutcome()
    /** The encrypted storage refused the login. */
    object StoreFailed : SourcesOutcome()
}

/** Schema of the request body; the same limits as src/sources/transfer.ts. Pure (unit-tested). */
object SourcesProtocol {
    const val VERSION = 1
    const val MAX_BODY = 8_192
    const val MAX_SOURCES = 40
    const val MAX_USERNAME = 100
    const val MAX_PASSWORD = 200
    val RESULTS = setOf("ok", "bad_login", "captcha", "error")
    private val SOURCE_ID = Regex("^[a-z0-9][a-z0-9-]{0,39}$")
    private val KEYS = setOf("v", "sources", "rutracker")

    /** null when the body does not follow the schema (unknown keys included). */
    fun parse(body: JSONObject, phone: String): SourcesTransfer? {
        val v = body.opt("v")
        if (v !is Number || v.toDouble() != VERSION.toDouble()) return null
        val keys = body.keys()
        while (keys.hasNext()) if (keys.next() !in KEYS) return null
        val src = body.opt("sources") as? JSONObject ?: return null
        if (src.length() < 1 || src.length() > MAX_SOURCES) return null
        val sources = LinkedHashMap<String, Boolean>()
        val ids = src.keys()
        while (ids.hasNext()) {
            val id = ids.next()
            val on = src.opt(id)
            if (!SOURCE_ID.matches(id) || on !is Boolean) return null
            sources[id] = on
        }
        val raw = body.opt("rutracker")
        val login = when {
            raw == null || raw == JSONObject.NULL -> null
            raw is JSONObject -> login(raw) ?: return null
            else -> return null
        }
        return SourcesTransfer(sources, login, phone)
    }

    private fun login(o: JSONObject): SourcesTransfer.Login? {
        val u = (o.opt("username") as? String)?.trim() ?: return null
        val p = o.opt("password") as? String ?: return null
        if (u.isEmpty() || u.length > MAX_USERNAME || u.any { it.isISOControl() }) return null
        if (p.isEmpty() || p.length > MAX_PASSWORD) return null
        return SourcesTransfer.Login(u, p)
    }
}

/** Writes the login where the page's rutracker source reads it (the Keystore storage on the device). */
interface LoginStore {
    /** Throws when the storage is unavailable. */
    fun save(username: String, password: String)
}

/**
 * Hands a transfer to the page and waits for its answer ([done]), at most [timeoutMs]. One transfer at a time.
 * The login is saved before the page hears of it; the page event carries only `rutracker: true`. Thread-safe.
 */
class SourcesInbox(
    private val store: LoginStore,
    private val emit: (JSONObject) -> Unit,
    private val timeoutMs: Long = TIMEOUT_MS,
) {
    private class Pending(val id: String) {
        val latch = CountDownLatch(1)
        @Volatile
        var outcome: SourcesOutcome = SourcesOutcome.NoAnswer
    }

    private val lock = Any()
    private var pending: Pending? = null
    private val seq = AtomicLong(System.nanoTime() and 0xffffff)

    /** Blocking (a control server thread). */
    fun receive(t: SourcesTransfer): SourcesOutcome {
        val p = synchronized(lock) {
            if (pending != null) return SourcesOutcome.Busy
            Pending("s" + seq.incrementAndGet()).also { pending = it }
        }
        try {
            t.login?.let {
                try {
                    store.save(it.username, it.password)
                } catch (_: Exception) {
                    return SourcesOutcome.StoreFailed
                }
            }
            val sources = JSONObject()
            for ((id, on) in t.sources) sources.put(id, on)
            emit(
                JSONObject().put("id", p.id).put("sources", sources).put("rutracker", t.login != null).put("phone", t.phone),
            )
            if (!p.latch.await(timeoutMs, TimeUnit.MILLISECONDS)) return SourcesOutcome.NoAnswer
            return p.outcome
        } finally {
            synchronized(lock) { if (pending === p) pending = null }
        }
    }

    /** The page's answer: false when [id] is not the transfer waiting (late, unknown). */
    fun done(id: String?, rutracker: String?, failed: Boolean): Boolean {
        val p = synchronized(lock) { pending?.takeIf { it.id == id } } ?: return false
        p.outcome = when {
            failed -> SourcesOutcome.Failed
            rutracker == null -> SourcesOutcome.Applied(null)
            else -> SourcesOutcome.Applied(if (rutracker in SourcesProtocol.RESULTS) rutracker else "error")
        }
        p.latch.countDown()
        return true
    }

    companion object {
        /** The page may sign in to rutracker (one request, 20 s at most) before it answers. */
        const val TIMEOUT_MS = 35_000L
    }
}
