package com.spacesarmat.omp.box

import android.content.Context
import android.os.Build
import com.spacesarmat.omp.CertPins
import com.spacesarmat.omp.install.AdbIdentityStore
import com.spacesarmat.omp.install.AesGcmWrapper
import java.io.File
import javax.net.ssl.SSLSocketFactory

/**
 * Builds the phone's [BoxRemote]: the client certificate encrypted with a Keystore key in noBackupFilesDir
 * (box/identity.enc, not backed up or transferred), the adb identity shared with the install assistant.
 */
object BoxBridge {
    fun create(ctx: Context, phoneName: String, adbIdentities: AdbIdentityStore, events: BoxRemote.Events): BoxRemote {
        val app = ctx.applicationContext
        val store = BoxIdentityStore(
            File(app.noBackupFilesDir, "box/identity.enc"),
            AesGcmWrapper { AesGcmWrapper.keystoreKey("omp-box-aes") },
        )
        val pins = CertPins.box(app)
        var identity: BoxIdentity? = null
        val lock = Any()
        fun id(): BoxIdentity = synchronized(lock) { identity ?: store.load().also { identity = it } }
        fun sockets(ip: String): SSLSocketFactory = synchronized(lock) { id().socketFactory(pins, ip) }
        val version = try {
            app.packageManager.getPackageInfo(app.packageName, 0).versionName ?: "1"
        } catch (e: Exception) {
            "1"
        }
        return BoxRemote(
            dialer = SocketTlsDialer { ip -> sockets(ip) },
            clientKey = { id().publicKey },
            adb = DadbShellOpener(adbIdentities),
            device = BoxRemote.DeviceInfo(
                name = phoneName.ifBlank { "OMP" }.take(60),
                model = Build.MODEL.orEmpty().ifBlank { "Phone" },
                vendor = Build.MANUFACTURER.orEmpty().ifBlank { "Android" },
                appVersion = version,
            ),
            events = events,
        )
    }
}
