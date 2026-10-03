package com.spacesarmat.omp.sources

import okhttp3.HttpUrl

/**
 * Redirects of a site request. A POST body (tracker login and password) is re-sent on 307/308 only to the same
 * host without an https → http downgrade; 301/302/303 continue as a GET without a body; anything else stops and
 * the redirect response itself is returned.
 */
object RedirectPolicy {
    enum class Action { FOLLOW_GET, RESEND, STOP }

    fun next(method: String, code: Int, from: HttpUrl, to: HttpUrl): Action {
        if (code !in REDIRECTS) return Action.STOP
        if (method == "GET") return Action.FOLLOW_GET
        if (code == 307 || code == 308) {
            val sameHost = from.host.equals(to.host, ignoreCase = true)
            val downgrade = from.isHttps && !to.isHttps
            return if (sameHost && !downgrade) Action.RESEND else Action.STOP
        }
        return Action.FOLLOW_GET
    }

    private val REDIRECTS = setOf(301, 302, 303, 307, 308)
}
