package com.financeguard.agent

import android.app.admin.DevicePolicyManager
import android.os.Bundle
import android.os.PersistableBundle
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import kotlin.concurrent.thread

class PolicyComplianceActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val message = TextView(this).apply {
            text = "Finalizing FinanceGuard device enrollment..."
            textSize = 18f
        }

        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 80, 48, 48)
            addView(message)
        }

        setContentView(container)

        @Suppress("DEPRECATION")
        val extras = intent.getParcelableExtra<PersistableBundle>(
            DevicePolicyManager.EXTRA_PROVISIONING_ADMIN_EXTRAS_BUNDLE
        )

        val prefs = AgentPreferences.from(this)
        prefs.applyProvisioningExtras(extras)

        thread {
            DevicePolicyController(this).finishProvisioning(
                organizationName = prefs.snapshot().organizationName,
                organizationId = prefs.snapshot().organizationId
            )
            NotificationHelper.ensureChannel(this)
            SyncScheduler.schedulePeriodic(this)

            runCatching {
                val payload = AgentApi(this).registerDevice()
                CommandProcessor(this).applySyncPayload(payload)
            }

            runOnUiThread {
                setResult(RESULT_OK)
                finish()
            }
        }
    }
}
