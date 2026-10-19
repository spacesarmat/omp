package com.spacesarmat.omp.sources

import org.json.JSONObject
import java.io.IOException

/**
 * The OMP subscription's refresh token for every page of the app (the app itself, the background check, the TV search
 * server): one refresh at a time for the whole process, and the rotated token written to the Keystore only. A page that
 * comes while another one renews waits and gets the fresh access token without a second request.
 *
 * A refused Keystore write keeps the token in memory for this process (the old Keystore entry is removed, a rotated
 * token must not come back) and logs a line without the value. A network error never forgets the token; only the
 * server's 401 revoked / refresh_expired / bad_token does. Tokens are never logged. Pure: tested on the JVM.
 */
class BillingTokens(
    private val store: SecretValues,
    /** POST /v1/token/refresh with this form and headers; throws [IOException] when no answer came. */
    private val post: (form: Map<String, String>, headers: Map<String, String>) -> Answer,
    private val pause: (Long) -> Unit = { Thread.sleep(it) },
    private val warn: (String) -> Unit = {},
    private val clock: () -> Long = { System.currentTimeMillis() },
) {
    data class Answer(val status: Int, val text: String)

    private val lock = Any()

    /** The refresh token when the Keystore refused it (this process only). */
    @Volatile
    private var memory: String? = null

    /** The last access token this process got, so a page that waited reuses it. */
    private var last: JSONObject? = null

    /**
     * A new access token for [deviceId]. [stale] = the access token the page has now: a fresher one that another page
     * already got is returned as is. Answers `{ok:true, accessToken, accessExpiresAt, refreshExpiresAt, paidUntil?,
     * volatile}` or `{ok:false, error: gone|missing|network|rate|down|bad_request, code?}`.
     */
    fun refresh(deviceId: String, stale: String): JSONObject = synchronized(lock) {
        if (!DEVICE.matches(deviceId) || stale.length > MAX_TOKEN) return failure("bad_request")
        val now = clock()
        val cached = last
        if (cached != null && cached.optString("accessToken") != stale && cached.optLong("accessExpiresAt") > now + REUSE_MIN_LEFT_MS) {
            return JSONObject(cached.toString()).put("volatile", memory != null)
        }
        val token = memory ?: try {
            store.get(KEY)
        } catch (e: Exception) {
            // a transient Keystore failure: the token is still there, try again later
            return failure("down")
        }
        if (token.isNullOrEmpty()) return failure("missing")
        val form = mapOf("refreshToken" to token, "deviceId" to deviceId)
        val headers = mapOf("X-Device-Id" to deviceId)
        val answer = try {
            post(form, headers)
        } catch (e: IOException) {
            // the answer may have been lost after the server rotated: the same token once more, inside its 60 s grace
            pause(LOST_RETRY_MS)
            try {
                post(form, headers)
            } catch (e2: IOException) {
                return failure("network")
            }
        }
        when {
            answer.status in 200..299 -> {
                val pair = pairOf(answer.text) ?: return failure("down")
                val volatile = keep(pair.optString("refreshToken"))
                pair.remove("refreshToken")
                last = pair
                return JSONObject(pair.toString()).put("ok", true).put("volatile", volatile)
            }
            answer.status == 401 -> {
                val code = errorOf(answer.text)
                if (code in GONE) {
                    forgetLocked()
                    return failure("gone").put("code", code)
                }
                return failure("down")
            }
            answer.status == 429 -> return failure("rate")
            else -> return failure("down")
        }
    }

    /** A pair the page got itself (activation, the legacy upgrade): its refresh token is kept here. True = memory only. */
    fun adopt(refreshToken: String): Boolean = synchronized(lock) {
        last = null
        keep(refreshToken)
    }

    /** `{present, volatile}`: is there a refresh token for this binding, and is it in memory only. */
    fun status(): JSONObject = synchronized(lock) {
        val inMemory = memory != null
        val present = inMemory || try {
            !store.get(KEY).isNullOrEmpty()
        } catch (e: Exception) {
            true // unknown: never treat a transient failure as a lost token
        }
        JSONObject().put("present", present).put("volatile", inMemory)
    }

    /** «Отключить», or the server dropped the binding. */
    fun forget() = synchronized(lock) { forgetLocked() }

    private fun forgetLocked() {
        memory = null
        last = null
        try {
            store.delete(KEY)
        } catch (e: Exception) {
            // nothing to read it with: the binding is gone on the page too
        }
    }

    /** Keystore only; a refused write keeps it in memory and removes the older Keystore entry. True = memory only. */
    private fun keep(token: String): Boolean {
        return try {
            store.set(KEY, token)
            memory = null
            false
        } catch (e: Exception) {
            memory = token
            try {
                store.delete(KEY)
            } catch (e2: Exception) {
                // the rotated token stays; the server only marks such a reuse
            }
            warn(KEYSTORE_FAILED)
            true
        }
    }

    private fun failure(error: String): JSONObject = JSONObject().put("ok", false).put("error", error)

    companion object {
        /** The JS secret `billing.refresh` (SourceServices.jsSecretKey): the same entry the page used to write. */
        const val KEY = "js:billing.refresh"
        const val REFRESH_URL = "https://billing.omp-player.online/v1/token/refresh"
        const val TIMEOUT_MS = 15_000L
        const val LOST_RETRY_MS = 3_000L
        /** A cached access token is handed to another page only while it has at least this long left. */
        const val REUSE_MIN_LEFT_MS = 60_000L
        const val MAX_TOKEN = 2_048
        const val KEYSTORE_FAILED = "billing refresh token: Keystore write failed, kept in memory only"
        val GONE = setOf("revoked", "refresh_expired", "bad_token")
        private val DEVICE = Regex("^[a-f0-9]{32}$")

        fun errorOf(text: String): String = try {
            JSONObject(text).optString("error", "")
        } catch (e: Exception) {
            ""
        }

        /** The server's pair, or null when it is not one. */
        fun pairOf(text: String): JSONObject? {
            val o = try {
                JSONObject(text)
            } catch (e: Exception) {
                return null
            }
            val refresh = o.opt("refreshToken") as? String
            val access = o.opt("accessToken") as? String
            val exp = o.opt("accessExpiresAt") as? Number
            if (refresh.isNullOrEmpty() || access.isNullOrEmpty() || exp == null) return null
            if (refresh.length > MAX_TOKEN || access.length > MAX_TOKEN) return null
            val out = JSONObject().put("refreshToken", refresh).put("accessToken", access).put("accessExpiresAt", exp.toLong())
            (o.opt("refreshExpiresAt") as? Number)?.let { out.put("refreshExpiresAt", it.toLong()) }
            (o.opt("paidUntil") as? Number)?.let { out.put("paidUntil", it.toLong()) }
            return out
        }
    }
}
