package com.spacesarmat.omp

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Build
import androidx.activity.result.ActivityResult
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.FileProvider
import androidx.core.net.toUri
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PermissionState
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import com.spacesarmat.omp.control.AppForeground
import com.spacesarmat.omp.control.CloudflareProtocol
import com.spacesarmat.omp.control.CloudflareRelay
import com.spacesarmat.omp.control.CloudflareWatch
import com.spacesarmat.omp.control.HttpWatchTransport
import com.spacesarmat.omp.control.SourcesDone
import com.spacesarmat.omp.control.SourcesProtocol
import com.spacesarmat.omp.control.TvRemote
import com.spacesarmat.omp.install.AdbIdentity
import com.spacesarmat.omp.install.AdbIdentityStore
import com.spacesarmat.omp.install.AesGcmWrapper
import com.spacesarmat.omp.install.ApkAbi
import com.spacesarmat.omp.install.AtvAdbInstaller
import com.spacesarmat.omp.install.CancelToken
import com.spacesarmat.omp.install.DadbConnector
import com.spacesarmat.omp.install.DevModeReminder
import com.spacesarmat.omp.install.HttpKeyServer
import com.spacesarmat.omp.install.InstallCodes
import com.spacesarmat.omp.install.InstallRequest
import com.spacesarmat.omp.install.InstallRunner
import com.spacesarmat.omp.install.JschConnector
import com.spacesarmat.omp.install.LgDevModeInstaller
import com.spacesarmat.omp.install.OkReleaseHttp
import com.spacesarmat.omp.install.ReleaseDownloader
import com.spacesarmat.omp.install.Releases
import com.spacesarmat.omp.install.failureOf
import com.spacesarmat.omp.monitor.MonitorNotifier
import com.spacesarmat.omp.monitor.MonitorPlan
import com.spacesarmat.omp.monitor.MonitorScheduler
import com.spacesarmat.omp.player.NativePlayerBridge
import com.spacesarmat.omp.player.PlayRequest
import com.spacesarmat.omp.player.Player2160
import com.spacesarmat.omp.player.PlayerActivity
import com.spacesarmat.omp.rpc.PhoneRpcService
import com.spacesarmat.omp.rpc.RpcConfig
import com.spacesarmat.omp.rpc.SharedRpcPrefs
import com.spacesarmat.omp.sources.CheckTarget
import com.spacesarmat.omp.sources.CheckTexts
import com.spacesarmat.omp.sources.BrowserLogin
import com.spacesarmat.omp.sources.CheckControl
import com.spacesarmat.omp.sources.CloudflareCheckDialog
import com.spacesarmat.omp.sources.LoginNavigation
import com.spacesarmat.omp.sources.LoginTarget
import com.spacesarmat.omp.sources.SiteSession
import com.spacesarmat.omp.sources.CloudflareSolver
import com.spacesarmat.omp.sources.MainScheduler
import com.spacesarmat.omp.sources.VisibleCheck
import com.spacesarmat.omp.sources.WebViewCloudflareBrowser
import com.spacesarmat.omp.sources.HttpSpec
import com.spacesarmat.omp.sources.SiteHttp
import com.spacesarmat.omp.sources.SiteHttpException
import com.spacesarmat.omp.sources.SourceServices
import java.io.File
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/**
 * Transport for the phone client: SSDP and NSD discovery, TV WebSockets, external player, APK update, magnet intake,
 * local player server (TV state in, commands out), embedded TorrServer ([TorrServerService]).
 * Search sources: site HTTP ([SiteHttp], cookies per site) and Keystore-encrypted secrets ([SecretStorage]).
 * The SSAP protocol itself (register, requests, pairing) lives in TypeScript.
 *
 * Every PluginCall is settled exactly once (see [Once]). Blocking work runs on [io]; socket
 * callbacks arrive on OkHttp threads. Events: tvMessage { json }, tvClosed { reason },
 * apkProgress { percent }, magnetReceived { link }, playerMessage { body }, monitorOpen { url }, monitorDone { summary? },
 * localServerState { running, error? }, localServerDownload { percent? , phase: download|verify }, nativePlayerState { session, index, time, duration, paused, buffering,
 * audio, subs }, nativePlayerClosed { session, index, time, duration, replaced? } (native player on Android TV);
 * phone remote on Android TV ([TvRemote]): remoteLaunch { params }, remoteAttach { report, lang? }, remoteKey { name },
 * remoteText { text | delete | enter }, phonePaired { phone }, remoteSources { id, sources, rutracker, phone }.
 * Install assistant ([com.spacesarmat.omp.install]): installProgress { phase, item, percent?, version? }.
 */
@CapacitorPlugin(
    name = "OmpNative",
    permissions = [Permission(alias = "notifications", strings = [Manifest.permission.POST_NOTIFICATIONS])],
)
class OmpNativePlugin : Plugin() {
    private val io: ExecutorService = Executors.newCachedThreadPool()
    private val lock = Any()

    private var tv: TvSocket? = null
    private var tvIp: String? = null
    private var pendingConnect: Once? = null
    private var pointer: TvSocket? = null
    private var pendingPointer: Once? = null
    private val downloading = AtomicBoolean(false)
    private val installing = AtomicBoolean(false)
    @Volatile
    private var installCancel: CancelToken? = null
    private val player = PlayerServer { body -> notifyListeners("playerMessage", JSObject().put("body", body)) }
    // phone remote: only in TV mode
    private var remote: TvRemote? = null
    // search sources: created on first use (Keystore access off the main thread)
    // one per process, shared with the background monitor page ([SourceServices])
    private val sources by lazy { SourceServices.get(context) }
    private val serverState = LocalTorrServer.Listener { running, error ->
        val o = JSObject().put("running", running)
        if (error != null) o.put("error", error)
        notifyListeners("localServerState", o)
    }

    private val downloadProgress = LocalTorrServer.DownloadListener { phase, percent ->
        val o = JSObject().put("phase", phase)
        if (percent != null) o.put("percent", percent)
        notifyListeners("localServerDownload", o)
    }

    override fun load() {
        I18n.load(context)
        instance = this
        LocalTorrServer.addDownloadListener(downloadProgress)
        purgeSharedFiles(10 * 60 * 1000L)
        NativePlayerBridge.emitter = { event, data -> notifyListeners(event, data) }
        LocalTorrServer.addListener(serverState)
        if (TvMode.isTv(context)) {
            val r = TvRemote(context.applicationContext) { event, data, retain -> notifyListeners(event, data, retain) }
            remote = r
            // binding a local port and NSD registration (async) are quick; synchronous so stop() never races start()
            r.start()
        }
        // TV search on, but its service is not running (force-stopped, or a boot start the system refused)
        try {
            if (PhoneRpcService.runningPort < 0 && RpcConfig(SharedRpcPrefs(context)).enabled) PhoneRpcService.start(context)
        } catch (_: Exception) {
        }
        // a magnet that arrived before the bridge was ready
        synchronized(magnetLock) { pendingMagnet }?.let { emitMagnet(it) }
        synchronized(magnetLock) { pendingOpen }?.let { emitMonitorOpen(it) }
    }

    override fun handleOnDestroy() {
        cfCheck?.let { c -> activity?.runOnUiThread { c.cancel() } ?: c.cancel() }
        if (instance === this) instance = null
        NativePlayerBridge.emitter = null
        LocalTorrServer.removeListener(serverState)
        LocalTorrServer.removeDownloadListener(downloadProgress)
        closeAll()
        player.stop()
        remote?.stop()
        remote = null
        // blocking socket I/O ignores interrupts: close the install's sockets so it ends now
        installCancel?.cancel()
        io.shutdownNow()
    }

    @PluginMethod
    fun isTv(call: PluginCall) {
        call.resolve(JSObject().put("tv", TvMode.isTv(context)))
    }

    /** { lang: ru | en }: the page's resolved UI language, kept for the native copy under [LANG_KEY]; another value is ignored. */
    @PluginMethod
    fun setLanguage(call: PluginCall) {
        val lang = call.getString("lang")
        if (lang == "ru" || lang == "en") {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(LANG_KEY, lang).apply()
            I18n.lang = lang
        }
        call.resolve()
    }

    // ---- discovery ----

    @PluginMethod
    fun discoverTvs(call: PluginCall) {
        val once = Once(call)
        val timeout = (call.getInt("timeoutMs") ?: 3000).coerceIn(500, 15000).toLong()
        io.execute {
            try {
                val tvs = Ssdp.discover(context, timeout)
                val arr = JSArray()
                for (t in tvs) {
                    val o = JSObject()
                    o.put("ip", t.ip)
                    o.put("name", t.name)
                    if (t.model != null) o.put("model", t.model)
                    arr.put(o)
                }
                once.resolve(JSObject().put("tvs", arr))
            } catch (e: Exception) {
                once.reject(I18n.s("plugin.discoverFailed"))
            }
        }
    }

    /** NSD search for OMP on Android TV: { tvs: [{ ip, port, name, version }] }. */
    @PluginMethod
    fun discoverOmpTvs(call: PluginCall) {
        val once = Once(call)
        val timeout = (call.getInt("timeoutMs") ?: 3000).coerceIn(500, 15000).toLong()
        val group = searchGroup(call)
        io.execute {
            try {
                val arr = JSArray()
                for (t in OmpDiscovery.discover(context, timeout, group)) {
                    arr.put(
                        JSObject().put("ip", t.ip).put("port", t.port).put("name", t.name).put("version", t.version),
                    )
                }
                once.resolve(JSObject().put("tvs", arr))
            } catch (e: Exception) {
                once.reject(I18n.s("plugin.discoverFailed"))
            }
        }
    }

    /** Install assistant: NSD search for Google Cast devices: { tvs: [{ ip, name, model? }] }. */
    @PluginMethod
    fun discoverCastTvs(call: PluginCall) {
        val once = Once(call)
        val timeout = (call.getInt("timeoutMs") ?: 3000).coerceIn(500, 15000).toLong()
        val group = searchGroup(call)
        io.execute {
            try {
                val arr = JSArray()
                for (t in CastDiscovery.discover(context, timeout, group)) {
                    val o = JSObject().put("ip", t.ip).put("name", t.name)
                    if (t.model != null) o.put("model", t.model)
                    arr.put(o)
                }
                once.resolve(JSObject().put("tvs", arr))
            } catch (e: Exception) {
                once.reject(I18n.s("plugin.discoverFailed"))
            }
        }
    }

    /** Optional search group of a discovery call (one per screen); at most 64 characters. */
    private fun searchGroup(call: PluginCall): String? = call.getString("group")?.trim()?.take(64)?.takeIf { it.isNotEmpty() }

    /** { group }: stops only the NSD searches started with that group (the screen has gone); they return what they found. */
    @PluginMethod
    fun stopDiscovery(call: PluginCall) {
        searchGroup(call)?.let { OmpDiscovery.cancelGroup(it) }
        call.resolve()
    }

    /** Install assistant: which of the install ports ([PortProbe.ALLOWED]) answer on a home-network IP: { open: [] }. */
    @PluginMethod
    fun probePorts(call: PluginCall) {
        val once = Once(call)
        val ip = call.getString("ip")?.trim().orEmpty()
        val timeout = (call.getInt("timeoutMs") ?: 1500).coerceIn(200, 5000)
        val ports = ArrayList<Int>()
        val raw = call.getArray("ports")
        if (raw != null) {
            for (i in 0 until raw.length()) {
                val p = raw.optInt(i, -1)
                if (p > 0) ports.add(p)
            }
        }
        if (!PortProbe.isPrivateIpv4(ip)) {
            once.reject(I18n.s("plugin.badTvAddr"))
            return
        }
        io.execute {
            val arr = JSArray()
            for (p in PortProbe.open(ip, ports, timeout)) arr.put(p)
            once.resolve(JSObject().put("open", arr))
        }
    }

    /**
     * «Источники поиска»: hosts of the device's /24 that answer on the Jackett / Prowlarr / FlareSolverr ports ([LanScan.ALLOWED]):
     * { hits: [{ ip, port }], lan }. Without a Wi-Fi IPv4 (mobile data) lan is false and nothing is scanned. Nothing is logged.
     */
    @PluginMethod
    fun scanLan(call: PluginCall) {
        val once = Once(call)
        val timeout = (call.getInt("timeoutMs") ?: LanScan.DEFAULT_TIMEOUT_MS).coerceIn(150, 1500)
        val ports = ArrayList<Int>()
        val raw = call.getArray("ports")
        if (raw != null) {
            for (i in 0 until raw.length()) {
                val p = raw.optInt(i, -1)
                if (p > 0) ports.add(p)
            }
        }
        io.execute {
            val arr = JSArray()
            val ip = LocalTorrServer.wifiIpv4(context)
            if (ip != null) {
                for (h in LanScan.scan(ip, ports, timeout)) arr.put(JSObject().put("ip", h.ip).put("port", h.port))
            }
            once.resolve(JSObject().put("hits", arr).put("lan", ip != null))
        }
    }

    // ---- install assistant: install OMP on a TV ----

    /**
     * Installs OMP on an LG TV in Developer Mode ({ method: 'lg-devmode', ip, passphrase, withHbc }) or an Android TV
     * over adb ({ method: 'atv-adb', ip }). Progress: events installProgress { phase, percent?, item, version? }.
     * Resolves { version, hbcVersion?, hbcError?, sdkInt?, abi? }; rejects with an InstallCodes code as message and
     * code. One install at a time; nothing is logged (addresses, passphrase, key).
     */
    @PluginMethod
    fun installStart(call: PluginCall) {
        val once = Once(call)
        val method = call.getString("method").orEmpty()
        val ip = call.getString("ip")?.trim().orEmpty()
        val withHbc = call.getBoolean("withHbc", false) == true
        val pass = call.getString("passphrase")?.toCharArray()
        if (!PortProbe.isPrivateIpv4(ip) || (method != InstallRequest.LG && method != InstallRequest.ATV)) {
            pass?.fill('\u0000')
            once.reject(InstallCodes.BAD_TARGET, InstallCodes.BAD_TARGET)
            return
        }
        if (!installing.compareAndSet(false, true)) {
            pass?.fill('\u0000')
            once.reject(InstallCodes.BUSY, InstallCodes.BUSY)
            return
        }
        val cancel = CancelToken()
        installCancel = cancel
        val req = InstallRequest(method, ip, pass, withHbc)
        io.execute {
            try {
                val http = OkReleaseHttp()
                val runner = InstallRunner(
                    Releases(http),
                    ReleaseDownloader(http, File(context.cacheDir, "install")),
                    LgDevModeInstaller(HttpKeyServer(), JschConnector()),
                    AtvAdbInstaller(DadbConnector(adbIdentities())),
                )
                val out = runner.run(req, { phase, percent, item, version ->
                    val o = JSObject().put("phase", phase.id).put("item", item.id)
                    if (percent != null) o.put("percent", percent)
                    if (version != null) o.put("version", version)
                    notifyListeners("installProgress", o)
                }, cancel)
                val r = JSObject().put("version", out.version)
                out.hbcVersion?.let { r.put("hbcVersion", it) }
                out.hbcError?.let { r.put("hbcError", it) }
                out.sdkInt?.let { r.put("sdkInt", it) }
                out.abi?.let { r.put("abi", it) }
                once.resolve(r)
            } catch (e: Throwable) {
                val f = failureOf(e, cancel)
                once.reject(f.code, f.code)
            } finally {
                req.wipe()
                installCancel = null
                installing.set(false)
            }
        }
    }

    /** The phone's adb identity, encrypted with a Keystore key, in noBackupFilesDir (not backed up or transferred). */
    private fun adbIdentities(): AdbIdentityStore {
        // earlier builds kept the key in plain text here, or briefly as temporary files while generating it
        File(context.filesDir, "adb").deleteRecursively()
        File(context.cacheDir, "adbtmp").deleteRecursively()
        return AdbIdentityStore(
            File(context.noBackupFilesDir, "adb/identity.enc"),
            AesGcmWrapper { AesGcmWrapper.keystoreKey("omp-adb-aes") },
        ) { AdbIdentity.generate() }
    }

    /** Stops the running install (downloads and temp files are removed). */
    @PluginMethod
    fun installCancel(call: PluginCall) {
        installCancel?.cancel()
        call.resolve()
    }

    /**
     * { tv, id?, name?, at: unix ms } schedules the Developer Mode reminder for that TV (tv = its address, id = a stable
     * TV id when known; both stored only as hashes, an older reminder of the same TV under either key is replaced);
     * { tv, id?, at: null } cancels it.
     */
    @PluginMethod
    fun devModeReminder(call: PluginCall) {
        val tv = call.getString("tv")?.trim().orEmpty()
        val at = call.getLong("at")
        if (tv.isEmpty()) {
            call.reject(I18n.s("plugin.noTv"))
        } else if (at == null) {
            DevModeReminder.cancel(context, tv, stableId(call))
            call.resolve()
        } else if (DevModeReminder.schedule(context, tv, call.getString("name"), at, stableId = stableId(call))) {
            call.resolve()
        } else {
            call.reject(I18n.s("plugin.badReminder"))
        }
    }

    private fun stableId(call: PluginCall): String? = call.getString("id")?.trim()?.take(128)?.takeIf { it.isNotEmpty() }

    /** { tv, id? } → { at? }: when the reminder for that TV is due; absent when none is scheduled. */
    @PluginMethod
    fun devModeReminderState(call: PluginCall) {
        val once = Once(call)
        val tv = call.getString("tv")?.trim().orEmpty()
        if (tv.isEmpty()) {
            once.reject(I18n.s("plugin.noTv"))
            return
        }
        val id = stableId(call)
        io.execute {
            val o = JSObject()
            try {
                DevModeReminder.scheduledAt(context, tv, id)?.let { o.put("at", it) }
            } catch (_: Exception) {
            }
            once.resolve(o)
        }
    }

    /** Phone model for the TV's list of paired phones, e.g. «Google Pixel 7». */
    @PluginMethod
    fun phoneName(call: PluginCall) {
        call.resolve(JSObject().put("name", deviceName()))
    }

    private fun deviceName(): String {
        val maker = Build.MANUFACTURER.orEmpty().trim()
        val model = Build.MODEL.orEmpty().trim()
        return when {
            model.isEmpty() -> maker
            maker.isEmpty() || model.startsWith(maker, ignoreCase = true) -> model
            else -> maker.replaceFirstChar { it.uppercase() } + " " + model
        }
    }

    // ---- TV search: the phone RPC server ([PhoneRpcService]) ----

    /**
     * Turns the TV search on (stores the switch, starts the foreground service) or off (stops it and deletes the
     * token, so TVs that knew the old address are revoked). Resolves like [rpcInfo].
     */
    @PluginMethod
    fun rpcSetEnabled(call: PluginCall) {
        val once = Once(call)
        val on = call.getBoolean("on") ?: run {
            once.reject(I18n.s("errors.badRequest"))
            return
        }
        io.execute {
            try {
                val config = RpcConfig(SharedRpcPrefs(context))
                config.setEnabled(on)
                if (on) {
                    PhoneRpcService.start(context)
                    // wait briefly for the bind, so the answer carries the real port and running = true
                    val until = System.currentTimeMillis() + RPC_START_WAIT_MS
                    while (PhoneRpcService.runningPort < 0 && System.currentTimeMillis() < until) Thread.sleep(50)
                } else {
                    PhoneRpcService.stop(context)
                }
                once.resolve(rpcInfoOf(config))
            } catch (_: Exception) {
                once.reject(I18n.s("plugin.stateFailed"))
            }
        }
    }

    /** `{enabled:false}` when the TV search is off; else the address the TVs use. Never logs the token. */
    @PluginMethod
    fun rpcInfo(call: PluginCall) {
        val once = Once(call)
        io.execute {
            try {
                once.resolve(rpcInfoOf(RpcConfig(SharedRpcPrefs(context))))
            } catch (_: Exception) {
                once.reject(I18n.s("plugin.stateFailed"))
            }
        }
    }

    private fun rpcInfoOf(config: RpcConfig): JSObject {
        if (!config.enabled) return JSObject().put("enabled", false)
        val bound = PhoneRpcService.runningPort
        val o = JSObject()
            .put("enabled", true)
            .put("running", bound > 0)
            .put("port", if (bound > 0) bound else config.port())
            .put("token", config.token())
            .put("name", deviceName().take(60))
        LocalTorrServer.wifiIpv4(context)?.let { o.put("ip", it) }
        return o
    }

    // ---- main TV socket ----

    @PluginMethod
    fun tvConnect(call: PluginCall) {
        val once = Once(call)
        val ip = call.getString("ip")?.trim().orEmpty()
        val register = call.getString("register")
        if (!IPV4.matches(ip)) {
            once.reject(I18n.s("plugin.badTvAddr2"))
            return
        }
        if (register.isNullOrEmpty()) {
            once.reject(I18n.s("plugin.noRegMsg"))
            return
        }
        closeAll()
        var self: TvSocket? = null
        I18n.load(context)
        val socket = TvSocket(
            onOpen = { s ->
                if (!s.send(register)) {
                    s.close()
                    clearTv(s)
                    once.reject(I18n.s("plugin.tvSendFailed"))
                } else {
                    synchronized(lock) { if (pendingConnect === once) pendingConnect = null }
                    once.resolve(JSObject().put("port", s.port))
                }
            },
            onFail = { _ ->
                clearTv(self)
                once.reject(I18n.s("plugin.tvConnectFailed"))
            },
            onMessage = { text -> notifyListeners("tvMessage", JSObject().put("json", text)) },
            onClosed = { reason ->
                if (clearTv(self)) {
                    closePointer()
                    notifyListeners("tvClosed", JSObject().put("reason", reason))
                }
            },
        )
        self = socket
        synchronized(lock) {
            tv = socket
            tvIp = ip
            pendingConnect = once
        }
        val preferPort = call.getInt("preferPort")?.takeIf { it == 3000 || it == 3001 }
        socket.race(
            listOf(
                TvCandidate(3000, "ws://$ip:3000/", TvHttp.plain()),
                TvCandidate(3001, "wss://$ip:3001/", TvHttp.trustingOnly(ip)),
            ),
            preferPort,
        )
    }

    @PluginMethod
    fun tvSend(call: PluginCall) {
        val json = call.getString("json")
        val socket = synchronized(lock) { tv }
        when {
            json.isNullOrEmpty() -> call.reject(I18n.s("plugin.emptyMsg"))
            socket == null || !socket.isOpen -> call.reject(I18n.s("plugin.tvNotConnected"))
            !socket.send(json) -> call.reject(I18n.s("plugin.tvCmdFailed"))
            else -> call.resolve()
        }
    }

    @PluginMethod
    fun tvDisconnect(call: PluginCall) {
        closeAll()
        call.resolve()
    }

    // ---- pointer socket ----

    @PluginMethod
    fun pointerConnect(call: PluginCall) {
        val once = Once(call)
        val raw = call.getString("url")?.trim().orEmpty()
        val ip = synchronized(lock) { if (tv?.isOpen == true) tvIp else null }
        if (ip == null) {
            once.reject(I18n.s("plugin.tvNotConnected"))
            return
        }
        // OkHttp parses ws/wss as http/https
        val parsed = raw.replaceFirst(Regex("^ws", RegexOption.IGNORE_CASE), "http").toHttpUrlOrNull()
        if (parsed == null || !raw.matches(Regex("^wss?://.*", RegexOption.IGNORE_CASE)) || parsed.host != ip) {
            once.reject(I18n.s("plugin.badRemoteAddr"))
            return
        }
        closePointer()
        var self: TvSocket? = null
        val client = if (parsed.isHttps) TvHttp.trustingOnly(ip) else TvHttp.plain()
        I18n.load(context)
        val socket = TvSocket(
            onOpen = { _ ->
                synchronized(lock) { if (pendingPointer === once) pendingPointer = null }
                once.resolve()
            },
            onFail = { _ ->
                clearPointer(self)
                once.reject(I18n.s("plugin.remoteConnectFailed"))
            },
            onMessage = { _ -> },
            onClosed = { _ -> clearPointer(self) },
        )
        self = socket
        synchronized(lock) {
            pointer = socket
            pendingPointer = once
        }
        socket.connect(listOf(raw), listOf(client))
    }

    @PluginMethod
    fun pointerSend(call: PluginCall) {
        val frame = call.getString("frame")
        val socket = synchronized(lock) { pointer }
        when {
            frame.isNullOrEmpty() -> call.reject(I18n.s("plugin.emptyCmd"))
            socket == null || !socket.isOpen -> call.reject(I18n.s("plugin.remoteNotConnected"))
            !socket.send(frame) -> call.reject(I18n.s("plugin.tvCmdFailed"))
            else -> call.resolve()
        }
    }

    /** Forgets [only] if it is still the current TV socket; true if it was. */
    private fun clearTv(only: TvSocket?): Boolean =
        synchronized(lock) {
            if (only != null && tv === only) {
                tv = null
                tvIp = null
                pendingConnect = null
                true
            } else {
                false
            }
        }

    private fun clearPointer(only: TvSocket?) {
        synchronized(lock) {
            if (only != null && pointer === only) {
                pointer = null
                pendingPointer = null
            }
        }
    }

    private fun closePointer() {
        val (socket, pending) = synchronized(lock) {
            val r = pointer to pendingPointer
            pointer = null
            pendingPointer = null
            r
        }
        socket?.close()
        pending?.reject(I18n.s("plugin.connectCancelled"))
    }

    /** Silent close of both sockets; a pending tvConnect is rejected. No tvClosed event. */
    private fun closeAll() {
        closePointer()
        val (socket, pending) = synchronized(lock) {
            val r = tv to pendingConnect
            tv = null
            tvIp = null
            pendingConnect = null
            r
        }
        socket?.close()
        pending?.reject(I18n.s("plugin.connectCancelled"))
    }

    // ---- player server (TV -> phone state, phone -> TV commands) ----

    @PluginMethod
    fun startPlayerServer(call: PluginCall) {
        I18n.load(context)
        val once = Once(call)
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

    @PluginMethod
    fun stopPlayerServer(call: PluginCall) {
        player.stop()
        call.resolve()
    }

    @PluginMethod
    fun queuePlayerCommands(call: PluginCall) {
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

    // ---- Wake-on-LAN ----

    @PluginMethod
    fun wakeOnLan(call: PluginCall) {
        val once = Once(call)
        val mac = call.getString("mac")?.trim().orEmpty()
        val ip = call.getString("ip")?.trim().orEmpty()
        val packet = WakeOnLan.magicPacket(mac)
        if (packet == null || !IPV4.matches(ip)) {
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

    // ---- external player ----

    /** Which 2160 Player package is installed, or null. */
    @PluginMethod
    fun player2160(call: PluginCall) {
        call.resolve(JSObject().put("package", Player2160.installed(context.packageManager)))
    }

    /** Opens 2160 Player on a playlist for result: resolves with where playback stopped ({returned:false} if nothing). */
    @PluginMethod
    fun open2160(call: PluginCall) {
        val pkg = Player2160.installed(context.packageManager)
        if (pkg == null) {
            call.reject(I18n.s("plugin.p2160Missing"))
            return
        }
        val arr = call.getArray("items")
        val items = ArrayList<Player2160.Item>()
        if (arr != null) for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            val url = o.optString("url").trim()
            if (url.isNotEmpty()) items.add(Player2160.Item(url, o.optString("title")))
        }
        if (items.isEmpty()) {
            call.reject(I18n.s("plugin.noVideoUrl"))
            return
        }
        val start = (call.getInt("start") ?: 0).coerceIn(0, items.lastIndex)
        val position = call.getDouble("positionMs")?.toLong() ?: 0L
        val spec = Player2160.spec(items, start, position, call.getBoolean("fromStart") ?: false, call.getString("segments").orEmpty())
        val intent = Player2160.intent(pkg, spec, items.map { it.url })
        try {
            startActivityForResult(call, intent, "on2160Result")
        } catch (_: ActivityNotFoundException) {
            call.reject(I18n.s("plugin.p2160Missing"))
        } catch (_: RuntimeException) {
            call.reject(I18n.s("plugin.openPlayerFailed"))
        }
    }

    @ActivityCallback
    private fun on2160Result(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        val r = try {
            Player2160.parse(result.resultCode, result.data)
        } catch (_: RuntimeException) {
            Player2160.Result(false)
        }
        call.resolve(JSObject.fromJSONObject(r.toJson()))
        // startActivityForResult saved the call in the bridge: release it, or one call leaks per use
        call.release(bridge)
    }

    @PluginMethod
    fun openExternal(call: PluginCall) {
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

    /** Writes [text] to cache/logs/[name] and opens the system share sheet for it (FileProvider, text/plain).
     *  Older shared files are removed first (a settings copy holds secrets); [title] is the chooser title. */
    @Synchronized
    @PluginMethod
    fun shareText(call: PluginCall) {
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
    private fun purgeSharedFiles(maxAgeMs: Long) {
        val now = System.currentTimeMillis()
        File(context.cacheDir, "logs").listFiles()?.forEach { if (now - it.lastModified() > maxAgeMs) it.delete() }
    }

    // ---- native player (Android TV) ----

    /** Opens [PlayerActivity] with the queue (an open player takes the new queue over); resolves once launched. */
    @PluginMethod
    fun playNative(call: PluginCall) {
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

    // ---- phone remote (Android TV) ----

    /** A new 4-digit pairing code (the previous one stops working): { code, expiresAt } (epoch ms). */
    @PluginMethod
    fun pairingCode(call: PluginCall) {
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

    /** The pairing screen closed: the code shown there stops working. */
    @PluginMethod
    fun clearPairingCode(call: PluginCall) {
        remote?.pairing?.clearCode()
        call.resolve()
    }

    /** The TV name the phone sees (the registered NSD name): { name }. */
    @PluginMethod
    fun tvName(call: PluginCall) {
        val r = remote
        if (r == null) {
            call.reject(I18n.s("plugin.remoteUnavailable"))
            return
        }
        call.resolve(JSObject().put("name", r.name()))
    }

    /** «Передать на телевизор»: the page applied remoteSources { id } (rutracker = login result) or { failed }. */
    @PluginMethod
    fun remoteSourcesDone(call: PluginCall) {
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

    /**
     * The transfer still waiting for the page ({ event: remoteSources data } or { event: null }): the event is not
     * retained, so a page that starts listening late asks for the one current transfer, never an old backlog.
     */
    @PluginMethod
    fun remoteSourcesPending(call: PluginCall) {
        val e = remote?.pendingSources()
        call.resolve(JSObject().put("event", e ?: JSONObject.NULL))
    }

    /** A phone command for the open native player ({ cmd: Cmd }). */
    @PluginMethod
    fun nativePlayerCommand(call: PluginCall) {
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

    // ---- APK update ----

    /** Whether libVLC runs on this device (its native libraries are present and load): { available }. */
    @PluginMethod
    fun vlcAvailable(call: PluginCall) {
        call.resolve(JSObject().put("available", com.spacesarmat.omp.player.VlcAvailability.available(context)))
    }

    /** Feed key of this device's APK («arm64» / «armv7»; "" = universal), the same rule as downloadAndInstallApk. */
    @PluginMethod
    fun deviceAbiKey(call: PluginCall) {
        call.resolve(JSObject().put("key", ApkAbi.key(Build.SUPPORTED_ABIS.toList()) ?: ""))
    }

    @PluginMethod
    fun downloadAndInstallApk(call: PluginCall) {
        val once = Once(call)
        // the feed's per-ABI APK for this device (arm64 / armv7) when the page passed them, else the universal one
        val apk = ApkAbi.choose(
            Build.SUPPORTED_ABIS.toList(),
            ApkAbi.Apk(call.getString("url")?.trim().orEmpty(), call.getString("sha256").orEmpty(), 0L),
            ApkAbi.parseApks(call.getObject("apks")),
        )
        val url = apk.url
        val sha = apk.sha256
        if (!ApkInstaller.canInstall(context)) {
            // the system page «Установка неизвестных приложений»; the install goes on when the user comes back with
            // the switch on (handleOnResume), else it ends with «Разрешите установку…»
            try {
                ApkInstaller.openInstallPermissionSettings(context)
            } catch (_: RuntimeException) {
                once.reject(I18n.s("plugin.allowInstall"), "omp")
                return
            }
            permissionWait?.job?.reject(I18n.s("plugin.updateBusy"), "omp")
            permissionWait = InstallPermissionWait(ApkJob(once, url, sha))
            return
        }
        startApkInstall(ApkJob(once, url, sha))
    }

    private class ApkJob(val once: Once, val url: String, val sha: String) {
        fun reject(message: String, code: String) = once.reject(message, code)
    }

    /** An install waiting for the «unknown apps» permission (main thread only). */
    private var permissionWait: InstallPermissionWait<ApkJob>? = null

    @PluginMethod
    fun canInstallApks(call: PluginCall) {
        call.resolve(JSObject().put("granted", ApkInstaller.canInstall(context)))
    }

    override fun handleOnPause() {
        super.handleOnPause()
        permissionWait?.onPause()
    }

    override fun handleOnResume() {
        super.handleOnResume()
        val w = permissionWait ?: return
        when (w.onResume(ApkInstaller.canInstall(context))) {
            InstallPermissionWait.Next.WAIT -> Unit
            InstallPermissionWait.Next.INSTALL -> {
                permissionWait = null
                startApkInstall(w.job)
            }
            InstallPermissionWait.Next.GIVE_UP -> {
                permissionWait = null
                w.job.reject(I18n.s("plugin.allowInstall"), "omp")
            }
        }
    }

    private fun startApkInstall(job: ApkJob) {
        val once = job.once
        val url = job.url
        val sha = job.sha
        if (!downloading.compareAndSet(false, true)) {
            once.reject(I18n.s("plugin.updateBusy"), "omp")
            return
        }
        io.execute {
            try {
                val apk = ApkInstaller.download(context, url, sha) { p ->
                    notifyListeners("apkProgress", JSObject().put("percent", p))
                }
                ApkInstaller.install(context, apk)
                once.resolve()
            } catch (e: UserError) {
                once.reject(e.message ?: I18n.s("plugin.updateFailed"), "omp")
            } catch (_: Exception) {
                once.reject(I18n.s("plugin.updateFailed"), "omp")
            } finally {
                downloading.set(false)
            }
        }
    }

    // ---- embedded TorrServer ----

    @PluginMethod
    fun localServerInfo(call: PluginCall) {
        val once = Once(call)
        io.execute {
            try {
                once.resolve(localInfo())
            } catch (_: Exception) {
                once.reject(I18n.s("plugin.stateFailed"))
            }
        }
    }

    /**
     * Downloads the pinned TorrServer binary (GitHub release asset, sha256 + size checked). Progress: events
     * localServerDownload { phase: 'download', percent } then { phase: 'verify' }. A call while a download runs joins
     * it (no second download). Resolves the server info; rejects with Russian text (next step included) and the
     * InstallCodes code.
     */
    @PluginMethod
    fun downloadLocalServer(call: PluginCall) {
        val once = Once(call)
        if (!LocalTorrServer.supported()) {
            once.reject(NOT_SUPPORTED, "unsupported")
            return
        }
        io.execute {
            try {
                LocalTorrServer.download(context)
                once.resolve(localInfo())
            } catch (e: Throwable) {
                val f = failureOf(e)
                val mb = try {
                    LocalTorrServer.pin(context).size / (1024 * 1024)
                } catch (_: Exception) {
                    0L
                }
                once.reject(TorrServerBinary.downloadError(f.code, mb), f.code)
            }
        }
    }

    @PluginMethod
    fun cancelLocalServerDownload(call: PluginCall) {
        LocalTorrServer.cancelDownload()
        call.resolve()
    }

    @PluginMethod
    fun startLocalServer(call: PluginCall) {
        if (!LocalTorrServer.supported()) {
            call.reject(NOT_SUPPORTED)
            return
        }
        val runnable = try {
            LocalTorrServer.installation(context).runnable()
        } catch (_: Exception) {
            false
        }
        if (!runnable) {
            call.reject(NOT_DOWNLOADED, "not-downloaded")
            return
        }
        // without the permission the service still runs, only its notification is hidden
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "startAfterPermission")
            return
        }
        startLocal(call)
    }

    @PermissionCallback
    private fun startAfterPermission(call: PluginCall) {
        startLocal(call)
    }

    private fun startLocal(call: PluginCall) {
        val once = Once(call)
        io.execute {
            try {
                runLocal()
                once.resolve(localInfo())
            } catch (e: UserError) {
                once.reject(e.message ?: START_FAILED)
            } catch (_: Exception) {
                once.reject(START_FAILED)
            }
        }
    }

    @PluginMethod
    fun stopLocalServer(call: PluginCall) {
        val once = Once(call)
        io.execute {
            try {
                stopLocal()
                once.resolve()
            } catch (_: Exception) {
                once.reject(I18n.s("plugin.stopFailed"))
            }
        }
    }

    @PluginMethod
    fun localServerCache(call: PluginCall) {
        val once = Once(call)
        io.execute {
            try {
                once.resolve(JSObject().put("usedBytes", LocalTorrServer.dirSize(LocalTorrServer.cacheDir(context))))
            } catch (_: Exception) {
                once.reject(I18n.s("plugin.cacheSizeFailed"))
            }
        }
    }

    @PluginMethod
    fun clearLocalServerCache(call: PluginCall) {
        val once = Once(call)
        io.execute {
            try {
                val wasRunning = LocalTorrServer.running
                if (wasRunning) stopLocal()
                LocalTorrServer.clearDir(LocalTorrServer.cacheDir(context))
                if (wasRunning) runLocal()
                once.resolve(JSObject().put("usedBytes", LocalTorrServer.dirSize(LocalTorrServer.cacheDir(context))))
            } catch (e: UserError) {
                once.reject(e.message ?: I18n.s("plugin.cacheClearFailed"))
            } catch (_: Exception) {
                once.reject(I18n.s("plugin.cacheClearFailed"))
            }
        }
    }

    @PluginMethod
    fun localIpv4(call: PluginCall) {
        call.resolve(JSObject().put("ip", LocalTorrServer.wifiIpv4(context) ?: JSONObject.NULL))
    }

    private fun localInfo(): JSObject {
        val o = JSObject()
        val supported = LocalTorrServer.supported()
        o.put("supported", supported)
        if (supported) {
            try {
                val install = LocalTorrServer.installation(context)
                o.put("binary", install.state().id)
                o.put("downloadBytes", install.pin.size)
                o.put("pinVersion", install.pin.tag)
                if (LocalTorrServer.downloading()) {
                    o.put("downloading", true)
                    LocalTorrServer.downloadPercent?.let { o.put("downloadPercent", it) }
                }
                o.put("mobileData", LocalTorrServer.onMobileData(context))
            } catch (_: Exception) {
                o.put("binary", BinaryState.MISSING.id)
            }
        }
        val running = LocalTorrServer.running
        o.put("running", running)
        if (running) {
            val v = LocalTorrServer.version ?: LocalTorrServer.echo(500)?.also { LocalTorrServer.version = it }
            if (v != null) o.put("version", v)
        }
        LocalTorrServer.wifiIpv4(context)?.let { o.put("ip", it) }
        o.put("vpn", LocalTorrServer.vpnActive(context))
        LocalTorrServer.error?.let { o.put("error", it) }
        return o
    }

    /** Starts the service and waits for `/echo` (300 ms steps, 15 s); configures the cache once. Blocking. */
    private fun runLocal() {
        val failures = LocalTorrServer.failures
        try {
            TorrServerService.start(context)
        } catch (_: RuntimeException) {
            throw UserError(START_FAILED)
        }
        val deadline = System.currentTimeMillis() + 15_000
        var version: String? = null
        while (System.currentTimeMillis() < deadline) {
            // only our own process counts (another app may hold the port)
            if (LocalTorrServer.running) {
                version = LocalTorrServer.echo(1000)
                if (version != null) break
            } else if (LocalTorrServer.failures != failures) {
                // the process gave up (port taken, crashed twice)
                throw UserError(LocalTorrServer.error ?: START_FAILED)
            }
            Thread.sleep(300)
        }
        if (version == null) {
            TorrServerService.stop(context)
            throw UserError(I18n.s("plugin.tsNoReply"))
        }
        LocalTorrServer.version = version
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (!prefs.getBoolean(CACHE_SET, false) && LocalTorrServer.configureCache(context)) {
            prefs.edit().putBoolean(CACHE_SET, true).apply()
        }
    }

    /** Stops the service and waits up to 6 s for the process to end. Blocking. */
    private fun stopLocal() {
        TorrServerService.stop(context)
        val deadline = System.currentTimeMillis() + 6_000
        while (LocalTorrServer.running && System.currentTimeMillis() < deadline) Thread.sleep(100)
    }

    // ---- search sources: site HTTP and encrypted secrets ----

    /**
     * { url, method?: GET|POST, headers?, form?, formCharset?, body?, timeoutMs?, cloudflare?, flaresolverr? } →
     * { status, url, text, cloudflare? }.
     * Cookies per site, body decoded by its charset. Values are never logged.
     */
    @PluginMethod
    fun http(call: PluginCall) {
        val once = Once(call)
        val spec = try {
            HttpSpec.parse(call.data)
        } catch (e: SiteHttpException) {
            return once.reject(e.reason)
        }
        io.execute {
            try {
                val r = sources.request(spec)
                once.resolve(JSObject.fromJSONObject(HttpSpec.reply(r)))
            } catch (e: SiteHttpException) {
                // a Cloudflare failure carries its kind as the code (the page offers the visible check for -interactive)
                if (e.code != null) once.reject(e.reason, e.code) else once.reject(e.reason)
            } catch (e: Exception) {
                once.reject(SiteHttp.NO_ANSWER)
            }
        }
    }

    /** Forgets the cookies of the site of { url } (logout). */
    @PluginMethod
    fun httpClearCookies(call: PluginCall) {
        val once = Once(call)
        val url = call.getString("url") ?: return once.reject(SiteHttp.BAD_URL)
        io.execute {
            try {
                sources.siteHttp.clearCookies(url)
                once.resolve()
            } catch (e: SiteHttpException) {
                once.reject(e.reason)
            } catch (e: Exception) {
                once.reject(SECRETS_FAILED)
            }
        }
    }

    @PluginMethod
    fun secretGet(call: PluginCall) {
        val once = Once(call)
        val key = secretKey(call) ?: return once.reject(SECRETS_FAILED)
        io.execute {
            try {
                once.resolve(JSObject().put("value", sources.secrets.get(key) ?: JSONObject.NULL))
            } catch (e: Exception) {
                // transient Keystore failure: the stored value is kept
                once.reject(SECRETS_FAILED)
            }
        }
    }

    @PluginMethod
    fun secretSet(call: PluginCall) {
        val once = Once(call)
        val key = secretKey(call) ?: return once.reject(SECRETS_FAILED)
        val value = call.getString("value") ?: return once.reject(SECRETS_FAILED)
        io.execute {
            try {
                sources.secrets.set(key, value)
                once.resolve()
            } catch (e: Exception) {
                once.reject(SECRETS_FAILED)
            }
        }
    }

    @PluginMethod
    fun secretDelete(call: PluginCall) {
        val once = Once(call)
        val key = secretKey(call) ?: return once.reject(SECRETS_FAILED)
        io.execute {
            try {
                sources.secrets.delete(key)
                once.resolve()
            } catch (e: Exception) {
                once.reject(SECRETS_FAILED)
            }
        }
    }

    /** JS keys live in their own namespace: page code cannot read the cookie entries. */
    private fun secretKey(call: PluginCall): String? = SourceServices.jsSecretKey(call.getString("key"))

    // ---- Cloudflare: the visible check, «Пройти на телефоне» ----

    private val cfOpen = AtomicBoolean(false)
    // the open visible check (cancelled when the plugin goes away, so the gate and the call are never held)
    @Volatile
    private var cfCheck: CheckControl? = null

    private fun cfText(call: PluginCall, key: String): String? =
        call.getString(key)?.filterNot { it.isISOControl() }?.take(400)?.ifEmpty { null }

    /**
     * The visible check ([VisibleCheck] + [CloudflareCheckDialog]): { url, site, mode: phone|tv, title, text, note?,
     * cancel, phone?, remote?, hint?, noPhone?, phoneClosed?, waiting?, gateWait?, errors?: { OUTCOME: text }, forTv?:
     * request id } → { result: solved|cancelled|busy|failed|done, sent?, via? }. With forTv the phone passes the TV's
     * waiting request (its own address, never the page's) and the cookies go only to that TV. Cookies never reach the page.
     */
    @PluginMethod
    fun cloudflareVisible(call: PluginCall) {
        val once = Once(call)
        val act = activity ?: return once.reject(CF_UNAVAILABLE)
        val forTv = call.getString("forTv")
        val watch = if (forTv != null && !TvMode.isTv(context)) cfWatch(context) else null
        val req = if (forTv != null) watch?.pending()?.takeIf { it.id == forTv } ?: return once.reject(CF_GONE) else null
        val url = req?.url ?: call.getString("url")
        val root = (url?.toHttpUrlOrNull() ?: return once.reject(SiteHttp.BAD_URL)).let { CloudflareSolver.siteRoot(it) }
        val site = CloudflareProtocol.cleanSite(call.getString("site")) ?: req?.site ?: root.host
        val tvMode = call.getString("mode") == "tv" && TvMode.isTv(context)
        val title = cfText(call, "title") ?: return once.reject(SiteHttp.BAD_REQUEST)
        val text = cfText(call, "text") ?: return once.reject(SiteHttp.BAD_REQUEST)
        val cancel = cfText(call, "cancel") ?: return once.reject(SiteHttp.BAD_REQUEST)
        val errors = HashMap<String, String>()
        call.getObject("errors")?.let { o ->
            for (k in CloudflareRelay.Outcome.values()) (o.opt(k.name) as? String)?.take(400)?.let { errors[k.name] = it }
        }
        val texts = CheckTexts(
            title, text, cfText(call, "note"), cancel, cfText(call, "phone"), cfText(call, "remote"), cfText(call, "hint"),
            cfText(call, "noPhone"), cfText(call, "phoneClosed"), cfText(call, "waiting"), cfText(call, "gateWait"), errors,
        )
        if (!cfOpen.compareAndSet(false, true)) return once.resolve(JSObject().put("result", "busy"))
        val relay = if (tvMode) remote?.cloudflare else null
        val target = if (watch != null && req != null) {
            CheckTarget.Tv { pairs, ua, until ->
                if (pairs == null) {
                    watch.answer(req.id, CloudflareProtocol.endedJson(req.id, cancelled = true))
                } else {
                    val body = CloudflareProtocol.solvedJson(req.id, root.host, pairs, ua, until)
                        ?: CloudflareProtocol.endedJson(req.id, cancelled = false)
                    watch.answer(req.id, body)
                }
            }
        } else {
            CheckTarget.Local { pairs, until -> sources.importClearance(root, pairs, null, until) }
        }
        act.runOnUiThread {
            try {
                val dialog = CloudflareCheckDialog(act, tvMode, texts, phoneButton = relay != null)
                val check = VisibleCheck(
                    // a host with a browser session passes with that session's User-Agent (the clearance must match it)
                    root, site, texts, { WebViewCloudflareBrowser(act, visible = true) }, MainScheduler(), { sources.baseAgentFor(root.host) },
                    System::currentTimeMillis, { io.execute(it) }, target, relay,
                    { r ->
                        cfCheck = null
                        cfOpen.set(false)
                        val o = JSObject().put("result", r.result)
                        r.sent?.let { o.put("sent", it) }
                        r.via?.let { o.put("via", it) }
                        once.resolve(o)
                    },
                )
                cfCheck = check
                dialog.show(check)
            } catch (e: Exception) {
                val c = cfCheck
                cfCheck = null
                c?.cancel()
                cfOpen.set(false)
                once.resolve(JSObject().put("result", "failed"))
            }
        }
    }

    // ---- «Войти через браузер» (Task 9b) ----

    private fun loginCheck(o: JSONObject?): SiteSession.Check? {
        if (o == null) return null
        val names = ArrayList<String>()
        (o.opt("cookies") as? org.json.JSONArray)?.let { a -> for (i in 0 until a.length()) (a.opt(i) as? String)?.let { names.add(it) } }
        return SiteSession.check(o.opt("path") as? String, o.opt("marker") as? String, o.opt("loginPath") as? String, names)
    }

    private fun loginHosts(call: PluginCall): List<String> {
        val raw = ArrayList<String>()
        call.getArray("hosts")?.let { a -> for (i in 0 until a.length()) (a.opt(i) as? String)?.let { raw.add(it) } }
        return SiteSession.hosts(raw)
    }

    /**
     * The browser login ([BrowserLogin] on [CloudflareCheckDialog]): { url: the login page, site, source, hosts: [the
     * site's hosts], check: { path, marker, loginPath, cookies? }, mode: phone|tv, title, text, note?, cancel, phone?,
     * remote?, hint?, noPhone?, phoneClosed?, waiting?, gateWait?, errors?: { OUTCOME|UNVERIFIED: text }, forTv?: request
     * id } → { result: ok|cancelled|busy|failed|done, host?, via?, sent? }. The page stays on the site's hosts (and the
     * captcha pages); a verified session goes into the jar (or, forTv, straight to the TV that asked). Cookies never
     * reach the page.
     */
    @PluginMethod
    fun siteBrowserLogin(call: PluginCall) {
        val once = Once(call)
        val act = activity ?: return once.reject(CF_UNAVAILABLE)
        val forTv = call.getString("forTv")
        val watch = if (forTv != null && !TvMode.isTv(context)) cfWatch(context) else null
        val req = if (forTv != null) {
            watch?.pending()?.takeIf { it.id == forTv && it.kind == CloudflareProtocol.KIND_LOGIN } ?: return once.reject(CF_GONE)
        } else null
        val hosts = loginHosts(call)
        val check = loginCheck(call.getObject("check")) ?: return once.reject(SiteHttp.BAD_REQUEST)
        // the TV's request names only the site root; the page's own login page on it otherwise
        val start = (if (req != null) req.url.toHttpUrlOrNull()?.resolve(check.loginPath) else call.getString("url")?.toHttpUrlOrNull())
            ?: return once.reject(SiteHttp.BAD_URL)
        if (hosts.isEmpty() || !SiteSession.onSite(start.host, hosts)) return once.reject(SiteHttp.BAD_URL)
        val source = (call.getString("source") ?: req?.source)?.takeIf { Regex("^[a-z0-9][a-z0-9-]{0,39}$").matches(it) }
            ?: return once.reject(SiteHttp.BAD_REQUEST)
        val site = CloudflareProtocol.cleanSite(call.getString("site")) ?: req?.site ?: start.host
        val tvMode = call.getString("mode") == "tv" && TvMode.isTv(context)
        val title = cfText(call, "title") ?: return once.reject(SiteHttp.BAD_REQUEST)
        val text = cfText(call, "text") ?: return once.reject(SiteHttp.BAD_REQUEST)
        val cancel = cfText(call, "cancel") ?: return once.reject(SiteHttp.BAD_REQUEST)
        val errors = HashMap<String, String>()
        call.getObject("errors")?.let { o ->
            for (k in CloudflareRelay.Outcome.values().map { it.name } + BrowserLogin.UNVERIFIED) (o.opt(k) as? String)?.take(400)?.let { errors[k] = it }
        }
        val texts = CheckTexts(
            title, text, cfText(call, "note"), cancel, cfText(call, "phone"), cfText(call, "remote"), cfText(call, "hint"),
            cfText(call, "noPhone"), cfText(call, "phoneClosed"), cfText(call, "waiting"), cfText(call, "gateWait"), errors,
            cfText(call, "blocked"), cfText(call, "checking"), cfText(call, "notConfirmed"), cfText(call, "retry"),
        )
        if (!cfOpen.compareAndSet(false, true)) return once.resolve(JSObject().put("result", "busy"))
        val relay = if (tvMode) remote?.cloudflare else null
        val target = if (watch != null && req != null) {
            LoginTarget.Tv { host, pairs, ua ->
                val body = if (pairs == null || host == null) {
                    CloudflareProtocol.endedJson(req.id, cancelled = true)
                } else {
                    CloudflareProtocol.sessionJson(req.id, host, pairs, ua, System.currentTimeMillis() + SiteSession.SESSION_TTL_MS)
                        ?: CloudflareProtocol.endedJson(req.id, cancelled = false)
                }
                watch.answer(req.id, body)
            }
        } else {
            LoginTarget.Local { root, pairs, ua -> sources.importSession(root, pairs, ua) }
        }
        act.runOnUiThread {
            try {
                val dialog = CloudflareCheckDialog(act, tvMode, texts, phoneButton = relay != null)
                val login = BrowserLogin(
                    start, hosts, check, site, source, texts,
                    {
                        WebViewCloudflareBrowser(
                            act, visible = true,
                            navigation = { h, p -> LoginNavigation.allowed(hosts, h, p) },
                            ads = { h, p -> LoginNavigation.ad(hosts, h, p) },
                        )
                    },
                    MainScheduler(), sources::userAgent, { io.execute(it) },
                    { root, pairs, ua -> sources.verifySession(root, pairs, ua, check) },
                    target, relay,
                    done = { r ->
                        cfCheck = null
                        cfOpen.set(false)
                        val o = JSObject().put("result", r.result)
                        r.sent?.let { o.put("sent", it) }
                        r.via?.let { o.put("via", it) }
                        r.host?.let { o.put("host", it) }
                        once.resolve(o)
                    },
                    askPhoneFirst = relay != null && call.getBoolean("askPhone") == true,
                )
                cfCheck = login
                dialog.show(login)
            } catch (e: Exception) {
                val c = cfCheck
                cfCheck = null
                c?.cancel()
                cfOpen.set(false)
                once.resolve(JSObject().put("result", "failed"))
            }
        }
    }

    /**
     * Android TV: { site, check } → { ok, host? }: the browser session the phone sent for [site] (staged, not live yet)
     * opens the check page as a signed-in one. Nothing is stored here: the answer of the transfer promotes or drops it.
     */
    @PluginMethod
    fun siteSessionPending(call: PluginCall) {
        val once = Once(call)
        val r = remote ?: return once.reject(I18n.s("plugin.remoteUnavailable"))
        val site = call.getString("site") ?: return once.reject(SiteHttp.BAD_REQUEST)
        val check = loginCheck(call.getObject("check")) ?: return once.reject(SiteHttp.BAD_REQUEST)
        io.execute {
            val s = try {
                r.sessions.staged(site)
            } catch (e: Exception) {
                null
            }
            if (s == null) return@execute once.resolve(JSObject().put("ok", false))
            val root = okhttp3.HttpUrl.Builder().scheme("https").host(s.host).build()
            val ok = try {
                sources.verifySession(root, s.cookies, s.ua ?: sources.userAgent(), check)
            } catch (e: Exception) {
                false
            }
            once.resolve(JSObject().put("ok", ok).put("host", s.host))
        }
    }

    /**
     * Phone: the Android TV this phone is paired with ({ url: http://ip:port, token }, or {} when none). The page tells it
     * whenever the paired TV changes; [siteSessionSend] sends session cookies only there.
     */
    @PluginMethod
    fun pairedTv(call: PluginCall) {
        if (TvMode.isTv(context)) return call.resolve()
        val url = call.getString("url")
        val token = call.getString("token")
        if (url == null || token == null) {
            paired = null
            return call.resolve()
        }
        if (!CF_BASE.matches(url) || !CF_TOKEN.matches(token)) return call.reject(SiteHttp.BAD_REQUEST)
        paired = url to token
        call.resolve()
    }

    /**
     * Phone, «Передать вход на телевизор» of a browser session: { payload: the transfer body, sessions: { siteId: [the
     * site's hosts, active first] } } → { status, data, missing: [siteId] }. The target is the paired TV registered
     * natively ([pairedTv]), never an address from this call; each site's hosts are limited to its own
     * ([SourcesProtocol.SESSION_HOSTS]). The cookies of each site's session (one host, capped) and the User-Agent they go
     * with are added here, so they never pass through the page; the answer has no cookie in it. Never logged.
     */
    @PluginMethod
    fun siteSessionSend(call: PluginCall) {
        val once = Once(call)
        if (TvMode.isTv(context)) return once.reject(SiteHttp.BAD_REQUEST)
        val (url, token) = paired ?: return once.reject(NOT_PAIRED)
        val payload = call.getObject("payload") ?: return once.reject(SiteHttp.BAD_REQUEST)
        val wanted = call.getObject("sessions") ?: return once.reject(SiteHttp.BAD_REQUEST)
        val timeout = (call.getInt("timeoutMs") ?: 45_000).coerceIn(5_000, 60_000)
        io.execute {
            try {
                val sessions = JSONObject()
                val missing = org.json.JSONArray()
                val ids = wanted.keys()
                while (ids.hasNext()) {
                    val id = ids.next()
                    val raw = ArrayList<String>()
                    (wanted.opt(id) as? org.json.JSONArray)?.let { a -> for (i in 0 until a.length()) (a.opt(i) as? String)?.let { raw.add(it) } }
                    var found: JSONObject? = null
                    val allowed = SourcesProtocol.SESSION_HOSTS[id].orEmpty()
                    for (h in SiteSession.hosts(raw).filter { it in allowed }) {
                        val root = okhttp3.HttpUrl.Builder().scheme("https").host(h).build()
                        val pairs = sources.sessionCookies(root)
                        if (pairs.none { !com.spacesarmat.omp.sources.CloudflareCookies.isCloudflare(it.first) }) continue
                        val arr = org.json.JSONArray()
                        for ((n, v) in pairs) arr.put(JSONObject().put("name", n).put("value", v))
                        found = JSONObject().put("host", h).put("cookies", arr).put("ua", sources.agentFor(h))
                        break
                    }
                    if (found != null) sessions.put(id, found) else missing.put(id)
                }
                val body = JSONObject(payload.toString())
                if (sessions.length() > 0) body.put("sessions", sessions)
                val (status, text) = HttpWatchTransport().post("$url/omp/sources", token, body.toString(), timeout)
                val data = try {
                    JSONObject(text)
                } catch (e: Exception) {
                    JSONObject()
                }
                once.resolve(JSObject().put("status", status).put("data", data).put("missing", missing))
            } catch (e: Exception) {
                once.reject(TV_NO_ANSWER)
            }
        }
    }

    /** Phone: the page refused the TV's request (not a site it knows with the switch on): the TV hears «failed». */
    @PluginMethod
    fun cloudflareDecline(call: PluginCall) {
        val id = call.getString("id")
        if (TvMode.isTv(context) || !CloudflareProtocol.validId(id)) return call.resolve()
        val w = cfWatch(context)
        io.execute { w.answer(id!!, CloudflareProtocol.endedJson(id, cancelled = false)) }
        call.resolve()
    }

    /** { url } → { until: epoch ms | null }: when the stored Cloudflare clearance of the site ends. */
    @PluginMethod
    fun cloudflareClearance(call: PluginCall) {
        val once = Once(call)
        val url = call.getString("url")?.toHttpUrlOrNull() ?: return once.reject(SiteHttp.BAD_URL)
        io.execute {
            try {
                once.resolve(JSObject().put("until", sources.clearanceUntil(url) ?: JSONObject.NULL))
            } catch (e: Exception) {
                once.reject(SECRETS_FAILED)
            }
        }
    }

    /**
     * Phone: poll the paired Android TV for «Пройти на телефоне» ({ url: http://ip:port, token, notify: text with %s })
     * or stop ({}). A request comes as the event cloudflareRequest { id, site, url } with the app open, else as a
     * notification (cloudflarePending gives it to the page later).
     */
    @PluginMethod
    fun cloudflareWatch(call: PluginCall) {
        if (TvMode.isTv(context)) return call.resolve()
        val url = call.getString("url")
        val token = call.getString("token")
        cfText(call, "notify")?.let { cfNotify = it }
        cfText(call, "notifyLogin")?.let { cfNotifyLogin = it }
        val w = cfWatch(context)
        if (url == null || token == null) {
            w.configure(null, null)
            return call.resolve()
        }
        if (!CF_BASE.matches(url) || !CF_TOKEN.matches(token)) return call.reject(SiteHttp.BAD_REQUEST)
        w.configure(url, token)
        w.start()
        call.resolve()
    }

    /** { request: { id, site, url } | null }: the TV's check still waiting for the person. */
    @PluginMethod
    fun cloudflarePending(call: PluginCall) {
        val r = if (TvMode.isTv(context)) null else cfWatch(context).pending()
        call.resolve(JSObject.fromJSONObject(CloudflareProtocol.requestJson(r)))
    }

    private fun emitCloudflare(r: CloudflareProtocol.Request): Boolean {
        if (!hasListeners("cloudflareRequest")) return false
        val o = JSObject().put("id", r.id).put("site", r.site).put("url", r.url)
        if (r.kind == CloudflareProtocol.KIND_LOGIN) o.put("kind", r.kind).put("source", r.source)
        notifyListeners("cloudflareRequest", o)
        return true
    }

    // ---- monitoring (WorkManager, notifications); phone only ----

    /** { enabled, hours: 1|3|6|12, wifiOnly }: schedules or cancels the periodic background check. */
    @PluginMethod
    fun monitorSchedule(call: PluginCall) {
        if (TvMode.isTv(context)) return call.reject(MONITOR_PHONE_ONLY)
        val s = MonitorPlan.schedule(call.getBoolean("enabled"), call.getInt("hours"), call.getBoolean("wifiOnly"))
        val once = Once(call)
        io.execute {
            try {
                MonitorScheduler.apply(context, s)
                // the channels show up in the system settings as soon as monitoring is on
                if (s.enabled) MonitorNotifier.ensureChannels(context)
                once.resolve()
            } catch (e: Exception) {
                once.reject(MONITOR_FAILED)
            }
        }
    }

    /** «Проверить сейчас»: a one-time check. */
    @PluginMethod
    fun monitorRunNow(call: PluginCall) {
        if (TvMode.isTv(context)) return call.reject(MONITOR_PHONE_ONLY)
        val once = Once(call)
        io.execute {
            try {
                MonitorScheduler.runNow(context)
                once.resolve()
            } catch (e: Exception) {
                once.reject(MONITOR_FAILED)
            }
        }
    }

    /** { enabled, hours, wifiOnly, running, lastRun?, lastSummary? (JSON string), lastError?, nextRun? }. */
    @PluginMethod
    fun monitorStatus(call: PluginCall) {
        val once = Once(call)
        io.execute {
            try {
                once.resolve(JSObject.fromJSONObject(MonitorScheduler.status(context)))
            } catch (e: Exception) {
                once.reject(MONITOR_FAILED)
            }
        }
    }

    /** { state: granted | denied | prompt } of the notifications (POST_NOTIFICATIONS on Android 13+). */
    @PluginMethod
    fun monitorNotifyPermission(call: PluginCall) {
        call.resolve(JSObject().put("state", notifyState()))
    }

    /** Asks for POST_NOTIFICATIONS when it can still be asked; resolves with the new { state }. */
    @PluginMethod
    fun requestMonitorNotifyPermission(call: PluginCall) {
        MonitorNotifier.ensureChannels(context)
        if (Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED) {
            return call.resolve(JSObject().put("state", notifyState()))
        }
        requestPermissionForAlias("notifications", call, "monitorPermissionDone")
    }

    @PermissionCallback
    private fun monitorPermissionDone(call: PluginCall) {
        call.resolve(JSObject().put("state", notifyState()))
    }

    private fun notifyState(): String {
        if (Build.VERSION.SDK_INT >= 33) {
            when (getPermissionState("notifications")) {
                PermissionState.GRANTED -> {}
                PermissionState.DENIED -> return "denied"
                else -> return "prompt"
            }
        }
        return if (MonitorNotifier.canNotify(context)) "granted" else "denied"
    }

    /** The link of a tapped monitoring notification not delivered yet ({ url: omp:news?... | null }). */
    @PluginMethod
    fun takeMonitorOpen(call: PluginCall) {
        val url = synchronized(magnetLock) {
            val u = pendingOpen
            pendingOpen = null
            u
        }
        call.resolve(JSObject().put("url", url ?: JSONObject.NULL))
    }

    private fun emitMonitorOpen(url: String) {
        if (hasListeners("monitorOpen")) {
            synchronized(magnetLock) { if (pendingOpen == url) pendingOpen = null }
            notifyListeners("monitorOpen", JSObject().put("url", url))
        }
    }

    // ---- magnet ----

    @PluginMethod
    fun takePendingMagnet(call: PluginCall) {
        val link = synchronized(magnetLock) {
            val l = pendingMagnet
            pendingMagnet = null
            l
        }
        call.resolve(JSObject().put("link", link ?: JSONObject.NULL))
    }

    private fun emitMagnet(link: String) {
        // delivered to a live listener: no longer pending
        if (hasListeners("magnetReceived")) {
            synchronized(magnetLock) { if (pendingMagnet == link) pendingMagnet = null }
            notifyListeners("magnetReceived", JSObject().put("link", link))
        }
    }

    /** Settles a PluginCall at most once, from any thread. */
    private class Once(private val call: PluginCall) {
        private val done = AtomicBoolean(false)
        fun resolve(data: JSObject? = null) {
            if (done.compareAndSet(false, true)) {
                if (data == null) call.resolve() else call.resolve(data)
            }
        }
        fun reject(message: String) {
            if (done.compareAndSet(false, true)) call.reject(message)
        }
        fun reject(message: String, code: String) {
            if (done.compareAndSet(false, true)) call.reject(message, code)
        }
    }

    companion object {
        private val NOT_SUPPORTED: String get() = I18n.s("plugin.notSupported")
        private val START_FAILED: String get() = I18n.s("ts.startFailed")
        private val NOT_DOWNLOADED: String get() = I18n.s("plugin.downloadFirst")
        private val SECRETS_FAILED: String get() = SourceServices.SECRETS_FAILED
        private const val PREFS = "omp-native"
        private const val RPC_START_WAIT_MS = 3_000L
        private const val CACHE_SET = "torrserverCacheConfigured"
        /** The page's UI language (ru | en) in [PREFS]. */
        const val LANG_KEY = "omp.lang"
        private val IPV4 = Regex("^((25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)\\.){3}(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)$")
        private val magnetLock = Any()
        private var pendingMagnet: String? = null
        // link of a tapped monitoring notification (omp:news?...), see takeMonitorOpen
        private var pendingOpen: String? = null
        private val MONITOR_PHONE_ONLY: String get() = I18n.s("plugin.monitorPhoneOnly")
        private val CF_UNAVAILABLE: String get() = I18n.s("plugin.cfUnavailable")
        private val CF_GONE: String get() = I18n.s("plugin.cfGone")
        private val TV_NO_ANSWER: String get() = I18n.s("plugin.tvNoAnswer")
        private val NOT_PAIRED: String get() = I18n.s("plugin.notPaired")
        /** The paired Android TV (base, token), set by the page through pairedTv. */
        @Volatile
        private var paired: Pair<String, String>? = null
        private val CF_BASE = Regex("^http://((25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)\\.){3}(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d):\\d{1,5}$")
        private val CF_TOKEN = Regex("^[0-9a-f]{32}$")
        private const val CF_CHANNEL = "omp-tv-requests"
        private const val CF_NOTIFICATION = 7101
        @Volatile
        private var cfNotify: String? = null
        @Volatile
        private var cfNotifyLogin: String? = null
        private var watch: CloudflareWatch? = null

        /** The phone's one watch of the paired TV (process-wide: it outlives a recreated plugin). */
        @Synchronized
        private fun cfWatch(ctx: Context): CloudflareWatch {
            watch?.let { return it }
            val app = ctx.applicationContext
            val w = CloudflareWatch(
                HttpWatchTransport(),
                { AppForeground.main },
                { onLan(app) },
                { r, fg -> (fg && instance?.emitCloudflare(r) == true) || notifyCloudflare(app, r.site, r.kind == CloudflareProtocol.KIND_LOGIN) },
            )
            watch = w
            // a sleeping watch looks again when the phone joins (or leaves) a network
            try {
                app.getSystemService(ConnectivityManager::class.java)?.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
                    override fun onAvailable(network: Network) = w.wake()
                    override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) = w.wake()
                    override fun onLost(network: Network) = w.wake()
                })
            } catch (e: RuntimeException) {
                // without the callback the watch still looks again when the app comes back
            }
            return w
        }

        /** The phone is on Wi-Fi or Ethernet (the TV is on the home network; never on mobile data). */
        private fun onLan(ctx: Context): Boolean = try {
            val cm = ctx.getSystemService(ConnectivityManager::class.java)
            val caps = cm?.getNetworkCapabilities(cm.activeNetwork)
            caps != null && (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) || caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET))
        } catch (e: RuntimeException) {
            false
        }

        /** MainActivity.onResume: the watch polls again (its background grace may have ended). */
        fun wakeCloudflare() {
            watch?.wake()
        }

        /** «Телевизор просит пройти проверку на …»; a tap opens OMP, which asks cloudflarePending. false = not shown. */
        private fun notifyCloudflare(ctx: Context, site: String, login: Boolean = false): Boolean {
            if (!MonitorNotifier.canNotify(ctx)) return false
            val nm = ctx.getSystemService(NotificationManager::class.java) ?: return false
            run { // same id again only renames the channel to the current language
                nm.createNotificationChannel(NotificationChannel(CF_CHANNEL, I18n.s("plugin.cfChannel"), NotificationManager.IMPORTANCE_HIGH))
            }
            if (nm.getNotificationChannel(CF_CHANNEL)?.importance == NotificationManager.IMPORTANCE_NONE) return false
            val open = PendingIntent.getActivity(
                ctx, CF_NOTIFICATION,
                Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            val text = (if (login) cfNotifyLogin ?: I18n.s("plugin.cfNotifyLogin") else cfNotify ?: I18n.s("plugin.cfNotify")).replace("%s", site)
            val n = NotificationCompat.Builder(ctx, CF_CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_monitor)
                .setContentTitle("OMP")
                .setContentText(text)
                .setContentIntent(open)
                .setAutoCancel(true)
                .setTimeoutAfter(CloudflareWatch.REQUEST_TTL_MS)
                .build()
            return try {
                NotificationManagerCompat.from(ctx).notify(CF_NOTIFICATION, n)
                true
            } catch (e: SecurityException) {
                false
            }
        }
        private val MONITOR_FAILED: String get() = I18n.s("plugin.monitorFailed")

        @Volatile
        private var instance: OmpNativePlugin? = null

        /** Called by MainActivity for a tapped monitoring notification (MonitorLinks): pending + event monitorOpen. */
        fun deliverMonitorOpen(url: String) {
            synchronized(magnetLock) { pendingOpen = url }
            instance?.emitMonitorOpen(url)
        }

        /** A background run finished: event monitorDone { summary: JSON string | absent } for an open app. */
        fun deliverMonitorDone(summary: JSONObject?) {
            val o = JSObject()
            if (summary != null) o.put("summary", summary.toString())
            instance?.notifyListeners("monitorDone", o)
        }

        /** Called by MainActivity for every incoming magnet: kept as pending and sent as an event. */
        fun deliverMagnet(link: String) {
            synchronized(magnetLock) { pendingMagnet = link }
            instance?.emitMagnet(link)
        }

        /** magnet link from VIEW magnet:… or SEND text/plain containing "magnet:?". */
        fun magnetFrom(intent: Intent?): String? {
            if (intent == null) return null
            return when (intent.action) {
                Intent.ACTION_VIEW -> {
                    val data = intent.data
                    if (data?.scheme.equals("magnet", ignoreCase = true)) intent.dataString else null
                }
                Intent.ACTION_SEND -> {
                    if (intent.type?.startsWith("text/plain") != true) return null
                    val text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString() ?: return null
                    val start = text.indexOf("magnet:?", ignoreCase = true)
                    if (start < 0) return null
                    val end = text.indexOfFirst(start) { it.isWhitespace() }
                    text.substring(start, end)
                }
                else -> null
            }
        }

        private inline fun String.indexOfFirst(from: Int, pred: (Char) -> Boolean): Int {
            for (i in from until length) if (pred(this[i])) return i
            return length
        }
    }
}

/** A safe file name for the share cache: no directories, only letters, digits and `.-_`; `.txt` when it has no extension. */
internal fun shareFileName(raw: String?): String {
    val cleaned = (raw ?: "").substringAfterLast('/').substringAfterLast('\\')
        .map { if (it.isLetterOrDigit() || it == '.' || it == '-' || it == '_') it else '_' }
        .joinToString("").trim('.', '_')
    val base = cleaned.take(100).trim('.', '_').ifEmpty { "omp-log.txt" }
    return if (base.contains('.')) base else "$base.txt"
}
