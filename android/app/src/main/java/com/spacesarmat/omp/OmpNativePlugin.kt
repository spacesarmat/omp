package com.spacesarmat.omp

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.content.pm.ActivityInfo
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
import com.spacesarmat.omp.box.BoxBridge
import com.spacesarmat.omp.box.BoxCodes
import com.spacesarmat.omp.box.BoxFailure
import com.spacesarmat.omp.box.BoxRemote
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
import com.spacesarmat.omp.player.Embedded2160
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
 * Every PluginCall is settled exactly once (see [CallOnce]). Blocking work runs on [io]; socket
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
    internal val io: ExecutorService = Executors.newCachedThreadPool()
    internal val lock = Any()

    internal var tv: TvSocket? = null
    internal var tvIp: String? = null
    internal var pendingConnect: CallOnce? = null
    internal var pointer: TvSocket? = null
    internal var pendingPointer: CallOnce? = null
    internal val downloading = AtomicBoolean(false)
    internal val installing = AtomicBoolean(false)
    @Volatile
    internal var installCancel: CancelToken? = null
    internal val player = PlayerServer { body -> notifyListeners("playerMessage", JSObject().put("body", body)) }
    // phone remote: only in TV mode
    internal var remote: TvRemote? = null
    // search sources: created on first use (Keystore access off the main thread)
    // one per process, shared with the background monitor page ([SourceServices])
    internal val sources by lazy { SourceServices.get(context) }
    internal val serverState = LocalTorrServer.Listener { running, error ->
        val o = JSObject().put("running", running)
        if (error != null) o.put("error", error)
        notifyListeners("localServerState", o)
    }

    internal val downloadProgress = LocalTorrServer.DownloadListener { phase, percent ->
        val o = JSObject().put("phase", phase)
        if (percent != null) o.put("percent", percent)
        notifyListeners("localServerDownload", o)
    }

    internal fun emit(event: String, data: JSObject) = notifyListeners(event, data)

    internal fun emit(event: String, data: JSObject, retain: Boolean) = notifyListeners(event, data, retain)

    internal fun listening(event: String) = hasListeners(event)

    internal fun launchForResult(call: PluginCall, intent: Intent, callbackName: String) =
        startActivityForResult(call, intent, callbackName)

    internal fun askPermission(alias: String, call: PluginCall, callbackName: String) =
        requestPermissionForAlias(alias, call, callbackName)

    internal val capBridge get() = bridge

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
        // closing a TLS socket writes to it: not on the main thread
        synchronized(lock) { boxRemote }?.let { b ->
            Thread {
                b.pairCancel()
                b.disconnect()
            }.start()
        }
        boxKeys.shutdownNow()
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

    /** { mode: portrait | unlock }: phone Activity orientation for «Сейчас играет»; no-op on TV. */
    @PluginMethod
    fun setOrientation(call: PluginCall) {
        if (TvMode.isTv(context)) {
            call.resolve()
            return
        }
        val mode = call.getString("mode") ?: "unlock"
        val orient = when (mode) {
            "portrait" -> ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
            else -> ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        }
        val act = activity
        if (act == null) {
            call.resolve()
            return
        }
        act.runOnUiThread {
            act.requestedOrientation = orient
            call.resolve()
        }
    }

    // ---- discovery ----

    @PluginMethod
    fun discoverTvs(call: PluginCall) = discoverTvsOp(call)

    /** NSD search for OMP on Android TV: { tvs: [{ ip, port, name, version }] }. */
    @PluginMethod
    fun discoverOmpTvs(call: PluginCall) = discoverOmpTvsOp(call)

    /** Install assistant: NSD search for Google Cast devices: { tvs: [{ ip, name, model? }] }. */
    @PluginMethod
    fun discoverCastTvs(call: PluginCall) = discoverCastTvsOp(call)

    /** { group }: stops only the NSD searches started with that group (the screen has gone); they return what they found. */
    @PluginMethod
    fun stopDiscovery(call: PluginCall) = stopDiscoveryOp(call)

    /** Install assistant: which of the install ports ([PortProbe.ALLOWED]) answer on a home-network IP: { open: [] }. */
    @PluginMethod
    fun probePorts(call: PluginCall) = probePortsOp(call)

    /**
     * «Источники поиска»: hosts of the device's /24 that answer on the Jackett / Prowlarr / FlareSolverr ports ([LanScan.ALLOWED]):
     * { hits: [{ ip, port }], lan }. Without a Wi-Fi IPv4 (mobile data) lan is false and nothing is scanned. Nothing is logged.
     */
    @PluginMethod
    fun scanLan(call: PluginCall) = scanLanOp(call)

    // ---- install assistant: install OMP on a TV ----

    /**
     * Installs OMP on an LG TV in Developer Mode ({ method: 'lg-devmode', ip, passphrase, withHbc }) or an Android TV
     * over adb ({ method: 'atv-adb', ip }). Progress: events installProgress { phase, percent?, item, version? }.
     * Resolves { version, hbcVersion?, hbcError?, sdkInt?, abi? }; rejects with an InstallCodes code as message and
     * code. One install at a time; nothing is logged (addresses, passphrase, key).
     */
    @PluginMethod
    fun installStart(call: PluginCall) = installStartOp(call)

    /** Stops the running install (downloads and temp files are removed). */
    @PluginMethod
    fun installCancel(call: PluginCall) = installCancelOp(call)

    // ---- phone remote: the whole Android TV box ([BoxRemote]) ----

    internal var boxRemote: BoxRemote? = null
    internal val box: BoxRemote get() = synchronized(lock) { boxRemote ?: makeBox().also { boxRemote = it } }

    // key presses go out in order on one thread; connecting and pairing never wait behind them
    internal val boxKeys: ExecutorService = Executors.newSingleThreadExecutor()

    /** { ip } → { google, adb, via? }: which box services answer, and the channel already up for this box. */
    @PluginMethod
    fun boxProbe(call: PluginCall) = boxProbeOp(call)

    /** { ip, via: google | adb } → { via }; adb may wait for «Разрешить отладку?» on the TV. */
    @PluginMethod
    fun boxConnect(call: PluginCall) = boxConnectOp(call)

    /** { ip }: the TV shows a pairing code. */
    @PluginMethod
    fun boxPairStart(call: PluginCall) = boxPairStartOp(call)

    /** { ip, code } → { via: google }: pairs and connects. */
    @PluginMethod
    fun boxPairFinish(call: PluginCall) = boxPairFinishOp(call)

    @PluginMethod
    fun boxPairCancel(call: PluginCall) = boxPairCancelOp(call)

    /** { code: Android KeyEvent code, long? } through the connected box channel. */
    @PluginMethod
    fun boxKey(call: PluginCall) = boxKeyOp(call)

    /** { text } → { typed }: typed into the box's focused field (adb only; false over the Google channel). */
    @PluginMethod
    fun boxText(call: PluginCall) = boxTextOp(call)

    @PluginMethod
    fun boxDisconnect(call: PluginCall) = boxDisconnectOp(call)

    /**
     * { tv, id?, name?, at: unix ms } schedules the Developer Mode reminder for that TV (tv = its address, id = a stable
     * TV id when known; both stored only as hashes, an older reminder of the same TV under either key is replaced);
     * { tv, id?, at: null } cancels it.
     */
    @PluginMethod
    fun devModeReminder(call: PluginCall) = devModeReminderOp(call)

    /** { tv, id? } → { at? }: when the reminder for that TV is due; absent when none is scheduled. */
    @PluginMethod
    fun devModeReminderState(call: PluginCall) = devModeReminderStateOp(call)

    /** Phone model for the TV's list of paired phones, e.g. «Google Pixel 7». */
    @PluginMethod
    fun phoneName(call: PluginCall) = phoneNameOp(call)

    // ---- TV search: the phone RPC server ([PhoneRpcService]) ----

    /**
     * Turns the TV search on (stores the switch, starts the foreground service) or off (stops it and deletes the
     * token, so TVs that knew the old address are revoked). Resolves like [rpcInfo].
     */
    @PluginMethod
    fun rpcSetEnabled(call: PluginCall) = rpcSetEnabledOp(call)

    /** `{enabled:false}` when the TV search is off; else the address the TVs use. Never logs the token. */
    @PluginMethod
    fun rpcInfo(call: PluginCall) = rpcInfoOp(call)

    // ---- main TV socket ----

    /** Hosts the page may reach over plain HTTP besides loopback and private ranges (a public TorrServer, an indexer). */
    @PluginMethod
    fun setCleartextHosts(call: PluginCall) {
        val arr = call.getArray("hosts")
        val hosts = ArrayList<String>()
        if (arr != null) {
            for (i in 0 until arr.length()) {
                val s = arr.optString(i, "").trim()
                if (s.isNotEmpty()) hosts.add(s)
            }
        }
        CleartextPolicy.setExtra(hosts)
        call.resolve()
    }

    /** The user confirmed a new TV certificate. [fingerprint] replaces the pin for [host]. */
    @PluginMethod
    fun trustTvCert(call: PluginCall) {
        val host = call.getString("host")?.trim().orEmpty()
        val fp = call.getString("fingerprint")?.trim().orEmpty()
        if (host.isEmpty()) {
            call.reject(I18n.s("plugin.badTvAddr2"))
            return
        }
        try {
            CertPins.trust(host, fp)
            call.resolve()
        } catch (_: IllegalArgumentException) {
            call.reject(I18n.s("plugin.badTvAddr2"))
        }
    }

    @PluginMethod
    fun tvConnect(call: PluginCall) = tvConnectOp(call)

    @PluginMethod
    fun tvSend(call: PluginCall) = tvSendOp(call)

    @PluginMethod
    fun tvDisconnect(call: PluginCall) = tvDisconnectOp(call)

    // ---- pointer socket ----

    @PluginMethod
    fun pointerConnect(call: PluginCall) = pointerConnectOp(call)

    @PluginMethod
    fun pointerSend(call: PluginCall) = pointerSendOp(call)

    // ---- player server (TV -> phone state, phone -> TV commands) ----

    @PluginMethod
    fun startPlayerServer(call: PluginCall) = startPlayerServerOp(call)

    @PluginMethod
    fun stopPlayerServer(call: PluginCall) = stopPlayerServerOp(call)

    @PluginMethod
    fun queuePlayerCommands(call: PluginCall) = queuePlayerCommandsOp(call)

    // ---- Wake-on-LAN ----

    @PluginMethod
    fun wakeOnLan(call: PluginCall) = wakeOnLanOp(call)

    // ---- external player ----

    /** Which 2160 Player package is installed, or null; embedded: this app carries 2160's screen (playEmbedded2160). */
    @PluginMethod
    fun player2160(call: PluginCall) = player2160Op(call)

    /**
     * Phone: plays the queue in 2160 Player's screen inside OMP (player-core's Player2160Activity, in-process) for
     * result; resolves like open2160 ({returned:false} if nothing came back). `background` = «Звук в фоне».
     */
    @PluginMethod
    fun playEmbedded2160(call: PluginCall) = playEmbedded2160Op(call)

    /** Opens 2160 Player on a playlist for result: resolves with where playback stopped ({returned:false} if nothing). */
    @PluginMethod
    fun open2160(call: PluginCall) = open2160Op(call)

    @ActivityCallback
    private fun on2160Result(call: PluginCall?, result: ActivityResult) = on2160ResultOp(call, result)

    @PluginMethod
    fun openExternal(call: PluginCall) = openExternalOp(call)

    /** Writes [text] to cache/logs/[name] and opens the system share sheet for it (FileProvider, text/plain).
     *  Older shared files are removed first (a settings copy holds secrets); [title] is the chooser title. */
    @Synchronized
    @PluginMethod
    fun shareText(call: PluginCall) = shareTextOp(call)

    // ---- native player (Android TV) ----

    /** Opens [PlayerActivity] with the queue (an open player takes the new queue over); resolves once launched. */
    @PluginMethod
    fun playNative(call: PluginCall) = playNativeOp(call)

    // ---- phone remote (Android TV) ----

    /** A new 6-digit pairing code (the previous one stops working): { code, expiresAt } (epoch ms). */
    @PluginMethod
    fun pairingCode(call: PluginCall) = pairingCodeOp(call)

    /** The pairing screen closed: the code shown there stops working. */
    @PluginMethod
    fun clearPairingCode(call: PluginCall) = clearPairingCodeOp(call)

    /**
     * Back from the phone remote that no screen took (the library root): the app closes, as the box remote's Back
     * does there (MainActivity.pageBack finishes when the page does not handle it).
     */
    @PluginMethod
    fun appBack(call: PluginCall) = appBackOp(call)

    /** The TV name the phone sees (the registered NSD name): { name }. */
    @PluginMethod
    fun tvName(call: PluginCall) = tvNameOp(call)

    /** «Передать на телевизор»: the page applied remoteSources { id } (rutracker = login result) or { failed }. */
    @PluginMethod
    fun remoteSourcesDone(call: PluginCall) = remoteSourcesDoneOp(call)

    /**
     * The transfer still waiting for the page ({ event: remoteSources data } or { event: null }): the event is not
     * retained, so a page that starts listening late asks for the one current transfer, never an old backlog.
     */
    @PluginMethod
    fun remoteSourcesPending(call: PluginCall) = remoteSourcesPendingOp(call)

    /** A phone command for the open native player ({ cmd: Cmd }). */
    @PluginMethod
    fun nativePlayerCommand(call: PluginCall) = nativePlayerCommandOp(call)

    // ---- APK update ----

    /** Whether libVLC runs on this device (its native libraries are present and load): { available }. */
    @PluginMethod
    fun vlcAvailable(call: PluginCall) = vlcAvailableOp(call)

    /** Feed key of this device's APK («arm64» / «armv7»; "" = universal), the same rule as downloadAndInstallApk. */
    @PluginMethod
    fun deviceAbiKey(call: PluginCall) = deviceAbiKeyOp(call)

    @PluginMethod
    fun downloadAndInstallApk(call: PluginCall) = downloadAndInstallApkOp(call)

    /** An install waiting for the «unknown apps» permission (main thread only). */
    internal var permissionWait: InstallPermissionWait<ApkJob>? = null

    @PluginMethod
    fun canInstallApks(call: PluginCall) = canInstallApksOp(call)

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

    // ---- embedded TorrServer ----

    @PluginMethod
    fun localServerInfo(call: PluginCall) = localServerInfoOp(call)

    /**
     * Downloads the pinned TorrServer binary (GitHub release asset, sha256 + size checked). Progress: events
     * localServerDownload { phase: 'download', percent } then { phase: 'verify' }. A call while a download runs joins
     * it (no second download). Resolves the server info; rejects with Russian text (next step included) and the
     * InstallCodes code.
     */
    @PluginMethod
    fun downloadLocalServer(call: PluginCall) = downloadLocalServerOp(call)

    @PluginMethod
    fun cancelLocalServerDownload(call: PluginCall) = cancelLocalServerDownloadOp(call)

    @PluginMethod
    fun startLocalServer(call: PluginCall) = startLocalServerOp(call)

    @PermissionCallback
    private fun startAfterPermission(call: PluginCall) = startAfterPermissionOp(call)

    @PluginMethod
    fun stopLocalServer(call: PluginCall) = stopLocalServerOp(call)

    @PluginMethod
    fun localServerCache(call: PluginCall) = localServerCacheOp(call)

    @PluginMethod
    fun clearLocalServerCache(call: PluginCall) = clearLocalServerCacheOp(call)

    @PluginMethod
    fun localIpv4(call: PluginCall) = localIpv4Op(call)

    /**
     * { active }: OMP's own traffic goes through a VPN (the active network has TRANSPORT_VPN). An app excluded from the
     * VPN sees its Wi-Fi/Ethernet here. Always-on / lockdown is not readable by apps, so it is never reported.
     */
    @PluginMethod
    fun vpnState(call: PluginCall) = vpnStateOp(call)

    // ---- search sources: site HTTP and encrypted secrets ----

    /**
     * { url, method?: GET|POST, headers?, form?, formCharset?, body?, timeoutMs?, cloudflare?, flaresolverr? } →
     * { status, url, text, cloudflare? }.
     * Cookies per site, body decoded by its charset. Values are never logged.
     */
    @PluginMethod
    fun http(call: PluginCall) = httpOp(call)

    /** Forgets the cookies of the site of { url } (logout). */
    @PluginMethod
    fun httpClearCookies(call: PluginCall) = httpClearCookiesOp(call)

    @PluginMethod
    fun secretGet(call: PluginCall) = secretGetOp(call)

    @PluginMethod
    fun secretSet(call: PluginCall) = secretSetOp(call)

    @PluginMethod
    fun secretDelete(call: PluginCall) = secretDeleteOp(call)

    // ---- Cloudflare: the visible check, «Пройти на телефоне» ----

    internal val cfOpen = AtomicBoolean(false)
    // the open visible check (cancelled when the plugin goes away, so the gate and the call are never held)
    @Volatile
    internal var cfCheck: CheckControl? = null

    /**
     * The visible check ([VisibleCheck] + [CloudflareCheckDialog]): { url, site, mode: phone|tv, title, text, note?,
     * cancel, phone?, remote?, hint?, noPhone?, phoneClosed?, waiting?, gateWait?, errors?: { OUTCOME: text }, forTv?:
     * request id } → { result: solved|cancelled|busy|failed|done, sent?, via? }. With forTv the phone passes the TV's
     * waiting request (its own address, never the page's) and the cookies go only to that TV. Cookies never reach the page.
     */
    @PluginMethod
    fun cloudflareVisible(call: PluginCall) = cloudflareVisibleOp(call)

    // ---- «Войти через браузер» (Task 9b) ----

    /**
     * The browser login ([BrowserLogin] on [CloudflareCheckDialog]): { url: the login page, site, source, hosts: [the
     * site's hosts], check: { path, marker, loginPath, cookies? }, mode: phone|tv, title, text, note?, cancel, phone?,
     * remote?, hint?, noPhone?, phoneClosed?, waiting?, gateWait?, errors?: { OUTCOME|UNVERIFIED: text }, forTv?: request
     * id } → { result: ok|cancelled|busy|failed|done, host?, via?, sent? }. The page stays on the site's hosts (and the
     * captcha pages); a verified session goes into the jar (or, forTv, straight to the TV that asked). Cookies never
     * reach the page.
     */
    @PluginMethod
    fun siteBrowserLogin(call: PluginCall) = siteBrowserLoginOp(call)

    /**
     * Android TV: { site, check } → { ok, host? }: the browser session the phone sent for [site] (staged, not live yet)
     * opens the check page as a signed-in one. Nothing is stored here: the answer of the transfer promotes or drops it.
     */
    @PluginMethod
    fun siteSessionPending(call: PluginCall) = siteSessionPendingOp(call)

    /**
     * Phone: the Android TV this phone is paired with ({ url: http://ip:port, token }, or {} when none). The page tells it
     * whenever the paired TV changes; [siteSessionSend] sends session cookies only there.
     */
    @PluginMethod
    fun pairedTv(call: PluginCall) = pairedTvOp(call)

    /**
     * Phone, «Передать вход на телевизор» of a browser session: { payload: the transfer body, sessions: { siteId: [the
     * site's hosts, active first] } } → { status, data, missing: [siteId] }. The target is the paired TV registered
     * natively ([pairedTv]), never an address from this call; each site's hosts are limited to its own
     * ([SourcesProtocol.SESSION_HOSTS]). The cookies of each site's session (one host, capped) and the User-Agent they go
     * with are added here, so they never pass through the page; the answer has no cookie in it. Never logged.
     */
    @PluginMethod
    fun siteSessionSend(call: PluginCall) = siteSessionSendOp(call)

    /** Phone: the page refused the TV's request (not a site it knows with the switch on): the TV hears «failed». */
    @PluginMethod
    fun cloudflareDecline(call: PluginCall) = cloudflareDeclineOp(call)

    /** { url } → { until: epoch ms | null }: when the stored Cloudflare clearance of the site ends. */
    @PluginMethod
    fun cloudflareClearance(call: PluginCall) = cloudflareClearanceOp(call)

    /**
     * Phone: poll the paired Android TV for «Пройти на телефоне» ({ url: http://ip:port, token, notify: text with %s })
     * or stop ({}). A request comes as the event cloudflareRequest { id, site, url } with the app open, else as a
     * notification (cloudflarePending gives it to the page later).
     */
    @PluginMethod
    fun cloudflareWatch(call: PluginCall) = cloudflareWatchOp(call)

    /** { request: { id, site, url } | null }: the TV's check still waiting for the person. */
    @PluginMethod
    fun cloudflarePending(call: PluginCall) = cloudflarePendingOp(call)

    // ---- monitoring (WorkManager, notifications); phone only ----

    /** { enabled, hours: 1|3|6|12, wifiOnly }: schedules or cancels the periodic background check. */
    @PluginMethod
    fun monitorSchedule(call: PluginCall) = monitorScheduleOp(call)

    /** «Проверить сейчас»: a one-time check. */
    @PluginMethod
    fun monitorRunNow(call: PluginCall) = monitorRunNowOp(call)

    /** { enabled, hours, wifiOnly, running, lastRun?, lastSummary? (JSON string), lastError?, nextRun? }. */
    @PluginMethod
    fun monitorStatus(call: PluginCall) = monitorStatusOp(call)

    /** { state: granted | denied | prompt } of the notifications (POST_NOTIFICATIONS on Android 13+). */
    @PluginMethod
    fun monitorNotifyPermission(call: PluginCall) = monitorNotifyPermissionOp(call)

    /** Asks for POST_NOTIFICATIONS when it can still be asked; resolves with the new { state }. */
    @PluginMethod
    fun requestMonitorNotifyPermission(call: PluginCall) = requestMonitorNotifyPermissionOp(call)

    @PermissionCallback
    private fun monitorPermissionDone(call: PluginCall) = monitorPermissionDoneOp(call)

    /** The link of a tapped monitoring notification not delivered yet ({ url: omp:news?... | null }). */
    @PluginMethod
    fun takeMonitorOpen(call: PluginCall) = takeMonitorOpenOp(call)

    // ---- magnet ----

    @PluginMethod
    fun takePendingMagnet(call: PluginCall) = takePendingMagnetOp(call)

    companion object {
        internal val NOT_SUPPORTED: String get() = I18n.s("plugin.notSupported")
        internal val START_FAILED: String get() = I18n.s("ts.startFailed")
        internal val NOT_DOWNLOADED: String get() = I18n.s("plugin.downloadFirst")
        internal val SECRETS_FAILED: String get() = SourceServices.SECRETS_FAILED
        internal const val PREFS = "omp-native"
        internal const val RPC_START_WAIT_MS = 3_000L
        internal const val CACHE_SET = "torrserverCacheConfigured"
        /** The page's UI language (ru | en) in [PREFS]. */
        const val LANG_KEY = "omp.lang"
        internal val IPV4 = Regex("^((25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)\\.){3}(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)$")
        internal val magnetLock = Any()
        internal var pendingMagnet: String? = null
        // link of a tapped monitoring notification (omp:news?...), see takeMonitorOpen
        internal var pendingOpen: String? = null
        internal val MONITOR_PHONE_ONLY: String get() = I18n.s("plugin.monitorPhoneOnly")
        internal val CF_UNAVAILABLE: String get() = I18n.s("plugin.cfUnavailable")
        internal val CF_GONE: String get() = I18n.s("plugin.cfGone")
        internal val TV_NO_ANSWER: String get() = I18n.s("plugin.tvNoAnswer")
        internal val NOT_PAIRED: String get() = I18n.s("plugin.notPaired")
        /** The paired Android TV (base, token), set by the page through pairedTv. */
        @Volatile
        internal var paired: Pair<String, String>? = null
        internal val CF_BASE = Regex("^http://((25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)\\.){3}(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d):\\d{1,5}$")
        internal val CF_TOKEN = Regex("^[0-9a-f]{32}$")
        internal const val CF_CHANNEL = "omp-tv-requests"
        internal const val CF_NOTIFICATION = 7101
        @Volatile
        internal var cfNotify: String? = null
        @Volatile
        internal var cfNotifyLogin: String? = null
        internal var watch: CloudflareWatch? = null

        /** The phone's one watch of the paired TV (process-wide: it outlives a recreated plugin). */
        @Synchronized
        internal fun cfWatch(ctx: Context): CloudflareWatch {
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
        internal fun onLan(ctx: Context): Boolean = try {
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
        internal fun notifyCloudflare(ctx: Context, site: String, login: Boolean = false): Boolean {
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
        internal val MONITOR_FAILED: String get() = I18n.s("plugin.monitorFailed")

        @Volatile
        internal var instance: OmpNativePlugin? = null

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

        internal inline fun String.indexOfFirst(from: Int, pred: (Char) -> Boolean): Int {
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
