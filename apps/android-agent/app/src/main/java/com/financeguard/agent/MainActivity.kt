package com.financeguard.agent

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import kotlin.concurrent.thread

class MainActivity : AppCompatActivity() {
    private lateinit var apiUrlInput: EditText
    private lateinit var agentSecretInput: EditText
    private lateinit var summaryView: TextView
    private lateinit var statusView: TextView
    private val recoveryPermissionRequest = 771

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        NotificationHelper.ensureChannel(this)
        SyncScheduler.schedulePeriodic(this)
        AgentApi(this).refreshPushToken()
        DevicePolicyController(this).enforceManagedBaseline()

        window.statusBarColor = Color.rgb(9, 14, 28)
        window.navigationBarColor = Color.rgb(9, 14, 28)

        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(36, 60, 36, 40)
            setBackgroundColor(Color.rgb(9, 14, 28))
        }

        val title = TextView(this).apply {
            text = "FinanceGuard Agent"
            textSize = 28f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.rgb(238, 243, 255))
        }

        val subtitle = TextView(this).apply {
            text = "Managed recovery, payment protection, and device health reporting for financed Android phones."
            textSize = 16f
            setTextColor(Color.rgb(167, 183, 226))
            setPadding(0, 8, 0, 18)
        }

        val prefs = AgentPreferences.from(this).snapshot()

        apiUrlInput = EditText(this).apply {
            hint = "API URL (example: http://192.168.1.10:4000)"
            setText(prefs.apiBaseUrl)
            styleInput()
        }

        agentSecretInput = EditText(this).apply {
            hint = "Agent secret (example: FG-1234)"
            setText(prefs.agentSecret)
            styleInput()
        }

        summaryView = TextView(this).apply {
            textSize = 16f
            setTextColor(Color.rgb(232, 237, 255))
            setLineSpacing(4f, 1.0f)
        }

        statusView = TextView(this).apply {
            textSize = 14f
            setTextColor(Color.rgb(167, 183, 226))
            setPadding(0, 12, 0, 4)
        }

        val saveButton = Button(this).apply {
            text = "Save Connection"
            stylePrimaryButton()
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
            stylePrimaryButton()
            setOnClickListener { runNetworkTask("Registering device...") { AgentApi(this@MainActivity).registerDevice() } }
        }

        val syncButton = Button(this).apply {
            text = "Sync Now"
            styleSecondaryButton()
            setOnClickListener { runNetworkTask("Syncing with server...") { AgentApi(this@MainActivity).syncDevice(reason = "Manual app sync") } }
        }

        val permissionsButton = Button(this).apply {
            text = "Enable Recovery Permissions"
            styleSecondaryButton()
            setOnClickListener { requestRecoveryPermissions() }
        }

        val restrictedButton = Button(this).apply {
            text = "Open Restricted Screen"
            styleDangerButton()
            setOnClickListener {
                startActivity(android.content.Intent(this@MainActivity, RestrictionActivity::class.java))
            }
        }

        container.addView(title)
        container.addView(subtitle)
        container.addView(card("Connection", apiUrlInput, agentSecretInput, saveButton))
        container.addView(card("Device Status", summaryView))
        container.addView(statusView)
        container.addView(card("Actions", registerButton, syncButton, permissionsButton, restrictedButton))
        container.addView(disclosureCard())

        setContentView(ScrollView(this).apply { addView(container) })
        refreshUi()
    }

    override fun onResume() {
        super.onResume()
        DevicePolicyController(this).enforceManagedBaseline()
        refreshUi()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == recoveryPermissionRequest) {
            refreshUi()
            statusView.text = "Recovery permission status updated."
        }
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
                appendLine("Managed baseline: USB debugging, factory reset in Settings, safe boot, USB file transfer, and user switching blocked")
                appendLine("FRP policy accounts: ${prefs.frpAccountsCsv.split(",").map { it.trim() }.filter { it.isNotEmpty() }.size}")
            }
            appendLine("Recovery permissions: ${recoveryPermissionLabel()}")
            appendLine("Recovery tracking: ${if (prefs.trackingEnabled) "Enabled" else "Idle"}")
            appendLine("Lost mode: ${if (prefs.lostModeEnabled) "Enabled" else "Off"}")
            if (prefs.lostModeEnabled) {
                appendLine("Lost message: ${prefs.lostModeMessage.ifBlank { "-" }}")
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
            appendLine("Last location: ${prefs.lastLocationSummary.ifBlank { "No location yet" }}")
            appendLine("Detected IMEI: ${prefs.imeiDetected.ifBlank { "Unavailable" }}")
            appendLine("Detected serial: ${prefs.serialDetected.ifBlank { "Unavailable" }}")
            appendLine("Identifier status: ${prefs.identifierStatus.ifBlank { "Waiting for server" }}")
            appendLine("Battery: ${prefs.batterySummary.ifBlank { "Unavailable" }}")
            appendLine("Network: ${prefs.networkStatus.ifBlank { "Unknown" }}")
            appendLine("Push token: ${if (prefs.pushToken.isBlank()) "Missing or Firebase not configured" else "Ready"}")
            appendLine("Last sync: ${prefs.lastSyncAt.ifBlank { "Never" }}")
        }
    }

    private fun requestRecoveryPermissions() {
        val permissions = mutableListOf(
            Manifest.permission.ACCESS_COARSE_LOCATION,
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.READ_PHONE_STATE
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            permissions.add(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            permissions.add(Manifest.permission.POST_NOTIFICATIONS)
        }

        val missing = permissions
            .filter { ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED }
            .toTypedArray()

        if (missing.isEmpty()) {
            statusView.text = "Recovery permissions are already enabled."
            return
        }

        ActivityCompat.requestPermissions(this, missing, recoveryPermissionRequest)
    }

    private fun recoveryPermissionLabel(): String {
        val locationGranted =
            ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
                ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
        val phoneGranted =
            ContextCompat.checkSelfPermission(this, Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED
        return when {
            locationGranted && phoneGranted -> "Location and IMEI access ready"
            locationGranted -> "Location ready, IMEI unavailable"
            phoneGranted -> "IMEI ready, location unavailable"
            else -> "Needs location and phone-state permission"
        }
    }

    private fun card(title: String, vararg views: android.view.View): LinearLayout {
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(26, 22, 26, 22)
            background = roundedBackground(Color.rgb(18, 27, 52), Color.rgb(38, 50, 80))
            val params = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { setMargins(0, 12, 0, 12) }
            layoutParams = params

            addView(TextView(this@MainActivity).apply {
                text = title
                textSize = 18f
                typeface = Typeface.DEFAULT_BOLD
                setTextColor(Color.rgb(238, 243, 255))
                setPadding(0, 0, 0, 14)
            })
            views.forEach { view ->
                if (view.parent != null) {
                    (view.parent as? android.view.ViewGroup)?.removeView(view)
                }
                addView(view)
            }
        }
    }

    private fun disclosureCard(): TextView {
        return TextView(this).apply {
            text = "Recovery disclosure: this managed phone can report last seen status, identifiers, battery, network, and location to the administrator for financed-device protection and lost/stolen recovery."
            textSize = 14f
            setTextColor(Color.rgb(167, 183, 226))
            setPadding(24, 20, 24, 20)
            background = roundedBackground(Color.rgb(13, 20, 40), Color.rgb(38, 50, 80))
        }
    }

    private fun EditText.styleInput() {
        setTextColor(Color.rgb(238, 243, 255))
        setHintTextColor(Color.rgb(123, 139, 184))
        background = roundedBackground(Color.rgb(11, 18, 36), Color.rgb(38, 50, 80))
        setPadding(20, 14, 20, 14)
    }

    private fun Button.stylePrimaryButton() {
        setTextColor(Color.WHITE)
        background = roundedBackground(Color.rgb(76, 128, 255), Color.rgb(76, 128, 255))
    }

    private fun Button.styleSecondaryButton() {
        setTextColor(Color.rgb(238, 243, 255))
        background = roundedBackground(Color.rgb(20, 33, 62), Color.rgb(76, 128, 255))
    }

    private fun Button.styleDangerButton() {
        setTextColor(Color.rgb(255, 205, 205))
        background = roundedBackground(Color.rgb(58, 25, 35), Color.rgb(160, 68, 82))
    }

    private fun roundedBackground(fill: Int, stroke: Int): GradientDrawable {
        return GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = 24f
            setColor(fill)
            setStroke(2, stroke)
        }
    }
}
