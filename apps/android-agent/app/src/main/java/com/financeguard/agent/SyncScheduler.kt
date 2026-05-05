package com.financeguard.agent

import android.content.Context
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

object SyncScheduler {
    private const val PERIODIC_WORK_NAME = "financeguard_periodic_sync"

    fun schedulePeriodic(context: Context) {
        val request = PeriodicWorkRequestBuilder<DeviceSyncWorker>(15, TimeUnit.MINUTES)
            .build()

        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            PERIODIC_WORK_NAME,
            ExistingPeriodicWorkPolicy.UPDATE,
            request
        )
    }

    fun runImmediate(context: Context) {
        val request = OneTimeWorkRequestBuilder<DeviceSyncWorker>().build()
        WorkManager.getInstance(context).enqueue(request)
    }
}
