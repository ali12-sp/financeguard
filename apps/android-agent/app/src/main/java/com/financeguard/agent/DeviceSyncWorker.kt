package com.financeguard.agent

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters

class DeviceSyncWorker(
    appContext: Context,
    params: WorkerParameters
) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        return try {
            val api = AgentApi(applicationContext)
            if (!api.hasMinimumConfig()) {
                return Result.success()
            }

            val payload = api.syncDevice()
            CommandProcessor(applicationContext).applySyncPayload(payload)
            Result.success()
        } catch (e: Exception) {
            Result.retry()
        }
    }
}
