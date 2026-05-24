package com.financeguard.agent

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

class CommandProcessor(
    private val context: Context
) {
    private val prefs = AgentPreferences.from(context)
    private val stateRepository = LockStateRepository()
    private val policyController = DevicePolicyController(context)
    private val api = AgentApi(context)

    fun applySyncPayload(payload: SyncPayload) {
        payload.device?.let { device ->
            prefs.updateServerAssignment(
                customerName = device.optString("customerName", prefs.snapshot().customerName),
                contractId = device.optString("contractId", prefs.snapshot().contractId),
                deviceId = device.optString("id", prefs.snapshot().deviceId),
                lastSyncAt = device.optString("lastSyncAt", prefs.snapshot().lastSyncAt)
            )
            applyServerState(device)
        }

        processPendingCommands(payload.pendingCommands)
    }

    fun processPendingCommands(commands: JSONArray) {
        for (index in 0 until commands.length()) {
            val command = commands.optJSONObject(index) ?: continue
            val commandId = command.optString("id")

            try {
                handleCommand(command)
                api.acknowledgeCommand(commandId, true, "Applied on device")
            } catch (error: Exception) {
                api.acknowledgeCommand(commandId, false, error.message ?: "Command failed")
            }
        }
    }

    fun processRemoteData(data: Map<String, String>) {
        val command = JSONObject().apply {
            put("id", data["commandId"])
            put("type", data["type"])
            put("reason", data["reason"])
            put("lockMessage", data["lockMessage"])
        }

        val payload = JSONObject()
        data.forEach { (key, value) ->
            if (key !in setOf("commandId", "type", "reason", "lockMessage")) {
                payload.put(key, value)
            }
        }
        command.put("payload", payload)

        val array = JSONArray().put(command)
        processPendingCommands(array)
    }

    private fun handleCommand(command: JSONObject) {
        val commandId = command.optString("id")
        val type = command.optString("type")
        val reason = command.optString("reason")
        val lockMessage = command.optString("lockMessage")
        val payload = command.optJSONObject("payload") ?: JSONObject()

        when (type) {
            "LOCK" -> {
                val message = lockMessage.ifBlank { "Payment overdue. Contact FinanceGuard to unlock this device." }
                prefs.updateState(
                    state = DeviceState.RESTRICTED,
                    reason = reason,
                    lockMessage = message,
                    lastCommandId = commandId
                )
                policyController.applyRestrictedMode(message)
            }

            "UNLOCK" -> {
                prefs.updateState(
                    state = DeviceState.ACTIVE,
                    reason = reason,
                    lockMessage = "",
                    lastCommandId = commandId
                )
                policyController.clearRestrictedMode()
            }

            "REMINDER" -> {
                prefs.saveReminder(reason)
                NotificationHelper.showReminder(
                    context = context,
                    title = "Installment reminder",
                    message = reason.ifBlank { "Your next installment is coming due soon." }
                )
                prefs.updateState(
                    state = DeviceState.REMINDER,
                    reason = reason,
                    lockMessage = prefs.snapshot().lockMessage,
                    lastCommandId = commandId
                )
            }

            "SYNC" -> {
                prefs.updateState(
                    state = prefs.snapshot().currentState,
                    reason = "Server requested sync",
                    lastCommandId = commandId
                )
                policyController.enforceSavedState()
            }

            "REQUEST_LOCATION" -> {
                api.uploadTelemetry(
                    forceLocation = true,
                    reason = reason.ifBlank { "Admin requested recovery location" }
                )
                NotificationHelper.showReminder(
                    context = context,
                    title = "Recovery location shared",
                    message = "This managed device reported its recovery location to the administrator."
                )
                prefs.updateState(
                    state = prefs.snapshot().currentState,
                    reason = reason.ifBlank { "Recovery location reported" },
                    lastCommandId = commandId
                )
            }

            "ENABLE_LOST_MODE" -> {
                val message = payload.optString(
                    "lostModeMessage",
                    "This managed phone has been marked lost. Please contact the seller or office."
                ).ifBlank {
                    "This managed phone has been marked lost. Please contact the seller or office."
                }
                prefs.updateRecoveryPolicy(
                    trackingEnabled = true,
                    lostModeEnabled = true,
                    lostModeMessage = message
                )
                prefs.updateState(
                    state = DeviceState.RESTRICTED,
                    reason = reason.ifBlank { "Lost mode enabled by administrator" },
                    lockMessage = message,
                    lastCommandId = commandId
                )
                api.uploadTelemetry(
                    forceLocation = true,
                    reason = "Lost mode enabled; reporting recovery location"
                )
                policyController.applyRestrictedMode(message)
            }

            "DISABLE_LOST_MODE" -> {
                prefs.updateRecoveryPolicy(
                    lostModeEnabled = false,
                    lostModeMessage = ""
                )
                prefs.updateState(
                    state = DeviceState.ACTIVE,
                    reason = reason.ifBlank { "Lost mode disabled by administrator" },
                    lockMessage = "",
                    lastCommandId = commandId
                )
                policyController.applyUnlockedMode(returnHome = true)
            }

            "RELEASE_CONTROL" -> {
                prefs.updateState(
                    state = DeviceState.RELEASED,
                    reason = reason.ifBlank { "Managed control released by admin" },
                    lockMessage = "",
                    lastCommandId = commandId
                )
                policyController.releaseManagedControl()
            }
        }
    }

    private fun applyServerState(device: JSONObject) {
        val serverState = stateRepository.fromServer(device.optString("state"))
        val snapshot = prefs.snapshot()
        val reason = device.optString("restrictionReason", snapshot.lastReason)
        val trackingEnabled =
            if (device.has("trackingEnabled")) device.optBoolean("trackingEnabled") else snapshot.trackingEnabled
        val lostModeEnabled =
            if (device.has("lostModeEnabled")) device.optBoolean("lostModeEnabled") else snapshot.lostModeEnabled
        val lostModeMessage = device.optString("lostModeMessage", snapshot.lostModeMessage).ifBlank {
            "This managed phone has been marked lost. Please contact the seller or office."
        }
        prefs.updateRecoveryPolicy(
            trackingEnabled = trackingEnabled,
            lostModeEnabled = lostModeEnabled,
            lostModeMessage = if (lostModeEnabled) lostModeMessage else ""
        )
        prefs.updateTelemetryCache(
            locationSummary = locationSummary(device),
            imeiDetected = device.optString("imeiDetected", snapshot.imeiDetected),
            serialDetected = device.optString("serialDetected", snapshot.serialDetected),
            identifierStatus = device.optString("identifierStatus", snapshot.identifierStatus),
            batterySummary = batterySummary(device),
            networkStatus = device.optString("networkStatus", snapshot.networkStatus)
        )

        if (lostModeEnabled) {
            prefs.updateState(
                state = DeviceState.RESTRICTED,
                reason = "Lost mode active",
                lockMessage = lostModeMessage
            )
            policyController.applyRestrictedMode(lostModeMessage)
            return
        }

        val lockMessage = reason.ifBlank {
            snapshot.lockMessage.ifBlank {
                "Payment overdue. Contact FinanceGuard to unlock this device."
            }
        }

        when (serverState) {
            DeviceState.RESTRICTED -> {
                prefs.updateState(
                    state = DeviceState.RESTRICTED,
                    reason = reason,
                    lockMessage = lockMessage
                )
                policyController.applyRestrictedMode(lockMessage)
            }

            DeviceState.ACTIVE,
            DeviceState.RELEASED -> {
                val wasRestricted = snapshot.currentState == DeviceState.RESTRICTED || snapshot.lostModeEnabled
                prefs.updateState(
                    state = serverState,
                    reason = reason,
                    lockMessage = ""
                )
                policyController.applyUnlockedMode(returnHome = wasRestricted)
            }

            DeviceState.REMINDER,
            DeviceState.GRACE -> {
                val wasRestricted = snapshot.currentState == DeviceState.RESTRICTED || snapshot.lostModeEnabled
                prefs.updateState(
                    state = serverState,
                    reason = reason,
                    lockMessage = ""
                )
                policyController.applyUnlockedMode(returnHome = wasRestricted)
            }
        }
    }

    private fun locationSummary(device: JSONObject): String {
        if (!device.has("lastLocationLat") || !device.has("lastLocationLng")) {
            return prefs.snapshot().lastLocationSummary
        }

        val lat = device.optDouble("lastLocationLat")
        val lng = device.optDouble("lastLocationLng")
        val provider = device.optString("lastLocationProvider", "provider n/a")
        return "${"%.5f".format(lat)}, ${"%.5f".format(lng)} ($provider)"
    }

    private fun batterySummary(device: JSONObject): String {
        if (!device.has("batteryLevel")) {
            return prefs.snapshot().batterySummary
        }

        val charging = if (device.optBoolean("batteryCharging")) " charging" else ""
        return "${device.optInt("batteryLevel")}%$charging"
    }
}
