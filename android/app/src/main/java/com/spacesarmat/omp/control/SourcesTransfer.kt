package com.spacesarmat.omp.control

import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import org.json.JSONArray
import org.json.JSONObject
import com.spacesarmat.omp.sources.CloudflareCookies
import com.spacesarmat.omp.sources.SiteSession

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
    /** Logins of the other sites behind a login (Kinozal, rustorka…), by site id ([SourcesProtocol.LOGIN_SITES]). */
    val logins: Map<String, Login> = emptyMap(),
    /** Browser sign-ins (Task 9b): the session cookies of one host per site ([SourcesProtocol.SESSION_SITES]). */
    val sessions: Map<String, Session> = emptyMap(),
    /** The phone's resolved UI language (ru | en): the page stores it as the TV's language; null when none came. */
    val language: String? = null,
) {
    /** A browser session: [host]'s cookies and the phone's User-Agent it was made with. */
    class Session(val host: String, val cookies: List<Pair<String, String>>, val ua: String) {
        override fun toString() = "Session(${cookies.size} cookies)"
    }

    class Login(val username: String, val password: String) {
        override fun toString() = "Login(***)"
    }

    /** [url] is in the page's normal form (the page derives the connection id from it); [key] only when sent. */
    class Indexer(val kind: String, val url: String, val name: String?, val key: String?) {
        override fun toString() = "Indexer($kind, key=${key != null})"
    }

    override fun toString() =
        "SourcesTransfer(${sources.size} sources, login=${login != null}, indexers=${indexers.size}, flare=${flaresolverr != null}, cloudflare=${cloudflare.size}, logins=${logins.size}, sessions=${sessions.size})"
}

/** What became of a transfer; the router turns it into the HTTP answer. */
sealed class SourcesOutcome {
    /**
     * The page applied it; [rutracker] = ok | bad_login | captcha | error, null when no login came; [indexers] = how
     * many connections the page saved, null when none came.
     */
    data class Applied(
        val rutracker: String?,
        val indexers: Int? = null,
        val logins: Map<String, String> = emptyMap(),
        /** The verified rutracker login could not be written (only reported this way when site logins came too). */
        val rutrackerNotStored: Boolean = false,
        /** Per browser session that came: ok | error. */
        val sessions: Map<String, String> = emptyMap(),
    ) : SourcesOutcome()
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
    /** 16 KB until Task 9b; a browser session per site adds up to ~7 KB. */
    const val MAX_BODY = 32_768
    const val MAX_SOURCES = 40
    const val MAX_USERNAME = 100
    const val MAX_PASSWORD = 200
    const val MAX_INDEXERS = 20
    const val MAX_INDEXER_URL = 200
    const val MAX_INDEXER_NAME = 40
    val RESULTS = setOf("ok", "bad_login", "captcha", "error")
    private val SOURCE_ID = Regex("^[a-z0-9][a-z0-9-]{0,39}$")
    private val KEYS = setOf("v", "sources", "rutracker", "indexers", "flaresolverr", "cloudflare", "logins", "sessions", "language")
    /**
     * Sites whose login may travel in `logins` (src/sources/transfer.ts LOGIN_SITES). A fixed list: the site id names the
     * storage entries (`<id>.pending.username`), so a phone can never stage under another name.
     */
    val LOGIN_SITES = setOf("kinozal", "rustorka", "nnmclub")
    private val LOGIN_FIELDS = setOf("username", "password")
    /** Sites whose browser session may travel in `sessions` (src/sources/transfer.ts SESSION_SITES). */
    val SESSION_SITES = LOGIN_SITES + "rutracker"
    /**
     * The hosts a site's session may be on (its mirrors, as in the parsers under src/sources): the phone sends, and the TV takes, a session
     * only for one of them. A site without an entry here sends none.
     */
    val SESSION_HOSTS: Map<String, Set<String>> = mapOf(
        "rutracker" to setOf("rutracker.org"),
        "kinozal" to setOf("kinozal.me", "kinozal.guru", "kinozal.tv"),
        "rustorka" to setOf("rustorka.com"),
        "nnmclub" to setOf("nnmclub.to"),
    )
    private val SESSION_FIELDS = setOf("host", "cookies", "ua")
    private val COOKIE_FIELDS = setOf("name", "value")
    private val UA = Regex("^[\\x20-\\x7e]{1,512}$")
    val SESSION_RESULTS = setOf("ok", "error")
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
        val logins = when (val l = body.opt("logins")) {
            null -> emptyMap()
            is JSONObject -> logins(l) ?: return null
            else -> return null
        }
        val sessions = when (val x = body.opt("sessions")) {
            null -> emptyMap()
            is JSONObject -> sessions(x) ?: return null
            else -> return null
        }
        val language = when (val l = body.opt("language")) {
            null -> null
            is String -> l.takeIf { it in ControlRouter.LANGS } ?: return null
            else -> return null
        }
        return SourcesTransfer(sources, login, phone, indexers, flare, cloudflare, logins, sessions, language)
    }

    /**
     * { siteId: { host, cookies: [{ name, value }], ua } }, 1.. of [SESSION_SITES]: a valid host, 1..[SiteSession.MAX_COOKIES]
     * valid cookies without duplicates and at most [SiteSession.MAX_CHARS] characters, a printable User-Agent.
     */
    private fun sessions(o: JSONObject): Map<String, SourcesTransfer.Session>? {
        if (o.length() < 1 || o.length() > SESSION_SITES.size) return null
        val out = LinkedHashMap<String, SourcesTransfer.Session>()
        val ids = o.keys()
        while (ids.hasNext()) {
            val id = ids.next()
            if (id !in SESSION_SITES) return null
            val x = o.opt(id) as? JSONObject ?: return null
            val keys = x.keys()
            while (keys.hasNext()) if (keys.next() !in SESSION_FIELDS) return null
            val host = x.opt("host") as? String ?: return null
            if (!SiteSession.validHost(host) || host !in SESSION_HOSTS[id].orEmpty()) return null
            val ua = x.opt("ua") as? String ?: return null
            if (!UA.matches(ua)) return null
            val arr = x.opt("cookies") as? JSONArray ?: return null
            if (arr.length() < 1 || arr.length() > SiteSession.MAX_COOKIES) return null
            val pairs = ArrayList<Pair<String, String>>()
            val names = HashSet<String>()
            var chars = 0
            for (i in 0 until arr.length()) {
                val c = arr.opt(i) as? JSONObject ?: return null
                val ck = c.keys()
                while (ck.hasNext()) if (ck.next() !in COOKIE_FIELDS) return null
                val n = c.opt("name") as? String ?: return null
                val v = c.opt("value") as? String ?: return null
                if (!CloudflareCookies.validName(n) || !CloudflareCookies.validValue(v) || !names.add(n)) return null
                chars += n.length + v.length
                pairs.add(n to v)
            }
            if (chars > SiteSession.MAX_CHARS) return null
            out[id] = SourcesTransfer.Session(host, pairs, ua)
        }
        return out
    }

    /** { siteId: { username, password } }, 1.. of [LOGIN_SITES]. */
    private fun logins(o: JSONObject): Map<String, SourcesTransfer.Login>? {
        if (o.length() < 1 || o.length() > LOGIN_SITES.size) return null
        val out = LinkedHashMap<String, SourcesTransfer.Login>()
        val ids = o.keys()
        while (ids.hasNext()) {
            val id = ids.next()
            if (id !in LOGIN_SITES) return null
            val x = o.opt(id) as? JSONObject ?: return null
            val keys = x.keys()
            while (keys.hasNext()) if (keys.next() !in LOGIN_FIELDS) return null
            out[id] = login(x) ?: return null
        }
        return out
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
    /** Stages the login of another site ([SourcesProtocol.LOGIN_SITES]); throws when the storage is unavailable. */
    fun stageSite(site: String, username: String, password: String)
    /** The site's staged pair → its live entries in one write; throws when the storage is unavailable. */
    fun promoteSite(site: String)
    /** Forgets the staged pair of every site in [sites] (never a live one). */
    fun discardSites(sites: Collection<String>)
}

/**
 * Browser sessions on their way to the TV's jar ([SourcesProtocol.SESSION_SITES]): staged in the encrypted storage, only
 * a session the page verified replaces the site's live one ([promote]: cookies into the jar, the phone's User-Agent for
 * that host, the site marked «вход выполнен в браузере», its saved password dropped); anything else is dropped.
 */
interface SessionStore {
    /** Throws when the storage is unavailable. */
    fun stage(site: String, s: SourcesTransfer.Session)
    /** Throws when the storage is unavailable or nothing is staged. */
    fun promote(site: String)
    fun discard(sites: Collection<String>)
}

/** No browser sessions (tests of the other parts). */
object NoSessions : SessionStore {
    override fun stage(site: String, s: SourcesTransfer.Session) = throw IllegalStateException("no session store")
    override fun promote(site: String) = throw IllegalStateException("no session store")
    override fun discard(sites: Collection<String>) {}
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
    private val sessions: SessionStore = NoSessions,
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
        @Volatile
        var sitesStaged: Set<String> = emptySet()
        @Volatile
        var sessionsStaged: Set<String> = emptySet()
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
            if (t.logins.isNotEmpty()) {
                p.sitesStaged = t.logins.keys.toSet()
                for ((site, l) in t.logins) {
                    if (!quietly { store.stageSite(site, l.username, l.password) }) return SourcesOutcome.StoreFailed
                }
            }
            if (t.sessions.isNotEmpty()) {
                p.sessionsStaged = t.sessions.keys.toSet()
                for ((site, x) in t.sessions) {
                    if (!quietly { sessions.stage(site, x) }) return SourcesOutcome.StoreFailed
                }
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
            t.language?.let { event.put("language", it) }
            if (t.cloudflare.isNotEmpty()) {
                val cf = JSONObject()
                for ((id, on) in t.cloudflare) cf.put(id, on)
                event.put("cloudflare", cf)
            }
            if (t.logins.isNotEmpty()) {
                // the page hears only which sites' logins are staged
                val l = JSONObject()
                for (site in t.logins.keys) l.put(site, true)
                event.put("logins", l)
            }
            if (t.sessions.isNotEmpty()) {
                // the page hears only the host of each staged session (it checks it is the site's), never a cookie
                val x = JSONObject()
                for ((site, ses) in t.sessions) x.put(site, ses.host)
                event.put("sessions", x)
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
            if (p.sitesStaged.isNotEmpty()) quietly { store.discardSites(p.sitesStaged) }
            if (p.sessionsStaged.isNotEmpty()) quietly { sessions.discard(p.sessionsStaged) }
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
        val sites = quietly { store.discardSites(SourcesProtocol.LOGIN_SITES) }
        val ses = quietly { sessions.discard(SourcesProtocol.SESSION_SITES) }
        login && keys && sites && ses
    }

    /** The event of the transfer waiting for the page, null when none (answered or timed out). */
    fun pendingEvent(): JSONObject? = synchronized(lock) { pending?.event }

    /**
     * The page's answer. A verified login («ok») is promoted here, before the call returns, so the page reads the
     * new login as soon as its call resolves; [SourcesDone.NOT_STORED] tells it the promotion failed.
     */
    fun done(id: String?, rutracker: String?, failed: Boolean, indexers: Int? = null, logins: Map<String, String?> = emptyMap()): SourcesDone =
        answer(id, rutracker, failed, indexers, logins).state

    /** What [answer] made of the page's answer, and the sites whose verified login could not be written. */
    class Answer(val state: SourcesDone, val sitesNotStored: Set<String>, val rutrackerStored: Boolean = true)

    /**
     * [done] with the other sites' results ([logins]: site → ok | bad_login | captcha | error). Every staged site gets a
     * result (one the page did not mention: «error»); a verified one is promoted here, and when that write fails its
     * result becomes «error» and it is listed in [Answer.sitesNotStored].
     */
    fun answer(
        id: String?,
        rutracker: String?,
        failed: Boolean,
        indexers: Int? = null,
        logins: Map<String, String?> = emptyMap(),
        /** Per staged browser session: ok (verified) | error. */
        sessionResults: Map<String, String?> = emptyMap(),
    ): Answer = synchronized(lock) {
        val p = pending?.takeIf { it.id == id } ?: return Answer(SourcesDone.UNKNOWN, emptySet())
        val saved = indexers?.coerceIn(0, SourcesProtocol.MAX_INDEXERS)
        val notStored = LinkedHashSet<String>()
        val sites = LinkedHashMap<String, String>()
        if (!failed) {
            for (site in p.sitesStaged) {
                val r = logins[site]?.takeIf { it in SourcesProtocol.RESULTS } ?: "error"
                sites[site] = if (r == "ok" && !quietly { store.promoteSite(site) }) {
                    notStored.add(site)
                    "error"
                } else r
            }
        }
        val ses = LinkedHashMap<String, String>()
        if (!failed) {
            for (site in p.sessionsStaged) {
                val r = sessionResults[site]?.takeIf { it in SourcesProtocol.SESSION_RESULTS } ?: "error"
                ses[site] = if (r == "ok" && !quietly { sessions.promote(site) }) {
                    notStored.add(site)
                    "error"
                } else r
            }
        }
        var out: SourcesOutcome = when {
            failed -> SourcesOutcome.Failed
            rutracker == null -> SourcesOutcome.Applied(null, saved, sites, sessions = ses)
            else -> SourcesOutcome.Applied(if (rutracker in SourcesProtocol.RESULTS) rutracker else "error", saved, sites, sessions = ses)
        }
        var rutrackerStored = true
        val applied = out as? SourcesOutcome.Applied
        if (p.staged && applied != null && applied.rutracker == "ok" && !quietly { store.promote() }) {
            rutrackerStored = false
            // with site logins the phone still hears their results (some may be stored); alone it is the old 500 «secrets»
            out = if (p.sitesStaged.isNotEmpty() || p.sessionsStaged.isNotEmpty()) applied.copy(rutracker = "error", rutrackerNotStored = true) else SourcesOutcome.StoreFailed
        }
        p.outcome = out
        p.latch.countDown()
        Answer(if (!rutrackerStored || notStored.isNotEmpty()) SourcesDone.NOT_STORED else SourcesDone.STORED, notStored, rutrackerStored)
    }

    companion object {
        /** The page may sign in to the sites (in parallel, one request each) before it answers; the phone waits 45 s. */
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

    override fun stageSite(site: String, username: String, password: String) {
        require(site in SourcesProtocol.LOGIN_SITES)
        secrets.replace(mapOf(key("$site.pending.username") to username, key("$site.pending.password") to password), emptyList())
    }

    override fun promoteSite(site: String) {
        require(site in SourcesProtocol.LOGIN_SITES)
        val user = secrets.get(key("$site.pending.username"))
        val pass = secrets.get(key("$site.pending.password"))
        if (user == null || pass == null) throw IllegalStateException("nothing staged")
        secrets.replace(
            mapOf(key("$site.username") to user, key("$site.password") to pass),
            listOf(key("$site.pending.username"), key("$site.pending.password")),
        )
    }

    override fun discardSites(sites: Collection<String>) {
        val names = sites.filter { it in SourcesProtocol.LOGIN_SITES }.flatMap { listOf(key("$it.pending.username"), key("$it.pending.password")) }
        if (names.isNotEmpty()) secrets.replace(emptyMap(), names)
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

/**
 * [SessionStore] over the encrypted entries: a session is staged under `session.pending.<site>` (outside the page's js:
 * namespace: the page never reads a cookie); [promote] puts it into the jar ([import]: cookies + the phone's User-Agent)
 * and, in one write, marks the site «вход выполнен в браузере» (`<site>.browser`, what src/sources/browserLogin.ts reads)
 * and drops its saved password (a browser session has none) and the staged entry. [key] maps a page key to its storage name.
 */
class SecretSessionStore(
    private val secrets: SecretEntries,
    private val key: (String) -> String,
    private val import: (root: okhttp3.HttpUrl, pairs: List<Pair<String, String>>, ua: String) -> Unit,
) : SessionStore {
    override fun stage(site: String, s: SourcesTransfer.Session) {
        require(site in SourcesProtocol.SESSION_SITES)
        secrets.replace(mapOf(stagedName(site) to SiteSession.encode(SiteSession.Staged(s.host, s.cookies, s.ua))), emptyList())
    }

    /** The staged session of [site] (the TV page checks it before answering), null when none. */
    fun staged(site: String): SiteSession.Staged? =
        if (site in SourcesProtocol.SESSION_SITES) SiteSession.decode(secrets.get(stagedName(site))) else null

    override fun promote(site: String) {
        val s = staged(site) ?: throw IllegalStateException("nothing staged")
        val root = okhttp3.HttpUrl.Builder().scheme("https").host(s.host).build()
        import(root, s.cookies, s.ua ?: throw IllegalStateException("no user agent"))
        secrets.replace(mapOf(key("$site.browser") to "1"), listOf(key("$site.username"), key("$site.password"), stagedName(site)))
    }

    override fun discard(sites: Collection<String>) {
        val names = sites.filter { it in SourcesProtocol.SESSION_SITES }.map { stagedName(it) }
        if (names.isNotEmpty()) secrets.replace(emptyMap(), names)
    }

    companion object {
        fun stagedName(site: String) = "session.pending.$site"
    }
}
