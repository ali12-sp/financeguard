package com.financeguard.agent

import android.content.Context
import android.content.SharedPreferences
import android.os.PersistableBundle
import androidx.core.content.edit

data class AgentSnapshot(
    val apiBaseUrl: String,
    val agentSecret: String,
    val deviceId: String,
    val organizationId: String,
    val organizationName: String,
    val frpAccountsCsv: String,
    val currentState: DeviceState,
    val customerName: String,
    val contractId: String,
    val pushToken: String,
    val uniqueId: String,
    val lockMessage: String,
    val lastReason: String,
    val lastSyncAt: String,
    val lastCommandId: String,
    val lastReminder: String,
    val trackingEnabled: Boolean,
    val lostModeEnabled: Boolean,
    val lostModeMessage: String,
    val lastLocationSummary: String,
    val imeiDetected: String,
    val serialDetected: String,
    val identifierStatus: String,
    val batterySummary: String,
    val networkStatus: String,
    val appVersion: String
)

class AgentPreferences private constructor(
    private val prefs: SharedPreferences
) {
    companion object {
        private const val PREFS_NAME = "financeguard_agent"
        private const val KEY_API_BASE_URL = "api_base_url"
        private const val KEY_AGENT_SECRET = "agent_secret"
        private const val KEY_DEVICE_ID = "device_id"
        private const val KEY_ORG_ID = "organization_id"
        private const val KEY_ORG_NAME = "organization_name"
        private const val KEY_FRP_ACCOUNTS = "frp_accounts"
        private const val KEY_CURRENT_STATE = "current_state"
        private const val KEY_CUSTOMER_NAME = "customer_name"
        private const val KEY_CONTRACT_ID = "contract_id"
        private const val KEY_PUSH_TOKEN = "push_token"
        private const val KEY_UNIQUE_ID = "unique_id"
        private const val KEY_LOCK_MESSAGE = "lock_message"
        private const val KEY_LAST_REASON = "last_reason"
        private const val KEY_LAST_SYNC_AT = "last_sync_at"
        private const val KEY_LAST_COMMAND_ID = "last_command_id"
        private const val KEY_LAST_REMINDER = "last_reminder"
        private const val KEY_TRACKING_ENABLED = "tracking_enabled"
        private const val KEY_LOST_MODE_ENABLED = "lost_mode_enabled"
        private const val KEY_LOST_MODE_MESSAGE = "lost_mode_message"
        private const val KEY_LAST_LOCATION_SUMMARY = "last_location_summary"
        private const val KEY_IMEI_DETECTED = "imei_detected"
        private const val KEY_SERIAL_DETECTED = "serial_detected"
        private const val KEY_IDENTIFIER_STATUS = "identifier_status"
        private const val KEY_BATTERY_SUMMARY = "battery_summary"
        private const val KEY_NETWORK_STATUS = "network_status"
        private const val KEY_APP_VERSION = "app_version"

        fun from(context: Context): AgentPreferences {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            return AgentPreferences(prefs)
        }
    }

    fun snapshot(): AgentSnapshot {
        return AgentSnapshot(
            apiBaseUrl = prefs.getString(KEY_API_BASE_URL, "http://10.0.2.2:4000") ?: "http://10.0.2.2:4000",
            agentSecret = prefs.getString(KEY_AGENT_SECRET, "") ?: "",
            deviceId = prefs.getString(KEY_DEVICE_ID, "") ?: "",
            organizationId = prefs.getString(KEY_ORG_ID, "financeguard-demo") ?: "financeguard-demo",
            organizationName = prefs.getString(KEY_ORG_NAME, "FinanceGuard Demo") ?: "FinanceGuard Demo",
            frpAccountsCsv = prefs.getString(KEY_FRP_ACCOUNTS, "") ?: "",
            currentState = DeviceState.valueOf(prefs.getString(KEY_CURRENT_STATE, DeviceState.ACTIVE.name) ?: DeviceState.ACTIVE.name),
            customerName = prefs.getString(KEY_CUSTOMER_NAME, "") ?: "",
            contractId = prefs.getString(KEY_CONTRACT_ID, "") ?: "",
            pushToken = prefs.getString(KEY_PUSH_TOKEN, "") ?: "",
            uniqueId = prefs.getString(KEY_UNIQUE_ID, "") ?: "",
            lockMessage = prefs.getString(KEY_LOCK_MESSAGE, "") ?: "",
            lastReason = prefs.getString(KEY_LAST_REASON, "") ?: "",
            lastSyncAt = prefs.getString(KEY_LAST_SYNC_AT, "") ?: "",
            lastCommandId = prefs.getString(KEY_LAST_COMMAND_ID, "") ?: "",
            lastReminder = prefs.getString(KEY_LAST_REMINDER, "") ?: "",
            trackingEnabled = prefs.getBoolean(KEY_TRACKING_ENABLED, false),
            lostModeEnabled = prefs.getBoolean(KEY_LOST_MODE_ENABLED, false),
            lostModeMessage = prefs.getString(KEY_LOST_MODE_MESSAGE, "") ?: "",
            lastLocationSummary = prefs.getString(KEY_LAST_LOCATION_SUMMARY, "") ?: "",
            imeiDetected = prefs.getString(KEY_IMEI_DETECTED, "") ?: "",
            serialDetected = prefs.getString(KEY_SERIAL_DETECTED, "") ?: "",
            identifierStatus = prefs.getString(KEY_IDENTIFIER_STATUS, "") ?: "",
            batterySummary = prefs.getString(KEY_BATTERY_SUMMARY, "") ?: "",
            networkStatus = prefs.getString(KEY_NETWORK_STATUS, "") ?: "",
            appVersion = prefs.getString(KEY_APP_VERSION, "") ?: ""
        )
    }

    fun applyProvisioningExtras(extras: PersistableBundle?) {
        if (extras == null) return

        prefs.edit {
            putString(KEY_API_BASE_URL, extras.getString("apiBaseUrl", snapshot().apiBaseUrl))
            putString(KEY_AGENT_SECRET, extras.getString("agentSecret", snapshot().agentSecret))
            putString(KEY_DEVICE_ID, extras.getString("deviceId", snapshot().deviceId))
            putString(KEY_ORG_ID, extras.getString("organizationId", snapshot().organizationId))
            putString(KEY_ORG_NAME, extras.getString("organizationName", snapshot().organizationName))
            putString(KEY_FRP_ACCOUNTS, extras.getString("frpAccountsCsv", snapshot().frpAccountsCsv))
        }
    }

    fun updateServerAssignment(
        customerName: String? = null,
        contractId: String? = null,
        deviceId: String? = null,
        lastSyncAt: String? = null
    ) {
        prefs.edit {
            customerName?.let { putString(KEY_CUSTOMER_NAME, it) }
            contractId?.let { putString(KEY_CONTRACT_ID, it) }
            deviceId?.let { putString(KEY_DEVICE_ID, it) }
            lastSyncAt?.let { putString(KEY_LAST_SYNC_AT, it) }
        }
    }

    fun updateIdentity(uniqueId: String, appVersion: String) {
        prefs.edit {
            putString(KEY_UNIQUE_ID, uniqueId)
            putString(KEY_APP_VERSION, appVersion)
        }
    }

    fun updatePushToken(pushToken: String) {
        prefs.edit { putString(KEY_PUSH_TOKEN, pushToken) }
    }

    fun updateConnection(apiBaseUrl: String? = null, agentSecret: String? = null) {
        prefs.edit {
            apiBaseUrl?.let { putString(KEY_API_BASE_URL, it) }
            agentSecret?.let { putString(KEY_AGENT_SECRET, it) }
        }
    }

    fun updateState(
        state: DeviceState,
        reason: String? = null,
        lockMessage: String? = null,
        lastCommandId: String? = null,
        lastSyncAt: String? = null
    ) {
        prefs.edit {
            putString(KEY_CURRENT_STATE, state.name)
            putString(KEY_LAST_REASON, reason ?: "")
            putString(KEY_LOCK_MESSAGE, lockMessage ?: "")
            lastCommandId?.let { putString(KEY_LAST_COMMAND_ID, it) }
            lastSyncAt?.let { putString(KEY_LAST_SYNC_AT, it) }
        }
    }

    fun saveReminder(message: String) {
        prefs.edit { putString(KEY_LAST_REMINDER, message) }
    }

    fun updateRecoveryPolicy(
        trackingEnabled: Boolean? = null,
        lostModeEnabled: Boolean? = null,
        lostModeMessage: String? = null
    ) {
        prefs.edit {
            trackingEnabled?.let { putBoolean(KEY_TRACKING_ENABLED, it) }
            lostModeEnabled?.let { putBoolean(KEY_LOST_MODE_ENABLED, it) }
            lostModeMessage?.let { putString(KEY_LOST_MODE_MESSAGE, it) }
        }
    }

    fun updateTelemetryCache(
        locationSummary: String? = null,
        imeiDetected: String? = null,
        serialDetected: String? = null,
        identifierStatus: String? = null,
        batterySummary: String? = null,
        networkStatus: String? = null
    ) {
        prefs.edit {
            locationSummary?.let { putString(KEY_LAST_LOCATION_SUMMARY, it) }
            imeiDetected?.let { putString(KEY_IMEI_DETECTED, it) }
            serialDetected?.let { putString(KEY_SERIAL_DETECTED, it) }
            identifierStatus?.let { putString(KEY_IDENTIFIER_STATUS, it) }
            batterySummary?.let { putString(KEY_BATTERY_SUMMARY, it) }
            networkStatus?.let { putString(KEY_NETWORK_STATUS, it) }
        }
    }
}
