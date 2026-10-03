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

/** What [SourcesInbox.done] made of the page's answer. */
enum class SourcesDone {
    /** Not the waiting transfer (late or unknown id). */
    UNKNOWN,
    /** Taken; a verified login (if any) is now the live one. */
    STORED,
    /** Taken, but the verified login could not be written: the TV has no new login. */
    NOT_STORED,
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

/**
 * The phone's login on its way to the page's rutracker source (the Keystore storage on the device). It is first
 * staged under separate entries; only a login the page verified replaces the live one ([promote]), anything else
 * drops the staged pair and keeps the login that worked ([discard]).
 */
interface LoginStore {
    /** Throws when the storage is unavailable. */
    fun stage(username: String, password: String)
    /** Staged pair → live entries in one write; throws when the storage is unavailable. */
    fun promote()
    /** Forgets the staged pair (never the live one). */
    fun discard()
}

/**
 * Hands a transfer to the page and waits for its answer ([done]), at most [timeoutMs]. One transfer at a time.
 * The login is staged before the page hears of it; the page event carries only `rutracker: true`. The event of
 * the waiting transfer is also kept ([pendingEvent]): a page that starts listening late asks for it instead of
 * getting a backlog of old ones. Thread-safe.
 */
class SourcesInbox(
    private val store: LoginStore,
    private val emit: (JSONObject) -> Unit,
    private val timeoutMs: Long = TIMEOUT_MS,
    private val clock: () -> Long = { System.currentTimeMillis() },
) {
    private class Pending(val id: String) {
        val latch = CountDownLatch(1)
        @Volatile
        var outcome: SourcesOutcome = SourcesOutcome.NoAnswer
        @Volatile
        var event: JSONObject? = null
        @Volatile
        var staged = false
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
            val login = t.login
            if (login != null) {
                p.staged = true
                if (!quietly { store.stage(login.username, login.password) }) return SourcesOutcome.StoreFailed
            }
            val sources = JSONObject()
            for ((id, on) in t.sources) sources.put(id, on)
            val event = JSONObject().put("id", p.id).put("sources", sources).put("rutracker", t.login != null)
                .put("phone", t.phone).put("at", clock())
            p.event = event
            emit(event)
            if (!p.latch.await(timeoutMs, TimeUnit.MILLISECONDS)) return SourcesOutcome.NoAnswer
            return p.outcome
        } finally {
            synchronized(lock) { if (pending === p) pending = null }
            // whatever is still staged was not verified (wrong, captcha, error, no answer): the live login stays;
            // after a promotion the staged entries are already gone
            if (p.staged) quietly { store.discard() }
        }
    }

    /** Runs a storage call; false when it threw. */
    private inline fun quietly(f: () -> Unit): Boolean = try {
        f()
        true
    } catch (_: Exception) {
        false
    }

    /** Drops a staged login that no transfer waits for (left by a process that died); false when the storage failed. */
    fun dropStaged(): Boolean = synchronized(lock) {
        if (pending != null) return true
        quietly { store.discard() }
    }

    /** The event of the transfer waiting for the page, null when none (answered or timed out). */
    fun pendingEvent(): JSONObject? = synchronized(lock) { pending?.event }

    /**
     * The page's answer. A verified login («ok») is promoted here, before the call returns, so the page reads the
     * new login as soon as its call resolves; [SourcesDone.NOT_STORED] tells it the promotion failed.
     */
    fun done(id: String?, rutracker: String?, failed: Boolean): SourcesDone = synchronized(lock) {
        val p = pending?.takeIf { it.id == id } ?: return SourcesDone.UNKNOWN
        var out: SourcesOutcome = when {
            failed -> SourcesOutcome.Failed
            rutracker == null -> SourcesOutcome.Applied(null)
            else -> SourcesOutcome.Applied(if (rutracker in SourcesProtocol.RESULTS) rutracker else "error")
        }
        if (p.staged && out == SourcesOutcome.Applied("ok") && !quietly { store.promote() }) out = SourcesOutcome.StoreFailed
        p.outcome = out
        p.latch.countDown()
        if (out == SourcesOutcome.StoreFailed) SourcesDone.NOT_STORED else SourcesDone.STORED
    }

    companion object {
        /** The page may sign in to rutracker (one request, 20 s at most) before it answers; the phone waits 45 s. */
        const val TIMEOUT_MS = 35_000L
    }
}

/** The few calls of the encrypted storage the login transfer needs ([com.spacesarmat.omp.sources.SecretStorage]). */
interface SecretEntries {
    fun get(name: String): String?
    /** All of [values] written and [remove] removed in one commit, or nothing (throws). */
    fun replace(values: Map<String, String>, remove: Collection<String>)
}

/**
 * [LoginStore] over the page's secret entries: staged under `rutracker.pending.*`, promoted to the live
 * `rutracker.username` / `rutracker.password` that src/sources/rutracker.ts reads. [key] maps a page key to its
 * storage name (the `js:` namespace on the device).
 */
class SecretLoginStore(private val secrets: SecretEntries, private val key: (String) -> String) : LoginStore {
    override fun stage(username: String, password: String) {
        secrets.replace(mapOf(key(PENDING_USER) to username, key(PENDING_PASS) to password), emptyList())
    }

    override fun promote() {
        val user = secrets.get(key(PENDING_USER))
        val pass = secrets.get(key(PENDING_PASS))
        if (user == null || pass == null) throw IllegalStateException("nothing staged")
        secrets.replace(mapOf(key(USER) to user, key(PASS) to pass), listOf(key(PENDING_USER), key(PENDING_PASS)))
    }

    override fun discard() {
        secrets.replace(emptyMap(), listOf(key(PENDING_USER), key(PENDING_PASS)))
    }

    companion object {
        const val USER = "rutracker.username"
        const val PASS = "rutracker.password"
        const val PENDING_USER = "rutracker.pending.username"
        const val PENDING_PASS = "rutracker.pending.password"
    }
}
