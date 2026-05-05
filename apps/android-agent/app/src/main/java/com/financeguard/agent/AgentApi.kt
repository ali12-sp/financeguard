package com.financeguard.agent

import android.content.Context
import android.os.Build
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

data class SyncPayload(
    val device: JSONObject?,
    val contract: JSONObject?,
    val pendingCommands: JSONArray
)

class AgentApi(
    private val context: Context
) {
    private val prefs = AgentPreferences.from(context)
    private val policyController = DevicePolicyController(context)
    private val client = OkHttpClient()
    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()

    fun hasMinimumConfig(): Boolean {
        val snapshot = prefs.snapshot()
        return snapshot.apiBaseUrl.isNotBlank() && snapshot.agentSecret.isNotBlank()
    }

    fun refreshPushToken() {
        if (!ensureFirebase()) return

        FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
            if (task.isSuccessful && !task.result.isNullOrBlank()) {
                prefs.updatePushToken(task.result)
                SyncScheduler.runImmediate(context)
            }
        }
    }

    fun registerDevice(): SyncPayload {
        val snapshot = prefs.snapshot()
        val uniqueId = policyController.stableDeviceId()
        prefs.updateIdentity(uniqueId, BuildConfig.VERSION_NAME)
        val pushToken = resolvePushToken()

        val payload = JSONObject().apply {
            put("agentSecret", snapshot.agentSecret)
            put("uniqueId", uniqueId)
            put("pushToken", pushToken ?: JSONObject.NULL)
            put("modelName", Build.MODEL ?: "Unknown model")
            put("serial", Build.DEVICE ?: "Unknown serial")
            put("imei", Build.DEVICE ?: "Unknown imei")
            put("osVersion", Build.VERSION.RELEASE ?: "Unknown")
            put("appVersion", BuildConfig.VERSION_NAME)
            put(
                "enrollmentMode",
                if (policyController.isDeviceOwner()) "QR" else "MANUAL"
            )
            put("deviceOwnerPackage", if (policyController.isDeviceOwner()) context.packageName else JSONObject.NULL)
        }

        val response = postJson("/api/agent/register", payload)
        return parseSyncPayload(response)
    }

    fun syncDevice(): SyncPayload {
        val snapshot = prefs.snapshot()
        val pushToken = resolvePushToken()
        val payload = JSONObject().apply {
            put("agentSecret", snapshot.agentSecret)
            put("uniqueId", snapshot.uniqueId.ifBlank { policyController.stableDeviceId() })
            put("pushToken", pushToken ?: JSONObject.NULL)
            put("osVersion", Build.VERSION.RELEASE ?: "Unknown")
            put("appVersion", BuildConfig.VERSION_NAME)
            put("currentState", snapshot.currentState.name)
            put("restrictionReason", snapshot.lockMessage.ifBlank { snapshot.lastReason })
        }

        val response = postJson("/api/agent/sync", payload)
        return parseSyncPayload(response)
    }

    fun acknowledgeCommand(commandId: String, success: Boolean, note: String?) {
        val payload = JSONObject().apply {
            put("agentSecret", prefs.snapshot().agentSecret)
            put("success", success)
            put("note", note ?: JSONObject.NULL)
        }

        postJson("/api/agent/commands/$commandId/ack", payload)
    }

    private fun parseSyncPayload(response: JSONObject): SyncPayload {
        val device = response.optJSONObject("device")
        val contract = response.optJSONObject("contract")
        val commands = response.optJSONArray("pendingCommands") ?: JSONArray()

        prefs.updateServerAssignment(
            customerName = response.optString("customerName", device?.optString("customerName", "") ?: ""),
            contractId = contract?.optString("id") ?: device?.optString("contractId"),
            deviceId = device?.optString("id"),
            lastSyncAt = device?.optString("lastSyncAt")
        )

        return SyncPayload(device = device, contract = contract, pendingCommands = commands)
    }

    private fun postJson(path: String, payload: JSONObject): JSONObject {
        val request = Request.Builder()
            .url("${prefs.snapshot().apiBaseUrl}$path")
            .post(payload.toString().toRequestBody(jsonMediaType))
            .build()

        client.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                throw IllegalStateException("API ${response.code}: $body")
            }
            return JSONObject(body)
        }
    }

    private fun resolvePushToken(timeoutSeconds: Long = 5): String? {
        val cachedToken = prefs.snapshot().pushToken.ifBlank { "" }
        if (cachedToken.isNotBlank()) {
            return cachedToken
        }

        if (!ensureFirebase()) {
            return null
        }

        val latch = CountDownLatch(1)
        var token: String? = null

        FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
            if (task.isSuccessful && !task.result.isNullOrBlank()) {
                token = task.result
                prefs.updatePushToken(task.result)
            }
            latch.countDown()
        }

        try {
            latch.await(timeoutSeconds, TimeUnit.SECONDS)
        } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
        }

        return token ?: prefs.snapshot().pushToken.ifBlank { null }
    }

    private fun ensureFirebase(): Boolean {
        return try {
            if (FirebaseApp.getApps(context).isEmpty()) {
                FirebaseApp.initializeApp(context) != null
            } else {
                true
            }
        } catch (_: Exception) {
            false
        }
    }
}
