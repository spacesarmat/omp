package com.spacesarmat.omp.rpc

import android.content.Context
import android.content.SharedPreferences

/**
 * [RpcPrefs] over SharedPreferences [RpcConfig.PREFS_NAME]. Ints and booleans are stored with their own types; a value
 * of another type under a key reads as missing.
 */
class SharedRpcPrefs(ctx: Context) : RpcPrefs {
    private val prefs: SharedPreferences = ctx.applicationContext.getSharedPreferences(RpcConfig.PREFS_NAME, Context.MODE_PRIVATE)

    override fun getInt(k: String): Int? = read { if (prefs.contains(k)) prefs.getInt(k, 0) else null }

    override fun getString(k: String): String? = read { prefs.getString(k, null) }

    override fun getBool(k: String): Boolean? = read { if (prefs.contains(k)) prefs.getBoolean(k, false) else null }

    override fun put(k: String, v: Any?) {
        val e = prefs.edit()
        when (v) {
            null -> e.remove(k)
            is Int -> e.putInt(k, v)
            is Boolean -> e.putBoolean(k, v)
            is String -> e.putString(k, v)
            else -> throw IllegalArgumentException("unsupported type for $k")
        }
        // commit: the token and the switch must survive a process kill right after
        e.commit()
    }

    private fun <T> read(get: () -> T?): T? = try {
        get()
    } catch (_: ClassCastException) {
        null
    }
}
