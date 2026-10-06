package com.spacesarmat.omp

/**
 * An APK install waiting for «Установка неизвестных приложений»: the system page opens, the app pauses; when it
 * comes back the install goes on if the permission was given, else it ends with «Разрешите установку…». A resume
 * without a pause first (the page did not open yet) changes nothing.
 */
class InstallPermissionWait<T>(val job: T) {
    private var paused = false

    enum class Next { WAIT, INSTALL, GIVE_UP }

    fun onPause() {
        paused = true
    }

    /** The app is back; [granted]: canRequestPackageInstalls() now. */
    fun onResume(granted: Boolean): Next = when {
        !paused -> Next.WAIT
        granted -> Next.INSTALL
        else -> Next.GIVE_UP
    }
}
