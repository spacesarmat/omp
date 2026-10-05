package com.spacesarmat.omp.sources

import com.spacesarmat.omp.I18n

import android.content.Context
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import org.json.JSONObject

/**
 * A site request of the search sources as the page sends it (OmpNative.http and the background page's bridge):
 * { url, method?: GET|POST, headers?, form?, formCharset?, body?, timeoutMs?, responseCharset?, cloudflare?, flaresolverr? }.
 * Pure: tested on the JVM.
 */
data class HttpSpec(
    val url: String,
    val method: String,
    val headers: Map<String, String>,
    val form: Map<String, String>?,
    val formCharset: String?,
    val body: String?,
    val timeoutMs: Long,
    /** Charset to decode the body with, overriding the headers ('iso-8859-1' gives the raw bytes of a .torrent 1:1). */
    val responseCharset: String? = null,
    /** The site's «Обходить проверку Cloudflare» is on: a Cloudflare check is passed (built-in page, then FlareSolverr). */
    val cloudflare: Boolean = false,
    /** The user's FlareSolverr address (http/https), only with [cloudflare]. */
    val flareSolverr: String? = null,
) {
    companion object {
        const val DEFAULT_TIMEOUT_MS = 20_000
        const val MIN_TIMEOUT_MS = 1_000
        const val MAX_TIMEOUT_MS = 60_000

        /** Throws [SiteHttpException] (BAD_URL / BAD_REQUEST, Russian). Non-string header / form values are dropped. */
        fun parse(o: JSONObject?): HttpSpec {
            if (o == null) throw SiteHttpException(SiteHttp.BAD_REQUEST)
            val url = o.opt("url") as? String
            if (url == null || url.toHttpUrlOrNull() == null) throw SiteHttpException(SiteHttp.BAD_URL)
            val method = ((o.opt("method") as? String) ?: "GET").uppercase()
            if (method != "GET" && method != "POST") throw SiteHttpException(SiteHttp.BAD_REQUEST)
            val timeout = (o.opt("timeoutMs") as? Number)?.toInt() ?: DEFAULT_TIMEOUT_MS
            return HttpSpec(
                url = url,
                method = method,
                headers = stringMap(o.optJSONObject("headers")),
                form = o.optJSONObject("form")?.let { stringMap(it) },
                formCharset = o.opt("formCharset") as? String,
                body = o.opt("body") as? String,
                timeoutMs = timeout.coerceIn(MIN_TIMEOUT_MS, MAX_TIMEOUT_MS).toLong(),
                responseCharset = o.opt("responseCharset") as? String,
                cloudflare = o.opt("cloudflare") == true,
                flareSolverr = if (o.opt("cloudflare") == true) (o.opt("flaresolverr") as? String)?.takeIf { it.toHttpUrlOrNull() != null } else null,
            )
        }

        fun stringMap(o: JSONObject?): Map<String, String> {
            val out = LinkedHashMap<String, String>()
            if (o == null) return out
            val keys = o.keys()
            while (keys.hasNext()) {
                val k = keys.next()
                val v = o.opt(k)
                if (v is String) out[k] = v
            }
            return out
        }

        /** { status, url, text } as both callers answer it. */
        fun reply(r: SiteHttp.Response): JSONObject {
            val o = JSONObject().put("status", r.status).put("url", r.url).put("text", r.text)
            if (r.cloudflare != null) o.put("cloudflare", r.cloudflare)
            return o
        }
    }
}

/**
 * Site HTTP with the per-site cookie jar and the Keystore secrets, one per process: the app's plugin and the
 * background monitor page share the same cookies (a tracker session) and never race two in-memory jars.
 * Values are never logged.
 */
class SourceServices private constructor(context: Context) {
    val secrets = SecretStorage(context)
    private val jar = SiteCookieJar(SecretCookieStore(secrets))
    private val app = context.applicationContext
    // one User-Agent for the site requests and the hidden check: the WebView's own (header and client hints agree)
    private val agent = DefaultUserAgent(app)
    private val sessionAgents = SessionAgents(SecretAgentStore(secrets, SecretAgentStore.SESSION_KEY))
    val cloudflare = CloudflarePass(
        CloudflareSolver({ WebViewCloudflareBrowser(app) }, MainScheduler(), jar, agent, agentFor = { sessionAgents.agentFor(it) }),
        FlareSolverrClient(),
        jar,
        agent,
        SecretAgentStore(secrets),
        sessionAgents,
    )
    val siteHttp = SiteHttp(jar, cloudflare, agent)

    /** This device's User-Agent (the visible check uses it, the phone sends it with a check it passed for the TV). */
    fun userAgent(): String = agent()

    /**
     * A visible check passed: [pairs] (the cookies of [root]) into the jar until [until]. [ua] = the User-Agent they were
     * earned with when it is not this device's (the phone's, for «Пройти на телефоне»): requests to that host use it
     * until then; null = this device's own, any override is dropped. Blocking (Keystore).
     */
    fun importClearance(root: HttpUrl, pairs: List<Pair<String, String>>, ua: String?, until: Long) =
        cloudflare.importClearance(root, pairs, ua, until)

    /**
     * A browser sign-in (here, from the phone, or staged from a transfer): the session [pairs] of [root]'s host into the
     * jar ([SiteSession.import]: replaces the site's earlier session). [ua] = the User-Agent the session was made with when
     * it is not this device's (the phone's): requests to that host use it for as long as the session is kept; null =
     * this device's own, any override is dropped. Throws when nothing usable came. Blocking (Keystore).
     */
    fun importSession(root: HttpUrl, pairs: List<Pair<String, String>>, ua: String?) =
        SiteSession.importWithAgent(jar, sessionAgents, root, pairs, ua, System.currentTimeMillis())

    /** The User-Agent of [host] without a Cloudflare override (a visible check passes with it). */
    fun baseAgentFor(host: String): String = cloudflare.baseAgentFor(host)

    /** Blocking: the session opens [check]'s page on [root] as a signed-in one ([SessionVerifier]). */
    fun verifySession(root: HttpUrl, pairs: List<Pair<String, String>>, ua: String, check: SiteSession.Check): Boolean =
        SessionVerifier().verify(root, pairs, ua, check)

    /** The session cookies of [root]'s host for «Передать вход на телевизор» (only that site, capped); never logged. */
    fun sessionCookies(root: HttpUrl): List<Pair<String, String>> =
        SiteSession.clean(jar.loadForRequest(CloudflareSolver.siteRoot(root)).map { it.name to it.value })

    /** The User-Agent requests to [host] go with (a session's or a clearance's override, else this device's). */
    fun agentFor(host: String): String = cloudflare.userAgentFor(host)

    /** When the stored clearance of [url]'s site ends, null without one. Blocking (Keystore). */
    fun clearanceUntil(url: HttpUrl): Long? = CloudflareCookies.clearanceUntil(jar, url)

    /** Blocking. Throws [SiteHttpException]. */
    fun request(spec: HttpSpec): SiteHttp.Response =
        siteHttp.request(
            spec.url, spec.method, spec.headers, spec.form, spec.formCharset, spec.body, spec.timeoutMs, spec.responseCharset,
            if (spec.cloudflare) SiteHttp.CloudflareOptions(spec.flareSolverr?.toHttpUrlOrNull()) else null,
        )

    companion object {
        val SECRETS_FAILED: String get() = I18n.s("errors.secretsFailed")
        private const val JS_SECRET_PREFIX = "js:"

        @Volatile
        private var instance: SourceServices? = null

        fun get(context: Context): SourceServices =
            instance ?: synchronized(this) {
                instance ?: SourceServices(context.applicationContext).also { instance = it }
            }

        /** JS keys live in their own namespace: page code cannot read the cookie entries. null when invalid. */
        fun jsSecretKey(key: String?): String? =
            if (key.isNullOrEmpty() || key.length > 200) null else JS_SECRET_PREFIX + key
    }
}
