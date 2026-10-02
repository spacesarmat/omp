package com.spacesarmat.omp.control

import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import com.getcapacitor.JSObject
import com.spacesarmat.omp.MainActivity
import com.spacesarmat.omp.player.NativePlayerBridge
import com.spacesarmat.omp.player.PlayerActivity
import java.io.IOException
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/** Which OMP activity is resumed (MainActivity / PlayerActivity set it in onResume/onPause). */
object AppForeground {
    @Volatile
    var main = false

    @Volatile
    var player = false

    val any: Boolean get() = main || player
}

/** Paired phones in SharedPreferences (`omp-remote` / `phones`, a JSON array). */
class PrefsPhoneStore(context: Context) : PhoneStore {
    private val prefs = context.getSharedPreferences("omp-remote", Context.MODE_PRIVATE)

    override fun load(): List<PairedPhone> {
        val arr = try {
            JSONArray(prefs.getString(KEY, "[]") ?: "[]")
        } catch (_: JSONException) {
            JSONArray()
        }
        val out = ArrayList<PairedPhone>()
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            out.add(PairedPhone(o.optString("token"), o.optString("phone"), o.optLong("at")))
        }
        return out
    }

    override fun save(phones: List<PairedPhone>) {
        val arr = JSONArray()
        for (p in phones) arr.put(JSONObject().put("token", p.token).put("phone", p.phone).put("at", p.at))
        prefs.edit().putString(KEY, arr.toString()).apply()
    }

    private companion object {
        const val KEY = "phones"
    }
}

/**
 * Phone remote on Android TV (spec «Управление с телефона»): the control server on [PORT], the NSD service
 * `_omp._tcp`, pairing, and the actions. Page events (through [emit]): remoteLaunch { params },
 * remoteAttach { report }, remoteKey { name }, remoteText { text | delete | enter }, phonePaired { phone }.
 */
class TvRemote(private val context: Context, private val emit: (String, JSObject, Boolean) -> Unit) {
    val pairing = Pairing(PrefsPhoneStore(context))
    private val server = ControlServer(PORT) { route(it) }
    private val main = Handler(Looper.getMainLooper())
    private var nsdListener: NsdManager.RegistrationListener? = null

    fun start() {
        try {
            server.start()
        } catch (e: IOException) {
            Log.w(TAG, "control server not started: ${e.message}")
            return
        }
        registerNsd()
    }

    fun stop() {
        unregisterNsd()
        server.stop()
    }

    /** Name of this TV as the phone shows it (Settings → device name, else the model). */
    fun name(): String {
        val n = try {
            Settings.Global.getString(context.contentResolver, Settings.Global.DEVICE_NAME)
        } catch (_: RuntimeException) {
            null
        }
        return n?.trim()?.ifEmpty { null } ?: Build.MODEL.orEmpty().ifEmpty { "Android TV" }
    }

    private fun version(): String = try {
        context.packageManager.getPackageInfo(context.packageName, 0).versionName.orEmpty()
    } catch (_: Exception) {
        ""
    }

    // ---- NSD ----

    private fun registerNsd() {
        val nsd = context.getSystemService(Context.NSD_SERVICE) as? NsdManager ?: return
        val info = NsdServiceInfo().apply {
            serviceName = name()
            serviceType = SERVICE_TYPE
            port = PORT
            setAttribute("v", version())
        }
        val listener = object : NsdManager.RegistrationListener {
            override fun onServiceRegistered(info: NsdServiceInfo) {}
            override fun onRegistrationFailed(info: NsdServiceInfo, errorCode: Int) {
                Log.w(TAG, "NSD registration failed: $errorCode")
            }
            override fun onServiceUnregistered(info: NsdServiceInfo) {}
            override fun onUnregistrationFailed(info: NsdServiceInfo, errorCode: Int) {}
        }
        try {
            nsd.registerService(info, NsdManager.PROTOCOL_DNS_SD, listener)
            nsdListener = listener
        } catch (e: RuntimeException) {
            Log.w(TAG, "NSD registration failed: ${e.message}")
        }
    }

    private fun unregisterNsd() {
        val listener = nsdListener ?: return
        nsdListener = null
        try {
            (context.getSystemService(Context.NSD_SERVICE) as? NsdManager)?.unregisterService(listener)
        } catch (_: RuntimeException) {
        }
    }

    // ---- routes ----

    private fun route(req: ControlRequest): ControlResponse {
        val known = req.path in ROUTES
        if (!known) return ControlResponse(404, ControlServer.error("not_found"))
        if (req.path == "/omp/info") {
            if (req.method != "GET") return methodNotAllowed()
            return ok(
                JSONObject()
                    .put("name", name())
                    .put("version", version())
                    .put("paired", pairing.isPaired(req.token))
                    .put("foreground", AppForeground.any),
            )
        }
        if (req.method != "POST") return methodNotAllowed()
        val body = parse(req.body) ?: return badRequest()
        if (req.path == "/omp/pair") return pair(body)
        if (!pairing.isPaired(req.token)) return ControlResponse(401, ControlServer.error("unauthorized"))
        return when (req.path) {
            "/omp/launch" -> launch(body)
            "/omp/attach" -> attach(body)
            "/omp/key" -> key(body)
            "/omp/text" -> text(body)
            "/omp/volume" -> volume(body)
            else -> ControlResponse(404, ControlServer.error("not_found"))
        }
    }

    private fun pair(body: JSONObject): ControlResponse {
        val code = body.opt("code")?.let { if (it is String || it is Number) it.toString() else null }
        return when (val r = pairing.pair(code, body.optString("phone"))) {
            is Pairing.Result.Paired -> {
                emit("phonePaired", JSObject().put("phone", r.phone), false)
                ok(JSONObject().put("token", r.token))
            }
            is Pairing.Result.Refused -> ControlResponse(403, ControlServer.error(r.error))
        }
    }

    /**
     * The page runs runLaunchParams(params). A player that is open keeps the screen when the launch plays
     * something (playNative takes it over) or only attaches the phone; a launch that navigates (server, magnet,
     * torrent page) closes it and brings the TV interface to the front.
     */
    private fun launch(body: JSONObject): ControlResponse {
        val params = body.opt("params")
        if (params !is JSONObject) return badRequest()
        val navigates = params.has("server") || params.has("magnet") || (params.has("torrent") && !params.has("file"))
        main.post {
            val player = NativePlayerBridge.player
            if (player != null && !navigates) {
                if (!AppForeground.player) bringToFront(PlayerActivity::class.java)
            } else {
                player?.closeFromRemote()
                if (!AppForeground.main) bringToFront(MainActivity::class.java)
            }
            emit("remoteLaunch", JSObject().put("params", params), true)
        }
        return okEmpty()
    }

    private fun attach(body: JSONObject): ControlResponse {
        val report = body.opt("report") as? String ?: return badRequest()
        if (!REPORT.matches(report.trim()) || report.trim().length > 200) return badRequest()
        emit("remoteAttach", JSObject().put("report", report.trim()), true)
        return okEmpty()
    }

    private fun key(body: JSONObject): ControlResponse {
        val name = body.opt("name") as? String ?: return badRequest()
        if (name !in KEYS) return badRequest()
        main.post {
            val player = NativePlayerBridge.player
            when (name) {
                "NOWPLAYING" -> if (player != null) bringToFront(PlayerActivity::class.java)
                "CATALOG" -> {
                    player?.closeFromRemote()
                    if (!AppForeground.main) bringToFront(MainActivity::class.java)
                    emit("remoteKey", JSObject().put("name", name), false)
                }
                else -> if (player != null && AppForeground.player) player.remoteKey(name)
                else emit("remoteKey", JSObject().put("name", name), false)
            }
        }
        return okEmpty()
    }

    private fun text(body: JSONObject): ControlResponse {
        val data = JSObject()
        when {
            body.opt("text") is String -> {
                val t = body.optString("text")
                if (t.length > MAX_TEXT) return badRequest()
                data.put("text", t)
            }
            body.opt("delete") is Number -> {
                val n = body.optInt("delete")
                if (n < 1 || n > MAX_TEXT) return badRequest()
                data.put("delete", n)
            }
            body.opt("enter") == true -> data.put("enter", true)
            else -> return badRequest()
        }
        emit("remoteText", data, false)
        return okEmpty()
    }

    private fun volume(body: JSONObject): ControlResponse {
        val dir = when (body.opt("dir")) {
            "up" -> AudioManager.ADJUST_RAISE
            "down" -> AudioManager.ADJUST_LOWER
            else -> return badRequest()
        }
        main.post {
            try {
                (context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager)
                    ?.adjustStreamVolume(AudioManager.STREAM_MUSIC, dir, AudioManager.FLAG_SHOW_UI)
            } catch (_: RuntimeException) {
            }
        }
        return okEmpty()
    }

    /** REORDER_TO_FRONT keeps the instance (MainActivity is singleTask, PlayerActivity singleTop). */
    private fun bringToFront(cls: Class<*>) {
        val intent = Intent(context, cls).addFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_SINGLE_TOP,
        )
        try {
            context.startActivity(intent)
        } catch (e: RuntimeException) {
            Log.w(TAG, "bring to front failed: ${e.message}")
        }
    }

    companion object {
        const val PORT = 8095
        const val SERVICE_TYPE = "_omp._tcp"
        private const val TAG = "OmpRemote"
        private const val MAX_TEXT = 1000
        private val ROUTES = setOf("/omp/info", "/omp/pair", "/omp/launch", "/omp/attach", "/omp/key", "/omp/text", "/omp/volume")
        private val KEYS = setOf("UP", "DOWN", "LEFT", "RIGHT", "ENTER", "BACK", "CATALOG", "NOWPLAYING")
        private val REPORT = Regex("^http://.+", RegexOption.IGNORE_CASE)

        private fun parse(body: String): JSONObject? = try {
            if (body.isBlank()) JSONObject() else JSONObject(body)
        } catch (_: JSONException) {
            null
        }

        private fun ok(o: JSONObject) = ControlResponse(200, o.toString())
        private fun okEmpty() = ControlResponse(200, "{\"ok\":true}")
        private fun badRequest() = ControlResponse(400, ControlServer.error("bad_request"))
        private fun methodNotAllowed() = ControlResponse(405, ControlServer.error("method_not_allowed"))
    }
}
