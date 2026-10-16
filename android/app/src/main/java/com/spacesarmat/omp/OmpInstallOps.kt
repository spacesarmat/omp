package com.spacesarmat.omp

import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall
import com.spacesarmat.omp.install.AdbIdentity
import com.spacesarmat.omp.install.AdbIdentityStore
import com.spacesarmat.omp.install.AesGcmWrapper
import com.spacesarmat.omp.install.AtvAdbInstaller
import com.spacesarmat.omp.install.CancelToken
import com.spacesarmat.omp.install.DadbConnector
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
import java.io.File

/** Install OMP on a TV. Bodies for [OmpNativePlugin]. */

internal fun OmpNativePlugin.installStartOp(call: PluginCall) {
    val once = CallOnce(call)
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
                emit("installProgress", o)
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
internal fun OmpNativePlugin.adbIdentities(): AdbIdentityStore {
    // earlier builds kept the key in plain text here, or briefly as temporary files while generating it
    File(context.filesDir, "adb").deleteRecursively()
    File(context.cacheDir, "adbtmp").deleteRecursively()
    return AdbIdentityStore(
        File(context.noBackupFilesDir, "adb/identity.enc"),
        AesGcmWrapper { AesGcmWrapper.keystoreKey("omp-adb-aes") },
    ) { AdbIdentity.generate() }
}

internal fun OmpNativePlugin.installCancelOp(call: PluginCall) {
    installCancel?.cancel()
    call.resolve()
}
