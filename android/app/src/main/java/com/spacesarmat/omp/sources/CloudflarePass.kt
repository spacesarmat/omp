package com.spacesarmat.omp.sources

import java.util.concurrent.ConcurrentHashMap
import okhttp3.HttpUrl

/**
 * The order of the ways past a Cloudflare check: the built-in hidden browser first, then the user's FlareSolverr when
 * its address came with the request. A FlareSolverr pass brings its own User-Agent: requests to that host use it from
 * then on (the clearance is bound to it) until the built-in check passes again. Nothing is logged.
 */
class CloudflarePass(
    private val solver: CloudflareSolving?,
    private val flare: FlareSolverrClient,
    private val jar: SiteCookieJar,
) {
    enum class Outcome { BROWSER, FLARESOLVERR, INTERACTIVE, FAILED }

    private val agents = ConcurrentHashMap<String, String>()

    /** The User-Agent for requests to [host]. */
    fun userAgentFor(host: String): String = agents[host.lowercase()] ?: SiteHttp.USER_AGENT

    /** Blocking. [flareBase]: the FlareSolverr address, null when none is set. */
    fun pass(url: HttpUrl, flareBase: HttpUrl?): Outcome {
        val host = url.host.lowercase()
        val built = try {
            solver?.solve(url) ?: CloudflareSolver.Result.FAILED
        } catch (e: Exception) {
            CloudflareSolver.Result.FAILED
        }
        if (built == CloudflareSolver.Result.SOLVED) {
            agents.remove(host)
            return Outcome.BROWSER
        }
        if (flareBase != null) {
            val r = flare.solve(flareBase, CloudflareSolver.siteRoot(url))
            if (r is FlareSolverrClient.Result.Solved) {
                if (r.cookies.isNotEmpty()) jar.saveFromResponse(url, r.cookies)
                if (r.userAgent != null) agents[host] = r.userAgent else agents.remove(host)
                return Outcome.FLARESOLVERR
            }
        }
        return if (built == CloudflareSolver.Result.INTERACTIVE) Outcome.INTERACTIVE else Outcome.FAILED
    }
}
