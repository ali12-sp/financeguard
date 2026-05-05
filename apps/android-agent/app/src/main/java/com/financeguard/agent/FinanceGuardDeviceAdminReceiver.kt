package com.financeguard.agent

import android.app.admin.DeviceAdminReceiver
import android.content.Context
import android.content.Intent

class FinanceGuardDeviceAdminReceiver : DeviceAdminReceiver() {
    override fun onEnabled(context: Context, intent: Intent) {
        SyncScheduler.schedulePeriodic(context)
    }

    override fun onProfileProvisioningComplete(context: Context, intent: Intent) {
        val prefs = AgentPreferences.from(context).snapshot()
        DevicePolicyController(context).finishProvisioning(
            organizationName = prefs.organizationName,
            organizationId = prefs.organizationId
        )
        SyncScheduler.schedulePeriodic(context)

        val launchIntent = Intent(context, ProvisioningSuccessActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        context.startActivity(launchIntent)
    }
}
