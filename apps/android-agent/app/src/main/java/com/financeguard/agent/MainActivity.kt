package com.financeguard.agent

import android.os.Build
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import kotlin.concurrent.thread

class MainActivity : AppCompatActivity() {
    private lateinit var apiUrlInput: EditText
    private lateinit var agentSecretInput: EditText
    private lateinit var summaryView: TextView
    private lateinit var statusView: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        NotificationHelper.ensureChannel(this)
        SyncScheduler.schedulePeriodic(this)
        AgentApi(this).refreshPushToken()

        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(40, 80, 40, 40)
        }

        val title = TextView(this).apply {
            text = "FinanceGuard Agent"
            textSize = 24f
        }

        val subtitle = TextView(this).apply {
            text = "Device Owner agent for financed Android devices. It registers with the server, receives reminder or lock commands, and syncs payment state."
            textSize = 16f
        }

        val prefs = AgentPreferences.from(this).snapshot()

        apiUrlInput = EditText(this).apply {
            hint = "API URL (example: http://192.168.1.10:4000)"
            setText(prefs.apiBaseUrl)
        }

        agentSecretInput = EditText(this).apply {
            hint = "Agent secret (example: FG-1234)"
            setText(prefs.agentSecret)
        }

        summaryView = TextView(this).apply {
            textSize = 16f
        }

        statusView = TextView(this).apply {
            textSize = 14f
        }

        val saveButton = Button(this).apply {
            text = "Save Connection"
            setOnClickListener {
                val apiUrl = apiUrlInput.text.toString().trim().removeSuffix("/")
                val agentSecret = agentSecretInput.text.toString().trim()

                if (apiUrl.isBlank() || agentSecret.isBlank()) {
                    Toast.makeText(
                        this@MainActivity,
                        "Enter both API URL and agent secret.",
                        Toast.LENGTH_SHORT
                    ).show()
                    return@setOnClickListener
                }

                AgentPreferences.from(this@MainActivity).updateConnection(
                    apiBaseUrl = apiUrl,
                    agentSecret = agentSecret
                )
                refreshUi()
                statusView.text = "Connection saved. Tap Register Device next."
            }
        }

        val registerButton = Button(this).apply {
            text = "Register Device"
            setOnClickListener { runNetworkTask("Registering device...") { AgentApi(this@MainActivity).registerDevice() } }
        }

        val syncButton = Button(this).apply {
            text = "Sync Now"
            setOnClickListener { runNetworkTask("Syncing with server...") { AgentApi(this@MainActivity).syncDevice() } }
        }

        val restrictedButton = Button(this).apply {
            text = "Open Restricted Screen"
            setOnClickListener {
                startActivity(android.content.Intent(this@MainActivity, RestrictionActivity::class.java))
            }
        }

        container.addView(title)
        container.addView(subtitle)
        container.addView(apiUrlInput)
        container.addView(agentSecretInput)
        container.addView(saveButton)
        container.addView(summaryView)
        container.addView(statusView)
        container.addView(registerButton)
        container.addView(syncButton)
        container.addView(restrictedButton)

        setContentView(ScrollView(this).apply { addView(container) })
        refreshUi()
    }

    override fun onResume() {
        super.onResume()
        DevicePolicyController(this).enforceManagedBaseline()
        refreshUi()
    }

    private fun runNetworkTask(message: String, task: () -> SyncPayload) {
        statusView.text = message

        thread {
            try {
                val payload = task()
                CommandProcessor(this).applySyncPayload(payload)
                runOnUiThread {
                    refreshUi()
                    statusView.text = "Last action completed successfully."
                }
            } catch (error: Exception) {
                runOnUiThread {
                    statusView.text = "Action failed: ${error.message}"
                }
            }
        }
    }

    private fun refreshUi() {
        val prefs = AgentPreferences.from(this).snapshot()
        val policyController = DevicePolicyController(this)
        val stateRepo = LockStateRepository()

        summaryView.text = buildString {
            appendLine("Device owner: ${policyController.isDeviceOwner()}")
            appendLine(
                "Restriction security: ${
                    if (policyController.isDeviceOwner()) {
                        "Managed device lock task active"
                    } else {
                        "Not secure yet - provision as Device Owner"
                    }
                }"
            )
            if (policyController.isDeviceOwner()) {
                appendLine("Managed baseline: USB debugging, factory reset in Settings, safe boot, USB file transfer, app control, and unknown sources blocked")
            }
            appendLine("Android version: ${Build.VERSION.RELEASE}")
            appendLine("Organization: ${prefs.organizationName}")
            appendLine("API URL: ${prefs.apiBaseUrl}")
            appendLine("Agent secret: ${prefs.agentSecret.ifBlank { "Not set" }}")
            appendLine("Device ID: ${prefs.deviceId.ifBlank { "Waiting for server" }}")
            appendLine("Unique ID: ${prefs.uniqueId.ifBlank { "Will be generated on register" }}")
            appendLine("Customer: ${prefs.customerName.ifBlank { "Unassigned" }}")
            appendLine("Contract: ${prefs.contractId.ifBlank { "Unassigned" }}")
            appendLine("Current state: ${stateRepo.statusLabel(prefs.currentState)}")
            appendLine("Last reason: ${prefs.lastReason.ifBlank { "-" }}")
            appendLine("Lock message: ${prefs.lockMessage.ifBlank { "-" }}")
            appendLine("Last reminder: ${prefs.lastReminder.ifBlank { "-" }}")
            appendLine("Push token: ${if (prefs.pushToken.isBlank()) "Missing or Firebase not configured" else "Ready"}")
            appendLine("Last sync: ${prefs.lastSyncAt.ifBlank { "Never" }}")
        }
    }
}
