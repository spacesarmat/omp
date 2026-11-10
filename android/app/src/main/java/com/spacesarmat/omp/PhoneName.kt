package com.spacesarmat.omp

import android.content.Context
import android.os.Build
import android.provider.Settings
import com.spacesarmat.omp.sources.BillingTokens

/**
 * The name history and the network should show: the name the person set, else the marketing name,
 * else manufacturer plus the model code («Samsung SM-S938B»).
 */
object PhoneName {
    fun choose(user: String?, market: String?, maker: String?, model: String?): String {
        val code = BillingTokens.modelName(maker, model)
        val u = user.orEmpty().trim()
        if (u.isNotEmpty() && !same(u, model) && !same(u, code) && !same(u, "Android")) return u
        val m = market.orEmpty().trim()
        if (m.isNotEmpty() && !same(m, "unknown") && !same(m, model)) return BillingTokens.modelName(maker, m)
        return code
    }

    fun read(context: Context): Pair<String, String> {
        val code = BillingTokens.modelName(Build.MANUFACTURER, Build.MODEL)
        val user = runCatching { Settings.Global.getString(context.contentResolver, Settings.Global.DEVICE_NAME) }.getOrNull()
            ?: runCatching { Settings.Secure.getString(context.contentResolver, "bluetooth_name") }.getOrNull()
        val market = prop("ro.product.marketname") ?: prop("ro.product.vendor.marketname") ?: prop("ro.product.odm.marketname")
        return choose(user, market, Build.MANUFACTURER, Build.MODEL) to code
    }

    private fun same(a: String, b: String?) = a.equals(b.orEmpty().trim(), ignoreCase = true)

    private fun prop(key: String): String? = try {
        val cls = Class.forName("android.os.SystemProperties")
        val v = cls.getMethod("get", String::class.java).invoke(null, key) as? String
        v?.trim()?.takeIf { it.isNotEmpty() }
    } catch (_: Exception) {
        null
    }
}
