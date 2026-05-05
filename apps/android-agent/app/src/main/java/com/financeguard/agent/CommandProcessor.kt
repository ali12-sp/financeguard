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
            }
        }
    }
}
