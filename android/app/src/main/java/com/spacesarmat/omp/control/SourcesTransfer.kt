package com.spacesarmat.omp.control

import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import org.json.JSONArray
import org.json.JSONObject

/**
 * «Передать на телевизор» (POST /omp/sources, see src/sources/transfer.ts): the phone's source switches and,
 * when asked, the rutracker login and the Jackett / Prowlarr connections with their API keys. The password and the
 * keys are never put into toString, logs, events or answers.
 */
class SourcesTransfer(
    val sources: Map<String, Boolean>,
    val login: Login?,
    val phone: String,
    val indexers: List<Indexer> = emptyList(),
    /** The phone's FlareSolverr address (normal form), null when none came. */
    val flaresolverr: String? = null,
    /** «Обходить проверку Cloudflare» per site id (Cloudflare-capable sites only), empty when none came. */
    val cloudflare: Map<String, Boolean> = emptyMap(),
) {
    class Login(val username: String, val password: String) {
        override fun toString() = "Login(***)"
    }

    /** [url] is in the page's normal form (the page derives the connection id from it); [key] only when sent. */
    class Indexer(val kind: String, val url: String, val name: String?, val key: String?) {
        override fun toString() = "Indexer($kind, key=${key != null})"
    }

    override fun toString() =
        "SourcesTransfer(${sources.size} sources, login=${login != null}, indexers=${indexers.size}, flare=${flaresolverr != null}, cloudflare=${cloudflare.size})"
}

/** What became of a transfer; the router turns it into the HTTP answer. */
sealed class SourcesOutcome {
    /**
     * The page applied it; [rutracker] = ok | bad_login | captcha | error, null when no login came; [indexers] = how
     * many connections the page saved, null when none came.
     */
    data class Applied(val rutracker: String?, val indexers: Int? = null) : SourcesOutcome()
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
    const val MAX_BODY = 16_384
    const val MAX_SOURCES = 40
    const val MAX_USERNAME = 100
    const val MAX_PASSWORD = 200
    const val MAX_INDEXERS = 20
    const val MAX_INDEXER_URL = 200
    const val MAX_INDEXER_NAME = 40
    val RESULTS = setOf("ok", "bad_login", "captcha", "error")
    private val SOURCE_ID = Regex("^[a-z0-9][a-z0-9-]{0,39}$")
    private val KEYS = setOf("v", "sources", "rutracker", "indexers", "flaresolverr", "cloudflare")
    const val MAX_FLARE_URL = 200
    /** The page's normal form of a FlareSolverr address (src/sources/flareStore.ts normalizeFlareUrl). */
    private val FLARE_URL = Regex("""^https?://([a-z0-9.-]+|\[[0-9a-f:.]+])(:\d{1,5})?(/[^\s@?#]*)?$""")
    private val INDEXER_FIELDS = setOf("kind", "url", "name", "key")
    private val KINDS = setOf("jackett", "prowlarr")
    /** The page's normalized form: lowercase scheme and host, no credentials, query, hash or trailing slash. */
    private val INDEXER_URL = Regex("^https?://[^\\s/?#@A-Z]+(/[^\\s?#]*)?$")
    /** Printable ASCII without spaces, 1..200: what Jackett and Prowlarr keys are made of. */
    private val INDEXER_KEY = Regex("^[\\x21-\\x7e]{1,200}$")

    /** null when the body does not follow the schema (unknown keys included). */
    fun parse(body: JSONObject, phone: String): SourcesTransfer? {
        val v = body.opt("v")
        if (v !is Number || v.toDouble() != VERSION.toDouble()) return null
        val keys = body.keys()
        while (keys.hasNext()) if (keys.next() !in KEYS) return null
        val src = body.opt("sources") as? JSONObject ?: return null
        if (src.length() < 1 || src.length() > MAX_SOURCES) return null
        val sources = switches(src) ?: return null
        val raw = body.opt("rutracker")
        val login = when {
            raw == null || raw == JSONObject.NULL -> null
            raw is JSONObject -> login(raw) ?: return null
            else -> return null
        }
        val rawIdx = body.opt("indexers")
        val indexers = when {
            rawIdx == null -> emptyList()
            rawIdx is JSONArray -> indexers(rawIdx) ?: return null
            else -> return null
        }
        val flare = when (val f = body.opt("flaresolverr")) {
            null -> null
            is String -> f.takeIf { it.length <= MAX_FLARE_URL && FLARE_URL.matches(it) && !it.endsWith("/") } ?: return null
            else -> return null
        }
        val cloudflare = when (val c = body.opt("cloudflare")) {
            null -> emptyMap()
            is JSONObject -> if (c.length() < 1) return null else switches(c) ?: return null
            else -> return null
        }
        return SourcesTransfer(sources, login, phone, indexers, flare, cloudflare)
    }

    /** { id: boolean }, 1..[MAX_SOURCES] source ids. */
    private fun switches(o: JSONObject): Map<String, Boolean>? {
        if (o.length() < 1 || o.length() > MAX_SOURCES) return null
        val out = LinkedHashMap<String, Boolean>()
        val ids = o.keys()
        while (ids.hasNext()) {
            val id = ids.next()
            val on = o.opt(id)
            if (!SOURCE_ID.matches(id) || on !is Boolean) return null
            out[id] = on
        }
        return out
    }

    private fun indexers(a: JSONArray): List<SourcesTransfer.Indexer>? {
        if (a.length() < 1 || a.length() > MAX_INDEXERS) return null
        val out = ArrayList<SourcesTransfer.Indexer>()
        for (i in 0 until a.length()) {
            val x = indexer(a.opt(i) as? JSONObject ?: return null) ?: return null
            if (out.any { it.kind == x.kind && it.url == x.url }) return null
            out.add(x)
        }
        return out
    }

    private fun indexer(o: JSONObject): SourcesTransfer.Indexer? {
        val keys = o.keys()
        while (keys.hasNext()) if (keys.next() !in INDEXER_FIELDS) return null
        val kind = o.opt("kind") as? String ?: return null
        if (kind !in KINDS) return null
        val url = o.opt("url") as? String ?: return null
        if (url.length > MAX_INDEXER_URL || !INDEXER_URL.matches(url) || url.endsWith("/")) return null
        val name = when (val n = o.opt("name")) {
            null -> null
            is String -> n.trim().takeIf { it.isNotEmpty() && it.length <= MAX_INDEXER_NAME && it.none { c -> c.isISOControl() } } ?: return null
            else -> return null
        }
        val key = when (val k = o.opt("key")) {
            null -> null
            is String -> k.takeIf { INDEXER_KEY.matches(it) } ?: return null
            else -> return null
        }
        return SourcesTransfer.Indexer(kind, url, name, key)
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
    /** Stages the API keys of the transferred connections by their position; throws when the storage is unavailable. */
    fun stageKeys(keys: Map<Int, String>)
    /** Forgets every staged API key (the page has moved the ones it took). */
    fun discardKeys()
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
        @Volatile
        var keysStaged = false
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
            val keys = LinkedHashMap<Int, String>()
            t.indexers.forEachIndexed { i, x -> x.key?.let { keys[i] = it } }
            if (keys.isNotEmpty()) {
                p.keysStaged = true
                if (!quietly { store.stageKeys(keys) }) return SourcesOutcome.StoreFailed
            }
            val sources = JSONObject()
            for ((id, on) in t.sources) sources.put(id, on)
            val event = JSONObject().put("id", p.id).put("sources", sources).put("rutracker", t.login != null)
                .put("phone", t.phone).put("at", clock())
            if (t.indexers.isNotEmpty()) {
                // the page hears only that a key was staged, never the key
                val list = JSONArray()
                for (x in t.indexers) {
                    val o = JSONObject().put("kind", x.kind).put("url", x.url).put("key", x.key != null)
                    x.name?.let { o.put("name", it) }
                    list.put(o)
                }
                event.put("indexers", list)
            }
            // not secrets: the FlareSolverr address and the sites' switches go to the page as they are
            t.flaresolverr?.let { event.put("flaresolverr", it) }
            if (t.cloudflare.isNotEmpty()) {
                val cf = JSONObject()
                for ((id, on) in t.cloudflare) cf.put(id, on)
                event.put("cloudflare", cf)
            }
            p.event = event
            emit(event)
            if (!p.latch.await(timeoutMs, TimeUnit.MILLISECONDS)) return SourcesOutcome.NoAnswer
            return p.outcome
        } finally {
            synchronized(lock) { if (pending === p) pending = null }
            // whatever is still staged was not verified (wrong, captcha, error, no answer): the live login stays;
            // after a promotion the staged entries are already gone
            if (p.staged) quietly { store.discard() }
            // keys the page did not move stay nowhere
            if (p.keysStaged) quietly { store.discardKeys() }
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
        val login = quietly { store.discard() }
        val keys = quietly { store.discardKeys() }
        login && keys
    }

    /** The event of the transfer waiting for the page, null when none (answered or timed out). */
    fun pendingEvent(): JSONObject? = synchronized(lock) { pending?.event }

    /**
     * The page's answer. A verified login («ok») is promoted here, before the call returns, so the page reads the
     * new login as soon as its call resolves; [SourcesDone.NOT_STORED] tells it the promotion failed.
     */
    fun done(id: String?, rutracker: String?, failed: Boolean, indexers: Int? = null): SourcesDone = synchronized(lock) {
        val p = pending?.takeIf { it.id == id } ?: return SourcesDone.UNKNOWN
        val saved = indexers?.coerceIn(0, SourcesProtocol.MAX_INDEXERS)
        var out: SourcesOutcome = when {
            failed -> SourcesOutcome.Failed
            rutracker == null -> SourcesOutcome.Applied(null, saved)
            else -> SourcesOutcome.Applied(if (rutracker in SourcesProtocol.RESULTS) rutracker else "error", saved)
        }
        if (p.staged && (out as? SourcesOutcome.Applied)?.rutracker == "ok" && !quietly { store.promote() }) out = SourcesOutcome.StoreFailed
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

    override fun stageKeys(keys: Map<Int, String>) {
        secrets.replace(keys.entries.associate { (i, k) -> key(pendingKey(i)) to k }, emptyList())
    }

    override fun discardKeys() {
        secrets.replace(emptyMap(), (0 until SourcesProtocol.MAX_INDEXERS).map { key(pendingKey(it)) })
    }

    companion object {
        const val USER = "rutracker.username"
        const val PASS = "rutracker.password"
        const val PENDING_USER = "rutracker.pending.username"
        const val PENDING_PASS = "rutracker.pending.password"

        /** The entry src/sources/indexerStore.ts indexerPendingKeyName(i) reads. */
        fun pendingKey(i: Int) = "indexer.pending.$i.apikey"
    }
}
