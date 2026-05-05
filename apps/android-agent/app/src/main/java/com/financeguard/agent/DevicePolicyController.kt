package com.financeguard.agent

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings

class DevicePolicyController(
    private val context: Context
) {
    private val dpm = context.getSystemService(DevicePolicyManager::class.java)
    private val admin = ComponentName(context, FinanceGuardDeviceAdminReceiver::class.java)

    fun isDeviceOwner(): Boolean {
        return dpm?.isDeviceOwnerApp(context.packageName) == true
    }

    fun finishProvisioning(organizationName: String, organizationId: String) {
        if (!isDeviceOwner()) return

        runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                dpm?.setOrganizationName(admin, organizationName)
            }
        }
        runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                dpm?.setOrganizationId(organizationId)
            }
        }
        runCatching {
            dpm?.setLockTaskPackages(admin, arrayOf(context.packageName))
        }
        runCatching {
            dpm?.setLockTaskFeatures(admin, DevicePolicyManager.LOCK_TASK_FEATURE_NONE)
        }
        runCatching {
            dpm?.setUninstallBlocked(admin, context.packageName, true)
        }
    }

    fun stableDeviceId(): String {
        if (isDeviceOwner() && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            runCatching {
                val enrollmentSpecificId = dpm?.enrollmentSpecificId.orEmpty()
                if (enrollmentSpecificId.isNotBlank()) {
                    return enrollmentSpecificId
                }
            }
        }

        return Settings.Secure.getString(
            context.contentResolver,
            Settings.Secure.ANDROID_ID
        ) ?: "unknown-device"
    }

    fun applyRestrictedMode(lockMessage: String) {
        if (isDeviceOwner()) {
            runCatching {
                dpm?.setDeviceOwnerLockScreenInfo(admin, lockMessage)
            }
            runCatching {
                dpm?.setLockTaskPackages(admin, arrayOf(context.packageName))
            }
            runCatching {
                dpm?.setLockTaskFeatures(admin, DevicePolicyManager.LOCK_TASK_FEATURE_NONE)
            }
            runCatching {
                dpm?.setStatusBarDisabled(admin, true)
            }
            runCatching {
                dpm?.setUninstallBlocked(admin, context.packageName, true)
            }
        }

        val intent = Intent(context, RestrictionActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            putExtra("lockMessage", lockMessage)
        }
        context.startActivity(intent)

        if (isDeviceOwner()) {
            runCatching {
                dpm?.lockNow()
            }
        }
    }

    fun clearRestrictedMode() {
        if (isDeviceOwner()) {
            runCatching {
                dpm?.setDeviceOwnerLockScreenInfo(admin, null)
            }
            runCatching {
                dpm?.setStatusBarDisabled(admin, false)
            }
            runCatching {
                dpm?.setUninstallBlocked(admin, context.packageName, true)
            }
        }

        val intent = Intent(context, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        context.startActivity(intent)
    }
}
