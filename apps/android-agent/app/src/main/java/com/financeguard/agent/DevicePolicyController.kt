package com.financeguard.agent

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.UserManager
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
        enforceManagedBaseline()
    }

    fun enforceManagedBaseline() {
        if (!isDeviceOwner()) return

        runCatching {
            dpm?.setLockTaskPackages(admin, arrayOf(context.packageName))
        }
        runCatching {
            dpm?.setLockTaskFeatures(admin, DevicePolicyManager.LOCK_TASK_FEATURE_NONE)
        }
        runCatching {
            dpm?.setUninstallBlocked(admin, context.packageName, true)
        }
        runCatching {
            dpm?.setShortSupportMessage(admin, "Managed by FinanceGuard")
        }
        runCatching {
            dpm?.setLongSupportMessage(
                admin,
                "This device is protected by FinanceGuard device controls. Contact your seller or administrator for support."
            )
        }
        runCatching {
            dpm?.setBackupServiceEnabled(admin, false)
        }

        applyUserRestriction(UserManager.DISALLOW_FACTORY_RESET)
        applyUserRestriction(UserManager.DISALLOW_SAFE_BOOT)
        applyUserRestriction(UserManager.DISALLOW_DEBUGGING_FEATURES)
        applyUserRestriction(UserManager.DISALLOW_USB_FILE_TRANSFER)
        applyUserRestriction(UserManager.DISALLOW_ADD_USER)
        applyUserRestriction(UserManager.DISALLOW_REMOVE_USER)
        applyUserRestriction(UserManager.DISALLOW_APPS_CONTROL)
        applyUserRestriction(UserManager.DISALLOW_INSTALL_UNKNOWN_SOURCES)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            applyUserRestriction(UserManager.DISALLOW_SYSTEM_ERROR_DIALOGS)
            applyUserRestriction(UserManager.DISALLOW_USER_SWITCH)
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
            enforceManagedBaseline()
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

    private fun applyUserRestriction(restriction: String) {
        runCatching {
            dpm?.addUserRestriction(admin, restriction)
        }
    }
}
