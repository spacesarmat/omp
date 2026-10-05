package com.spacesarmat.omp.sources

import java.util.concurrent.ConcurrentHashMap
import okhttp3.HttpUrl
import org.json.JSONObject

/** Persistent per-host User-Agent overrides (encrypted on the device, see [SecretAgentStore]). */
interface AgentStore {
    /** Throws when the storage is temporarily unreadable. */
    fun load(): String?

    /** null removes everything. */
    fun save(data: String?)
}

/**
 * The User-Agent a browser session was made with, per host (the phone's, for a session «Войти на телефоне» or a transfer
 * brought to the TV). Kept apart from the Cloudflare overrides: a clearance, FlareSolverr or a visible check never touch
 * it; «Выйти» ([CloudflarePass.forgetSite]) and a new session made on this device drop it. Encrypted, with an end time.
 */
class SessionAgents(private val store: AgentStore?, private val now: () -> Long = System::currentTimeMillis) {
    private class Agent(val ua: String, val until: Long)

    private var agents: HashMap<String, Agent>? = null
    private var unreadable = false

    @Synchronized
    fun agentFor(host: String): String? {
        val map = loaded()
        val a = map[host.lowercase()] ?: return null
        if (a.until > now()) return a.ua
        map.remove(host.lowercase())
        persist(map, strict = false)
        return null
    }

    /** Throws when it cannot be written (the session it belongs to is then not kept either). */
    @Synchronized
    fun set(host: String, ua: String, until: Long) {
        val cur = loaded()
        if (unreadable) throw IllegalStateException("agents unreadable")
        val map = HashMap(cur)
        map[host.lowercase()] = Agent(ua, until)
        persist(map, strict = true)
        agents = map
    }

    @Synchronized
    fun clear(host: String) {
        val map = loaded()
        if (map.remove(host.lowercase()) != null) persist(map, strict = false)
    }

    /** Drops every host of [site] (a registrable domain: «Выйти» forgets the whole site). */
    @Synchronized
    fun clearSite(site: String) {
        val map = loaded()
        if (map.keys.removeAll { it == site || it.endsWith(".$site") }) persist(map, strict = false)
    }

    private fun loaded(): HashMap<String, Agent> {
        agents?.let { return it }
        val map = HashMap<String, Agent>()
        val data = try {
            store?.load()
        } catch (e: Exception) {
            unreadable = true
            null
        }
        if (data != null) {
            try {
                val o = JSONObject(data)
                val t = now()
                for (k in o.keys()) {
                    val a = o.optJSONObject(k) ?: continue
                    val ua = a.optString("ua", "")
                    val until = a.optLong("until", 0)
                    if (ua.isNotEmpty() && until > t) map[k] = Agent(ua, until)
                }
            } catch (e: Exception) {
                // broken data: none
            }
        }
        agents = map
        return map
    }

    private fun persist(map: Map<String, Agent>, strict: Boolean) {
        val s = store ?: return
        if (unreadable) return
        try {
            if (map.isEmpty()) {
                s.save(null)
            } else {
                val o = JSONObject()
                for ((k, a) in map) o.put(k, JSONObject().put("ua", a.ua).put("until", a.until))
                s.save(o.toString())
            }
        } catch (e: Exception) {
            if (strict) throw e
        }
    }
}

/**
 * The order of the ways past a Cloudflare check: the built-in hidden browser first, then the user's FlareSolverr when
 * its address came with the request. A FlareSolverr pass brings its own User-Agent: requests to that host (the host
 * the check was on, after redirects) use it until its clearance ends or the built-in check passes again. Overrides are
 * kept with the cookies (encrypted, with an end time), so a restart does not bring a new check. One FlareSolverr call
 * per host at a time: callers that asked while one ran take its result. Nothing is logged.
 *
 * FlareSolverr is not used for a host that has a browser session (its User-Agent would not match the session's), and
 * only its Cloudflare cookies (cf_clearance, __cf_bm, cf_chl_*) go into the jar: a login stays.
 *
 * User-Agent precedence for a host ([userAgentFor]): a live Cloudflare override first (a clearance is bound to the UA
 * it was earned with), then the host's browser-session agent ([SessionAgents]), then this device's own. The checks
 * themselves start from the session agent ([baseAgentFor]), so a clearance earned on a session host matches it.
 */
class CloudflarePass(
    private val solver: CloudflareSolving?,
    private val flare: FlareSolverrClient,
    private val jar: SiteCookieJar,
    /** The User-Agent without an override (the WebView's own on Android). */
    private val defaultAgent: () -> String = { SiteHttp.USER_AGENT },
    private val store: AgentStore? = null,
    /** Browser-session agents (never touched by a clearance or FlareSolverr). */
    val sessions: SessionAgents? = null,
    private val now: () -> Long = System::currentTimeMillis,
) {
    enum class Outcome { BROWSER, FLARESOLVERR, INTERACTIVE, FAILED }

    private class Agent(val ua: String, val until: Long)

    private var agents: HashMap<String, Agent>? = null
    // the stored overrides could not be read: memory only, so they are not overwritten
    private var unreadable = false

    private val flareLocks = ConcurrentHashMap<String, Any>()

    /** host → (finished at, passed) of the last FlareSolverr call. */
    private val flareDone = ConcurrentHashMap<String, Pair<Long, Boolean>>()

    /** The User-Agent for requests to [host]. */
    @Synchronized
    fun userAgentFor(host: String): String {
        val h = host.lowercase()
        val map = loaded()
        val a = map[h] ?: return baseAgentFor(h)
        if (a.until > now()) return a.ua
        map.remove(h)
        persist(map)
        return baseAgentFor(h)
    }

    /** The User-Agent of [host] without a Cloudflare override: its session's, else this device's. */
    fun baseAgentFor(host: String): String = sessions?.agentFor(host) ?: defaultAgent()

    /** «Выйти»: the Cloudflare overrides and the session agents of every host of [url]'s site go. */
    @Synchronized
    fun forgetSite(url: HttpUrl) {
        val site = SiteCookieJar.siteOf(url)
        val map = loaded()
        if (map.keys.removeAll { it == site || it.endsWith(".$site") }) persist(map)
        sessions?.clearSite(site)
    }

    /** An override for [host] until [until] (FlareSolverr; Task 8: the phone's User-Agent with its cookies). */
    @Synchronized
    fun setAgent(host: String, ua: String, until: Long) {
        val map = loaded()
        map[host.lowercase()] = Agent(ua, until)
        persist(map)
    }

    /**
     * A visible check passed (here or on the phone): [pairs] into the jar for [root]'s site until [until]; [ua] = the
     * User-Agent they were earned with when it is not this device's (the phone's): requests to that host use it until
     * then; null drops an override. Blocking (Keystore).
     */
    fun importClearance(root: HttpUrl, pairs: List<Pair<String, String>>, ua: String?, until: Long) {
        val site = CloudflareSolver.siteRoot(root)
        CloudflareCookies.import(jar, site, CloudflareCookies.clean(pairs), until)
        if (ua != null) setAgent(site.host, ua, until) else clearAgent(site.host)
    }

    @Synchronized
    fun clearAgent(host: String) {
        val map = loaded()
        if (map.remove(host.lowercase()) != null) persist(map)
    }

    /** Blocking. [url]: the challenged address (after redirects). [flareBase]: the FlareSolverr address, null when none. */
    fun pass(url: HttpUrl, flareBase: HttpUrl?): Outcome {
        val host = url.host.lowercase()
        val asked = now()
        val built = try {
            solver?.solve(url) ?: CloudflareSolver.Result.FAILED
        } catch (e: Exception) {
            CloudflareSolver.Result.FAILED
        }
        if (built == CloudflareSolver.Result.SOLVED) {
            clearAgent(host)
            return Outcome.BROWSER
        }
        // a host with a browser session keeps that session's User-Agent (FlareSolverr's clearance would not match it): no FlareSolverr there
        if (flareBase != null && sessions?.agentFor(host) == null && viaFlare(host, url, flareBase, asked)) return Outcome.FLARESOLVERR
        return if (built == CloudflareSolver.Result.INTERACTIVE) Outcome.INTERACTIVE else Outcome.FAILED
    }

    private fun viaFlare(host: String, url: HttpUrl, base: HttpUrl, asked: Long): Boolean {
        val lock = flareLocks.getOrPut(host) { Any() }
        synchronized(lock) {
            // another request for this host asked FlareSolverr after this one started: its result is ours
            flareDone[host]?.let { (at, ok) -> if (at >= asked) return ok }
            val r = flare.solve(base, CloudflareSolver.siteRoot(url))
            val ok = r is FlareSolverrClient.Result.Solved
            if (r is FlareSolverrClient.Result.Solved) {
                // only Cloudflare's cookies: FlareSolverr loaded the site as a guest, its other cookies must not replace a login
                val cf = r.cookies.filter { CloudflareCookies.isCloudflare(it.name) }
                if (cf.isNotEmpty()) jar.saveFromResponse(url, cf)
                if (r.userAgent != null) setAgent(host, r.userAgent, agentUntil(r)) else clearAgent(host)
            }
            flareDone[host] = now() to ok
            return ok
        }
    }

    /** The override lasts as long as the clearance it came with ([AGENT_TTL_MS] when its end is unknown). */
    private fun agentUntil(r: FlareSolverrClient.Result.Solved): Long {
        val c = r.cookies.firstOrNull { it.name == CloudflareSolver.CLEARANCE && it.persistent }
        return c?.expiresAt ?: (now() + AGENT_TTL_MS)
    }

    private fun loaded(): HashMap<String, Agent> {
        agents?.let { return it }
        val map = HashMap<String, Agent>()
        val data = try {
            store?.load()
        } catch (e: Exception) {
            unreadable = true
            null
        }
        if (data != null) {
            try {
                val o = JSONObject(data)
                val t = now()
                for (k in o.keys()) {
                    val a = o.optJSONObject(k) ?: continue
                    val ua = a.optString("ua", "")
                    val until = a.optLong("until", 0)
                    if (ua.isNotEmpty() && until > t) map[k] = Agent(ua, until)
                }
            } catch (e: Exception) {
                // broken data: no overrides
            }
        }
        agents = map
        return map
    }

    private fun persist(map: Map<String, Agent>) {
        val s = store ?: return
        if (unreadable) return
        try {
            if (map.isEmpty()) {
                s.save(null)
            } else {
                val o = JSONObject()
                for ((k, a) in map) o.put(k, JSONObject().put("ua", a.ua).put("until", a.until))
                s.save(o.toString())
            }
        } catch (e: Exception) {
            // kept in memory
        }
    }

    companion object {
        const val AGENT_TTL_MS = 24L * 60 * 60 * 1000
    }
}

/** The overrides in the Keystore-encrypted storage, outside the page's js: namespace (committed writes: throw on failure). */
class SecretAgentStore(private val secrets: SecretValues, private val key: String = KEY) : AgentStore {
    override fun load(): String? = secrets.get(key)

    override fun save(data: String?) {
        if (data == null) secrets.replace(emptyMap(), listOf(key)) else secrets.replace(mapOf(key to data), emptyList())
    }

    companion object {
        const val KEY = "cloudflare:agents"
        /** The browser sessions' agents ([SessionAgents]). */
        const val SESSION_KEY = "session:agents"
    }
}
