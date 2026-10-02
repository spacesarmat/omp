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
 * Phone remote on Android TV (spec «Управление с телефона»): the control server on [PORT] ([ControlRouter] does
 * the routes), the NSD service `_omp._tcp`, pairing, and the actions. Page events (through [emit]):
 * remoteLaunch { params }, remoteAttach { report }, remoteKey { name }, remoteText { text | delete | enter },
 * phonePaired { phone }.
 */
class TvRemote(private val context: Context, private val emit: (String, JSObject, Boolean) -> Unit) : RemoteActions {
    val pairing = Pairing(PrefsPhoneStore(context))
    private val router = ControlRouter(pairing, this)
    private val server = ControlServer(PORT) { router.route(it) }
    private val main = Handler(Looper.getMainLooper())
    private var nsdListener: NsdManager.RegistrationListener? = null

    /** The name NSD registered (it renames on a clash, e.g. «Гостиная (2)»); null until registered. */
    @Volatile
    private var registeredName: String? = null

    /** False when the port could not be bound: pairing is impossible. */
    @Volatile
    var running = false
        private set

    fun start() {
        try {
            server.start()
        } catch (e: IOException) {
            Log.w(TAG, "control server not started: ${e.message}")
            return
        }
        running = true
        registerNsd()
    }

    fun stop() {
        running = false
        unregisterNsd()
        server.stop()
    }

    /** Name of this TV as the phone sees it: the NSD name, else Settings → device name, else the model. */
    fun name(): String = registeredName ?: deviceName()

    private fun deviceName(): String {
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
            serviceName = deviceName()
            serviceType = SERVICE_TYPE
            port = PORT
            setAttribute("v", version())
        }
        val listener = object : NsdManager.RegistrationListener {
            override fun onServiceRegistered(info: NsdServiceInfo) {
                info.serviceName?.takeIf { it.isNotBlank() }?.let { registeredName = it }
            }
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
        registeredName = null
        try {
            (context.getSystemService(Context.NSD_SERVICE) as? NsdManager)?.unregisterService(listener)
        } catch (_: RuntimeException) {
        }
    }

    // ---- actions (server threads) ----

    override fun info(): JSONObject =
        JSONObject().put("name", name()).put("version", version()).put("foreground", AppForeground.any)

    override fun paired(phone: String) {
        emit("phonePaired", JSObject().put("phone", phone), false)
    }

    /**
     * The page runs runLaunchParams(params). A player that is open keeps the screen when the launch plays
     * something (playNative takes it over) or only attaches the phone; a launch that navigates (server, magnet,
     * torrent page) closes it first and brings the TV interface to the front.
     */
    override fun launch(params: JSONObject) {
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
    }

    override fun attach(report: String) {
        emit("remoteAttach", JSObject().put("report", report), true)
    }

    override fun key(name: String) {
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
    }

    override fun text(data: JSONObject) {
        emit("remoteText", JSObject.fromJSONObject(data), false)
    }

    override fun volume(up: Boolean) {
        val dir = if (up) AudioManager.ADJUST_RAISE else AudioManager.ADJUST_LOWER
        main.post {
            try {
                (context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager)
                    ?.adjustStreamVolume(AudioManager.STREAM_MUSIC, dir, AudioManager.FLAG_SHOW_UI)
            } catch (_: RuntimeException) {
            }
        }
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
    }
}
