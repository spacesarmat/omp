package com.spacesarmat.omp

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Intent
import androidx.activity.result.ActivityResult
import androidx.core.content.FileProvider
import androidx.core.net.toUri
import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall
import com.spacesarmat.omp.player.Embedded2160
import com.spacesarmat.omp.player.NativePlayerBridge
import com.spacesarmat.omp.player.PlayRequest
import com.spacesarmat.omp.player.Player2160
import com.spacesarmat.omp.player.PlayerActivity
import java.io.File
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/** Player server, external and native playback, share sheet. Bodies for [OmpNativePlugin]. */

internal fun OmpNativePlugin.startPlayerServerOp(call: PluginCall) {
    I18n.load(context)
    val once = CallOnce(call)
    val ip = call.getString("tvIp")?.trim().orEmpty()
    io.execute {
        try {
            once.resolve(JSObject().put("url", player.start(ip)))
        } catch (e: UserError) {
            once.reject(e.message ?: I18n.s("plugin.playerCtlFailed"))
        } catch (_: Exception) {
            once.reject(I18n.s("plugin.playerCtlFailed"))
        }
    }
}

internal fun OmpNativePlugin.stopPlayerServerOp(call: PluginCall) {
    player.stop()
    call.resolve()
}

internal fun OmpNativePlugin.queuePlayerCommandsOp(call: PluginCall) {
    val json = call.getString("json")
    val cmds = try {
        if (json.isNullOrEmpty()) null else JSONArray(json)
    } catch (_: JSONException) {
        null
    }
    if (cmds == null) {
        call.reject(I18n.s("plugin.badCmds"))
        return
    }
    player.enqueue(cmds)
    call.resolve()
}

internal fun OmpNativePlugin.wakeOnLanOp(call: PluginCall) {
    val once = CallOnce(call)
    val mac = call.getString("mac")?.trim().orEmpty()
    val ip = call.getString("ip")?.trim().orEmpty()
    val packet = WakeOnLan.magicPacket(mac)
    if (packet == null || !OmpNativePlugin.IPV4.matches(ip)) {
        once.reject(I18n.s("plugin.wakeFailed"))
        return
    }
    io.execute {
        try {
            WakeOnLan.send(packet, ip)
            once.resolve()
        } catch (_: Exception) {
            once.reject(I18n.s("plugin.wakeSendFailed"))
        }
    }
}

internal fun OmpNativePlugin.player2160Op(call: PluginCall) {
    call.resolve(JSObject().put("package", Player2160.installed(context.packageManager)).put("embedded", true))
}

/** The queue of open2160's items/start/positionMs/fromStart/segments; null (call rejected) when the start item has no url. */
internal fun OmpNativePlugin.queue2160(call: PluginCall): Pair<List<Player2160.Item>, Int>? {
    val arr = call.getArray("items")
    val raw = ArrayList<Player2160.Item>()
    if (arr != null) for (i in 0 until arr.length()) {
        val o = arr.optJSONObject(i)
        raw.add(Player2160.Item(o?.optString("url").orEmpty(), o?.optString("title").orEmpty()))
    }
    return Player2160.playable(raw, call.getInt("start") ?: 0) ?: run {
        call.reject(I18n.s("plugin.noVideoUrl"))
        null
    }
}

internal fun OmpNativePlugin.playEmbedded2160Op(call: PluginCall) {
    val (items, start) = queue2160(call) ?: return
    val position = call.getDouble("positionMs")?.toLong() ?: 0L
    val plan = Embedded2160.plan(items, start, position, call.getBoolean("fromStart") ?: false, call.getString("segments").orEmpty())
    try {
        Embedded2160.applyBackground(context, Embedded2160.backgroundOn(TvMode.isTv(context), call.getBoolean("background") ?: false))
        launchForResult(call, Embedded2160.intent(context, plan), "on2160Result")
    } catch (_: RuntimeException) {
        call.release(capBridge)
        call.reject(I18n.s("plugin.openPlayerFailed"))
    }
}

internal fun OmpNativePlugin.open2160Op(call: PluginCall) {
    val pkg = Player2160.installed(context.packageManager)
    if (pkg == null) {
        call.reject(I18n.s("plugin.p2160Missing"))
        return
    }
    val (items, start) = queue2160(call) ?: return
    val position = call.getDouble("positionMs")?.toLong() ?: 0L
    val spec = Player2160.spec(items, start, position, call.getBoolean("fromStart") ?: false, call.getString("segments").orEmpty())
    val intent = Player2160.intent(pkg, spec, items.map { it.url })
    try {
        launchForResult(call, intent, "on2160Result")
    } catch (_: ActivityNotFoundException) {
        call.release(capBridge)
        call.reject(I18n.s("plugin.p2160Missing"))
    } catch (_: RuntimeException) {
        call.release(capBridge)
        call.reject(I18n.s("plugin.openPlayerFailed"))
    }
}

internal fun OmpNativePlugin.on2160ResultOp(call: PluginCall?, result: ActivityResult) {
    if (call == null) return
    val r = try {
        Player2160.parse(result.resultCode, result.data)
    } catch (_: RuntimeException) {
        Player2160.Result(false)
    }
    call.resolve(JSObject.fromJSONObject(r.toJson()))
    // startActivityForResult saved the call in the bridge: release it, or one call leaks per use
    call.release(capBridge)
}

internal fun OmpNativePlugin.openExternalOp(call: PluginCall) {
    val url = call.getString("url")?.trim().orEmpty()
    val mime = call.getString("mime")?.trim().orEmpty().ifEmpty { "video/*" }
    if (url.isEmpty()) {
        call.reject(I18n.s("plugin.noVideoUrl"))
        return
    }
    val view = Intent(Intent.ACTION_VIEW).setDataAndType(url.toUri(), mime)
    val chooser = Intent.createChooser(view, I18n.s("plugin.openInPlayer"))
    try {
        val act = activity
        if (act != null) act.startActivity(chooser)
        else context.startActivity(chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        call.resolve()
    } catch (_: ActivityNotFoundException) {
        call.reject(I18n.s("plugin.noVideoApp"))
    } catch (_: RuntimeException) {
        call.reject(I18n.s("plugin.openPlayerFailed"))
    }
}

internal fun OmpNativePlugin.shareTextOp(call: PluginCall) {
    val name = shareFileName(call.getString("name"))
    val text = call.getString("text")
    if (text == null) {
        call.reject(I18n.s("plugin.noFileText"))
        return
    }
    try {
        val dir = File(context.cacheDir, "logs").apply { mkdirs() }
        dir.listFiles()?.forEach { it.delete() }
        val file = File(dir, name)
        file.writeText(text, Charsets.UTF_8)
        val uri = FileProvider.getUriForFile(context, context.packageName + ".fileprovider", file)
        val send = Intent(Intent.ACTION_SEND)
            .setType("text/plain")
            .putExtra(Intent.EXTRA_STREAM, uri)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        // ClipData carries the read grant to the chooser and its preview
        send.clipData = ClipData.newRawUri("", uri)
        val chooser = Intent.createChooser(send, call.getString("title")?.trim().orEmpty().take(60).ifEmpty { I18n.s("plugin.shareFile") })
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        val act = activity
        if (act != null) act.startActivity(chooser)
        else context.startActivity(chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        call.resolve()
    } catch (_: ActivityNotFoundException) {
        call.reject(I18n.s("plugin.noShareApp"))
    } catch (_: java.io.IOException) {
        call.reject(I18n.s("plugin.saveFileFailed"))
    } catch (_: RuntimeException) {
        call.reject(I18n.s("plugin.shareFailed"))
    }
}

/** Removes shared files (settings copies hold secrets) older than [maxAgeMs] from cache/logs. */
@Synchronized
internal fun OmpNativePlugin.purgeSharedFiles(maxAgeMs: Long) {
    val now = System.currentTimeMillis()
    File(context.cacheDir, "logs").listFiles()?.forEach { if (now - it.lastModified() > maxAgeMs) it.delete() }
}

internal fun OmpNativePlugin.playNativeOp(call: PluginCall) {
    val req = PlayRequest.parse(call.data)
    if (req == null) {
        call.reject(I18n.s("plugin.nothingToPlay"))
        return
    }
    NativePlayerBridge.resetSkips()
    NativePlayerBridge.resetDonate()
    NativePlayerBridge.resetAss()
    NativePlayerBridge.request = req
    // REORDER_TO_FRONT: an open player below the TV interface takes the queue over (no second instance)
    val intent = Intent(context, PlayerActivity::class.java)
        .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
    try {
        val act = activity
        if (act != null) act.startActivity(intent)
        else context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        call.resolve()
    } catch (_: RuntimeException) {
        call.reject(I18n.s("plugin.startPlayerFailed"))
    }
}

internal fun OmpNativePlugin.pairingCodeOp(call: PluginCall) {
    val r = remote
    if (r == null) {
        call.reject(I18n.s("plugin.remoteUnavailable"))
        return
    }
    // the port could not be bound: a code would be useless
    if (!r.running) {
        call.reject(I18n.s("plugin.ctlServerFailed"))
        return
    }
    val c = r.pairing.newCode()
    call.resolve(JSObject().put("code", c.code).put("expiresAt", c.expiresAt))
}

internal fun OmpNativePlugin.clearPairingCodeOp(call: PluginCall) {
    remote?.pairing?.clearCode()
    call.resolve()
}

internal fun OmpNativePlugin.appBackOp(call: PluginCall) {
    val a = activity
    if (a == null) {
        call.resolve()
        return
    }
    a.runOnUiThread { a.finish() }
    call.resolve()
}

internal fun OmpNativePlugin.tvNameOp(call: PluginCall) {
    val r = remote
    if (r == null) {
        call.reject(I18n.s("plugin.remoteUnavailable"))
        return
    }
    call.resolve(JSObject().put("name", r.name()))
}

internal fun OmpNativePlugin.remoteSourcesDoneOp(call: PluginCall) {
    val r = remote
    if (r == null) {
        call.reject(I18n.s("plugin.remoteUnavailable"))
        return
    }
    // the other sites' results: { siteId: ok | bad_login | captcha | error }
    val logins = LinkedHashMap<String, String?>()
    call.getObject("logins")?.let { o ->
        val it = o.keys()
        while (it.hasNext()) {
            val k = it.next()
            logins[k] = o.opt(k) as? String
        }
    }
    // the browser sessions' results: { siteId: ok | error }
    val sessions = LinkedHashMap<String, String?>()
    call.getObject("sessions")?.let { o ->
        val it = o.keys()
        while (it.hasNext()) {
            val k = it.next()
            sessions[k] = o.opt(k) as? String
        }
    }
    val d = r.sourcesDone(call.getString("id"), call.getString("rutracker"), call.getBoolean("failed") == true, call.getInt("indexers"), logins, sessions)
    // stored = false: the verified rutracker login could not be written; sitesNotStored: the other sites in that state
    val ns = org.json.JSONArray()
    d.sitesNotStored.forEach { ns.put(it) }
    call.resolve(JSObject().put("stored", d.rutrackerStored).put("sitesNotStored", ns))
}

internal fun OmpNativePlugin.remoteSourcesPendingOp(call: PluginCall) {
    val e = remote?.pendingSources()
    call.resolve(JSObject().put("event", e ?: JSONObject.NULL))
}

internal fun OmpNativePlugin.nativePlayerCommandOp(call: PluginCall) {
    val cmd = call.getObject("cmd")
    when {
        cmd == null -> call.reject(I18n.s("plugin.badCmd"))
        // the page's data for the overlay, not a remote command (the player may still be opening)
        cmd.optString("type") == "segments" -> if (NativePlayerBridge.segments(cmd)) call.resolve() else call.reject(I18n.s("plugin.badCmd"))
        cmd.optString("type") == "toast" -> if (NativePlayerBridge.toast(cmd)) call.resolve() else call.reject(I18n.s("plugin.badCmd"))
        cmd.optString("type") == "donate" -> if (NativePlayerBridge.donate(cmd)) call.resolve() else call.reject(I18n.s("plugin.badCmd"))
        cmd.optString("type") == "assSubs" -> if (NativePlayerBridge.assSubs(cmd)) call.resolve() else call.reject(I18n.s("plugin.badCmd"))
        !NativePlayerBridge.command(cmd) -> call.reject(I18n.s("plugin.playerNotOpen"))
        else -> call.resolve()
    }
}
