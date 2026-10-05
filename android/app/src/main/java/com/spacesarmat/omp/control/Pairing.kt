package com.spacesarmat.omp.control

import com.spacesarmat.omp.I18n

import java.security.MessageDigest
import java.security.SecureRandom

/** A paired phone: its token (32 hex) and the name it gave when pairing. */
data class PairedPhone(val token: String, val phone: String, val at: Long)

/** Persistence of the paired phones (SharedPreferences on the device, a list in tests). */
interface PhoneStore {
    fun load(): List<PairedPhone>
    fun save(phones: List<PairedPhone>)
}

/**
 * Pairing of phones with this TV: one 4-digit code at a time (each [newCode] replaces the previous one), valid
 * [CODE_TTL_MS]; a right code gives a 32-hex token and is used up; [MAX_ATTEMPTS] wrong codes invalidate it.
 * Up to [MAX_PHONES] tokens are kept, the oldest is evicted. Thread-safe. Pure Kotlin (unit-tested).
 */
class Pairing(
    private val store: PhoneStore,
    private val clock: () -> Long = { System.currentTimeMillis() },
    private val random: SecureRandom = SecureRandom(),
) {
    sealed class Result {
        data class Paired(val token: String, val phone: String) : Result()
        /** `bad_code` or `expired` (also: no code shown, code used up or invalidated). */
        data class Refused(val error: String) : Result()
    }

    data class Code(val code: String, val expiresAt: Long)

    private val lock = Any()
    private var current: Code? = null
    private var wrong = 0
    private var phones: MutableList<PairedPhone>? = null

    fun newCode(): Code = synchronized(lock) {
        val c = Code(random.nextInt(10_000).toString().padStart(4, '0'), clock() + CODE_TTL_MS)
        current = c
        wrong = 0
        c
    }

    /** The code on screen is gone (the pairing screen closed): no code is valid until the next [newCode]. */
    fun clearCode() {
        synchronized(lock) {
            current = null
            wrong = 0
        }
    }

    fun pair(code: String?, phone: String?): Result = synchronized(lock) {
        val c = current
        if (c == null || clock() >= c.expiresAt) {
            current = null
            return Result.Refused(EXPIRED)
        }
        val given = code?.trim().orEmpty()
        if (!MessageDigest.isEqual(given.toByteArray(), c.code.toByteArray())) {
            if (++wrong >= MAX_ATTEMPTS) current = null
            return Result.Refused(BAD_CODE)
        }
        current = null
        val token = newToken()
        val name = cleanName(phone)
        val list = list()
        list.add(PairedPhone(token, name, clock()))
        while (list.size > MAX_PHONES) list.removeAt(0)
        store.save(list.toList())
        Result.Paired(token, name)
    }

    /** True when [token] belongs to a paired phone (constant-time compare). */
    fun isPaired(token: String?): Boolean {
        if (token.isNullOrEmpty()) return false
        val t = token.toByteArray()
        return synchronized(lock) { list().any { MessageDigest.isEqual(it.token.toByteArray(), t) } }
    }

    /** The name the phone with [token] gave when pairing; null when it is not paired (constant-time compare). */
    fun phoneOf(token: String?): String? {
        if (token.isNullOrEmpty()) return null
        val t = token.toByteArray()
        return synchronized(lock) { list().firstOrNull { MessageDigest.isEqual(it.token.toByteArray(), t) }?.phone }
    }

    /** At least one phone is paired. */
    fun anyPaired(): Boolean = synchronized(lock) { list().isNotEmpty() }

    private fun list(): MutableList<PairedPhone> =
        phones ?: store.load().filter { TOKEN.matches(it.token) }.takeLast(MAX_PHONES).toMutableList().also { phones = it }

    private fun newToken(): String {
        val bytes = ByteArray(16)
        random.nextBytes(bytes)
        return bytes.joinToString("") { "%02x".format(it.toInt() and 0xff) }
    }

    companion object {
        const val CODE_TTL_MS = 300_000L
        const val MAX_ATTEMPTS = 5
        const val MAX_PHONES = 10
        const val BAD_CODE = "bad_code"
        const val EXPIRED = "expired"
        private const val MAX_NAME = 64
        val TOKEN = Regex("^[0-9a-f]{32}$")

        fun cleanName(phone: String?): String =
            phone.orEmpty().filter { !it.isISOControl() }.trim().take(MAX_NAME).ifEmpty { I18n.s("phone.default") }
    }
}
