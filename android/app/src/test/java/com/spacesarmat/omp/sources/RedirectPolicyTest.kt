package com.spacesarmat.omp.sources

import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.assertEquals
import org.junit.Test

class RedirectPolicyTest {
    private fun next(method: String, code: Int, from: String, to: String) =
        RedirectPolicy.next(method, code, from.toHttpUrl(), to.toHttpUrl())

    @Test
    fun getFollowsEverything() {
        assertEquals(RedirectPolicy.Action.FOLLOW_GET, next("GET", 302, "https://a.org/", "https://b.org/"))
        assertEquals(RedirectPolicy.Action.FOLLOW_GET, next("GET", 307, "https://a.org/", "http://b.org/"))
    }

    @Test
    fun postSeeOtherBecomesGetWithoutBody() {
        for (code in listOf(301, 302, 303)) {
            assertEquals(RedirectPolicy.Action.FOLLOW_GET, next("POST", code, "https://rutracker.org/login", "https://evil.org/"))
        }
    }

    @Test
    fun postBodyIsResentOnlyToTheSameHostWithoutDowngrade() {
        assertEquals(RedirectPolicy.Action.RESEND, next("POST", 307, "https://rutracker.org/a", "https://rutracker.org/b"))
        assertEquals(RedirectPolicy.Action.RESEND, next("POST", 308, "http://site.org/a", "https://site.org/b"))
        assertEquals(RedirectPolicy.Action.STOP, next("POST", 307, "https://rutracker.org/a", "https://evil.org/b"))
        assertEquals(RedirectPolicy.Action.STOP, next("POST", 308, "https://rutracker.org/a", "https://bt.rutracker.org/b"))
        assertEquals(RedirectPolicy.Action.STOP, next("POST", 307, "https://rutracker.org/a", "http://rutracker.org/b"))
    }

    @Test
    fun otherCodesStop() {
        assertEquals(RedirectPolicy.Action.STOP, next("POST", 304, "https://a.org/", "https://a.org/"))
    }
}
