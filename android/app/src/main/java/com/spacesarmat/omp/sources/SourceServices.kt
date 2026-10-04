package com.spacesarmat.omp.sources

import android.content.Context
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
    val cloudflare = CloudflarePass(
        CloudflareSolver({ WebViewCloudflareBrowser(app) }, MainScheduler(), jar, agent),
        FlareSolverrClient(),
        jar,
        agent,
        SecretAgentStore(secrets),
    )
    val siteHttp = SiteHttp(jar, cloudflare, agent)

    /** Blocking. Throws [SiteHttpException]. */
    fun request(spec: HttpSpec): SiteHttp.Response =
        siteHttp.request(
            spec.url, spec.method, spec.headers, spec.form, spec.formCharset, spec.body, spec.timeoutMs, spec.responseCharset,
            if (spec.cloudflare) SiteHttp.CloudflareOptions(spec.flareSolverr?.toHttpUrlOrNull()) else null,
        )

    companion object {
        const val SECRETS_FAILED = "Не удалось открыть защищённое хранилище"
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
