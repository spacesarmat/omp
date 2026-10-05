package com.spacesarmat.omp.install

import java.io.File
import java.util.Arrays

/** What the page asked for: method «lg-devmode» (passphrase, withHbc) or «atv-adb». */
class InstallRequest(val method: String, val ip: String, val passphrase: CharArray?, val withHbc: Boolean) {
    fun wipe() {
        passphrase?.let { Arrays.fill(it, '\u0000') }
    }

    companion object {
        const val LG = "lg-devmode"
        const val ATV = "atv-adb"
    }
}

/**
 * The result: OMP version installed; Homebrew Channel version, or the code why it was not installed (OMP is in
 * place anyway); Android TV facts read over adb.
 */
data class InstallOutcome(
    val version: String,
    val hbcVersion: String? = null,
    val hbcError: String? = null,
    val sdkInt: Int? = null,
    val abi: String? = null,
)

/**
 * One install from start to end: the right order of steps per method, downloads in [cacheDir] removed whatever
 * happens, native copies of key and passphrase wiped. Only GitHub ([Releases]) and the TV are contacted.
 *
 * LAN trust model (the home network is trusted, like ares-cli / webOS Dev Manager do):
 * - LG Key Server is plain HTTP by LG's design: anyone on the network who fetches the encrypted key while the Key
 *   Server is on can try to brute-force the 6-character passphrase offline. The result screen asks the user to turn
 *   the Key Server off after the install.
 * - SSH host keys are not checked (StrictHostKeyChecking=no): the TV's key changes whenever Developer Mode is
 *   re-enabled, so there is nothing to pin. A fake sshd learns nothing useful: publickey signatures are bound to its
 *   own session and cannot be replayed to the real TV; it could only receive the (public, verified) ipk.
 * - adb on 5555 is plain TCP (Android's design); the TV asks «Разрешить отладку?» for an unknown phone key.
 * - Downloads come only from allowlisted HTTPS GitHub hosts and are checked by sha256 and size before reaching the TV.
 */
class InstallRunner(
    private val releases: Releases,
    private val downloader: ReleaseDownloader,
    private val lg: LgDevModeInstaller,
    private val atv: AtvAdbInstaller,
) {
    fun run(req: InstallRequest, progress: ProgressSink, cancel: CancelToken): InstallOutcome {
        try {
            return when (req.method) {
                InstallRequest.LG -> runLg(req, progress, cancel)
                InstallRequest.ATV -> runAtv(req, progress, cancel)
                else -> throw InstallFailure(InstallCodes.BAD_TARGET)
            }
        } catch (e: Throwable) {
            throw failureOf(e, cancel)
        } finally {
            req.wipe()
        }
    }

    private fun download(pkg: ReleasePackage, cap: Long, progress: ProgressSink, cancel: CancelToken): File =
        downloader.fetch(
            pkg,
            cap,
            cancel,
            percent = { progress.report(Phase.DOWNLOAD, it, pkg.item, pkg.version) },
            verifying = { progress.report(Phase.VERIFY, null, pkg.item, pkg.version) },
        )

    private fun runLg(req: InstallRequest, progress: ProgressSink, cancel: CancelToken): InstallOutcome {
        val pass = req.passphrase ?: throw InstallFailure(InstallCodes.WRONG_PASSPHRASE)
        // the passphrase is checked against the key before anything is downloaded
        progress.report(Phase.CONNECT, null, Item.OMP, null)
        val files = ArrayList<File>()
        lg.unlock(req.ip, pass, cancel).use { creds ->
            req.wipe()
            try {
                progress.report(Phase.DOWNLOAD, null, Item.OMP, null)
                val omp = releases.ompWebos(cancel)
                val ompFile = download(omp, IPK_CAP, progress, cancel).also { files.add(it) }
                val packages = arrayListOf(TvPackage(omp, ompFile))
                var hbcError: String? = null
                var hbc: ReleasePackage? = null
                if (req.withHbc) {
                    try {
                        progress.report(Phase.DOWNLOAD, null, Item.HBC, null)
                        val p = releases.homebrewChannel(cancel)
                        val f = download(p, HBC_CAP, progress, cancel).also { files.add(it) }
                        packages.add(TvPackage(p, f))
                        hbc = p
                    } catch (e: Exception) {
                        val f = failureOf(e, cancel)
                        if (f.code == InstallCodes.CANCELLED) throw f
                        hbcError = f.code
                    }
                }
                cancel.check()
                val failed = lg.install(req.ip, creds, packages, progress, cancel)
                if (hbc != null && failed[Item.HBC] != null) {
                    hbcError = failed[Item.HBC]
                    hbc = null
                }
                return InstallOutcome(omp.version, hbcVersion = hbc?.version, hbcError = hbcError)
            } finally {
                for (f in files) f.delete()
            }
        }
    }

    private fun runAtv(req: InstallRequest, progress: ProgressSink, cancel: CancelToken): InstallOutcome {
        // connecting first: the «Разрешить отладку?» question comes before the long download
        val (device, info) = atv.connect(req.ip, progress, cancel)
        var file: File? = null
        device.use {
            try {
                progress.report(Phase.DOWNLOAD, null, Item.OMP, null)
                // the APK for the TV's ABI (arm64 / armv7 / universal), not the phone's
                val omp = releases.ompAndroid(cancel, info.abis)
                file = download(omp, APK_CAP, progress, cancel)
                atv.install(device, TvPackage(omp, file!!), progress, cancel)
                return InstallOutcome(omp.version, sdkInt = info.sdkInt, abi = info.abi)
            } finally {
                file?.delete()
            }
        }
    }

    companion object {
        const val IPK_CAP = 50L * 1024 * 1024
        const val HBC_CAP = 20L * 1024 * 1024
        const val APK_CAP = 300L * 1024 * 1024
    }
}
