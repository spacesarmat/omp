package com.spacesarmat.omp.rpc

import java.security.SecureRandom

/** Key-value storage of [RpcConfig]; `put(k, null)` removes the key (a SharedPreferences adapter on the device). */
interface RpcPrefs {
    fun getInt(k: String): Int?
    fun getString(k: String): String?
    fun getBool(k: String): Boolean?
    fun put(k: String, v: Any?)
}

/**
 * Persistent settings of the phone RPC server (SharedPreferences `omp-rpc`): the switch, the port the TVs know
 * and the 128-bit token in the path. Turning the server off deletes the token, so turning it on again revokes
 * every TV that knew the old address.
 */
class RpcConfig(private val prefs: RpcPrefs, private val random: SecureRandom = SecureRandom()) {
    companion object {
        const val PREFS_NAME = "omp-rpc"
        const val PREFERRED_PORT = 8097
        val TOKEN = Regex("^[0-9a-f]{32}$")
        private const val K_ENABLED = "enabled"
        private const val K_TOKEN = "token"
        private const val K_PORT = "port"
    }

    /** False when never set: the JS side decides the default. */
    val enabled: Boolean
        @Synchronized get() = prefs.getBool(K_ENABLED) ?: false

    @Synchronized
    fun setEnabled(on: Boolean) {
        prefs.put(K_ENABLED, on)
        if (!on) prefs.put(K_TOKEN, null)
    }

    /** The stored token, or a new one saved at once. */
    @Synchronized
    fun token(): String {
        val stored = prefs.getString(K_TOKEN)
        if (stored != null && TOKEN.matches(stored)) return stored
        val bytes = ByteArray(16)
        random.nextBytes(bytes)
        val fresh = bytes.joinToString("") { "%02x".format(it.toInt() and 0xff) }
        prefs.put(K_TOKEN, fresh)
        return fresh
    }

    /** The stored port, or [PREFERRED_PORT]. */
    @Synchronized
    fun port(): Int = prefs.getInt(K_PORT)?.takeIf { it in 1..65_535 } ?: PREFERRED_PORT

    /** Saves the port a bind fell back to (an OS-chosen one), so the TVs keep the same address afterwards. */
    @Synchronized
    fun savePort(p: Int) {
        if (p in 1..65_535) prefs.put(K_PORT, p)
    }
}
