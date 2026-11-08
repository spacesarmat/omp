package com.spacesarmat.omp

import android.app.Application
import android.app.NotificationManager
import android.content.Context
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.testing.TestListenableWorkerBuilder
import androidx.work.testing.WorkManagerTestInitHelper
import androidx.work.workDataOf
import com.spacesarmat.omp.boot.BootLaunch
import com.spacesarmat.omp.boot.BootLaunchPrefs
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/**
 * Android 10+ may drop a background activity start without throwing, so a startActivity that returned
 * proves nothing. The attempt is recorded with [BootLaunch.EXTRA_ATTEMPT] and re-checked by a WorkManager
 * worker: [BootLaunch.acknowledge] in MainActivity clears the block, a still-blocked attempt gets the
 * fallback notification.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [32])
class UpdateRelaunchTest {
    private lateinit var context: Application

    @Before
    fun setUp() {
        context = RuntimeEnvironment.getApplication()
        context.getSystemService(NotificationManager::class.java).cancelAll()
        context.getSharedPreferences(BootLaunchPrefs.PREFS, Context.MODE_PRIVATE).edit().clear().commit()
        WorkManagerTestInitHelper.initializeTestWorkManager(context)
    }

    @Test
    fun silentStartIsRecordedAndDeferredCheckScheduled() {
        UpdateRelaunch.open(context)

        // Robolectric records the start without throwing, like a silent drop on Android 10+
        val launch = shadowOf(context).nextStartedActivity
        assertNotNull(launch)
        assertEquals(MainActivity::class.java.name, launch.component?.className)

        val state = BootLaunchPrefs(context).state()
        assertTrue(state.attempt > 0L)
        assertTrue(state.blocked)
        assertEquals(state.attempt, launch.getLongExtra(BootLaunch.EXTRA_ATTEMPT, 0L))

        val infos = WorkManager.getInstance(context).getWorkInfosForUniqueWork(UpdateRelaunch.WORK).get(5, TimeUnit.SECONDS)
        assertEquals(1, infos.size)
        assertEquals(WorkInfo.State.ENQUEUED, infos.single().state)
    }

    @Test
    fun acknowledgedStartStaysSilent() {
        UpdateRelaunch.open(context)
        val launch = shadowOf(context).nextStartedActivity

        // MainActivity.onCreate/onNewIntent clear the block of exactly this attempt
        BootLaunch.acknowledge(context, launch)
        UpdateRelaunch.check(context, launch.getLongExtra(BootLaunch.EXTRA_ATTEMPT, 0L))

        val nm = shadowOf(context.getSystemService(NotificationManager::class.java))
        assertEquals(0, nm.allNotifications.size)
    }

    @Test
    fun stillBlockedStartNotifies() {
        UpdateRelaunch.open(context)
        val launch = shadowOf(context).nextStartedActivity

        // the deferred check finds the attempt never acknowledged
        UpdateRelaunch.check(context, launch.getLongExtra(BootLaunch.EXTRA_ATTEMPT, 0L))

        val nm = shadowOf(context.getSystemService(NotificationManager::class.java))
        assertEquals(1, nm.allNotifications.size)
        assertNotNull(nm.allNotifications.single().contentIntent)
    }

    @Test
    fun supersededAttemptDoesNotNotify() {
        UpdateRelaunch.open(context)
        val first = shadowOf(context).nextStartedActivity
        UpdateRelaunch.open(context)
        val second = shadowOf(context).nextStartedActivity

        // a second update replaced the work: only the newest attempt decides
        UpdateRelaunch.check(context, first.getLongExtra(BootLaunch.EXTRA_ATTEMPT, 0L))
        val nm = shadowOf(context.getSystemService(NotificationManager::class.java))
        assertEquals(0, nm.allNotifications.size)

        UpdateRelaunch.check(context, second.getLongExtra(BootLaunch.EXTRA_ATTEMPT, 0L))
        assertEquals(1, nm.allNotifications.size)
    }

    @Test
    fun workerRunsTheSameCheck() {
        UpdateRelaunch.open(context)
        val launch = shadowOf(context).nextStartedActivity
        val attempt = launch.getLongExtra(BootLaunch.EXTRA_ATTEMPT, 0L)

        val worker = TestListenableWorkerBuilder.from(context, UpdateRelaunchCheckWorker::class.java)
            .setInputData(workDataOf(UpdateRelaunch.KEY_ATTEMPT to attempt))
            .build()
        val result = worker.startWork().get(5, TimeUnit.SECONDS)
        assertEquals(androidx.work.ListenableWorker.Result.success(), result)

        val nm = shadowOf(context.getSystemService(NotificationManager::class.java))
        assertEquals(1, nm.allNotifications.size)
    }
}
