package com.financeguard.agent

import android.Manifest
import android.app.admin.DevicePolicyManager
import android.app.admin.FactoryResetProtectionPolicy
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.UserManager
import android.provider.Settings
import androidx.localbroadcastmanager.content.LocalBroadcastManager

class DevicePolicyController(
    private val context: Context
) {
    companion object {
        const val ACTION_RESTRICTION_STATE_CHANGED = "com.financeguard.agent.RESTRICTION_STATE_CHANGED"
    }

    private val dpm = context.getSystemService(DevicePolicyManager::class.java)
    private val admin = ComponentName(context, FinanceGuardDeviceAdminReceiver::class.java)
    private val restrictionComponent = ComponentName(context, RestrictionActivity::class.java)

    fun isDeviceOwner(): Boolean {
        return dpm?.isDeviceOwnerApp(context.packageName) == true
    }

    fun finishProvisioning(organizationName: String, organizationId: String, frpAccountsCsv: String = "") {
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
        applyFrpPolicy(frpAccountsCsv)
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
        applyUserRestriction(UserManager.DISALLOW_FACTORY_RESET)
        applyUserRestriction(UserManager.DISALLOW_SAFE_BOOT)
        applyUserRestriction(UserManager.DISALLOW_DEBUGGING_FEATURES)
        applyUserRestriction(UserManager.DISALLOW_USB_FILE_TRANSFER)
        applyUserRestriction(UserManager.DISALLOW_ADD_USER)
        applyUserRestriction(UserManager.DISALLOW_REMOVE_USER)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            applyUserRestriction(UserManager.DISALLOW_USER_SWITCH)
        }
        grantManagedRuntimePermissions()
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
                dpm?.setBackupServiceEnabled(admin, false)
            }
            applyUserRestriction(UserManager.DISALLOW_APPS_CONTROL)
            applyUserRestriction(UserManager.DISALLOW_INSTALL_UNKNOWN_SOURCES)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                applyUserRestriction(UserManager.DISALLOW_SYSTEM_ERROR_DIALOGS)
            }
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
            runCatching {
                dpm?.addPersistentPreferredActivity(
                    admin,
                    managedHomeIntentFilter(),
                    restrictionComponent
                )
            }
        }

        openRestrictionScreen(lockMessage)
    }

    fun clearRestrictedMode() {
        applyUnlockedMode(returnHome = true)
    }

    fun applyUnlockedMode(returnHome: Boolean = false) {
        if (isDeviceOwner()) {
            runCatching {
                dpm?.setBackupServiceEnabled(admin, true)
            }
            clearUserRestriction(UserManager.DISALLOW_APPS_CONTROL)
            clearUserRestriction(UserManager.DISALLOW_INSTALL_UNKNOWN_SOURCES)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                clearUserRestriction(UserManager.DISALLOW_SYSTEM_ERROR_DIALOGS)
            }
            runCatching {
                dpm?.setDeviceOwnerLockScreenInfo(admin, null)
            }
            runCatching {
                dpm?.setStatusBarDisabled(admin, false)
            }
            runCatching {
                dpm?.setUninstallBlocked(admin, context.packageName, true)
            }
            runCatching {
                dpm?.clearPackagePersistentPreferredActivities(admin, context.packageName)
            }
        }

        LocalBroadcastManager.getInstance(context).sendBroadcast(
            Intent(ACTION_RESTRICTION_STATE_CHANGED)
        )
        if (returnHome) {
            Handler(Looper.getMainLooper()).postDelayed({
                launchHomeScreen()
            }, 350)
        }
    }

    fun releaseManagedControl() {
        if (isDeviceOwner()) {
            applyUnlockedMode(returnHome = false)
            clearUserRestriction(UserManager.DISALLOW_FACTORY_RESET)
            clearUserRestriction(UserManager.DISALLOW_SAFE_BOOT)
            clearUserRestriction(UserManager.DISALLOW_DEBUGGING_FEATURES)
            clearUserRestriction(UserManager.DISALLOW_USB_FILE_TRANSFER)
            clearUserRestriction(UserManager.DISALLOW_ADD_USER)
            clearUserRestriction(UserManager.DISALLOW_REMOVE_USER)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                clearUserRestriction(UserManager.DISALLOW_USER_SWITCH)
            }
            runCatching {
                dpm?.setLockTaskPackages(admin, emptyArray<String>())
            }
            runCatching {
                dpm?.setUninstallBlocked(admin, context.packageName, false)
            }
            runCatching {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    dpm?.setFactoryResetProtectionPolicy(admin, null)
                }
            }
            runCatching {
                dpm?.clearDeviceOwnerApp(context.packageName)
            }
            runCatching {
                dpm?.removeActiveAdmin(admin)
            }
        }

        LocalBroadcastManager.getInstance(context).sendBroadcast(
            Intent(ACTION_RESTRICTION_STATE_CHANGED)
        )
        Handler(Looper.getMainLooper()).postDelayed({
            launchHomeScreen()
        }, 350)
    }

    fun enforceSavedState() {
        val snapshot = AgentPreferences.from(context).snapshot()
        if (snapshot.lostModeEnabled) {
            applyRestrictedMode(
                snapshot.lostModeMessage.ifBlank {
                    "This managed phone has been marked lost. Please contact the seller or office."
                }
            )
            return
        }

        if (snapshot.currentState == DeviceState.RESTRICTED) {
            applyRestrictedMode(
                snapshot.lockMessage.ifBlank {
                    "Payment overdue. Contact FinanceGuard to unlock this device."
                }
            )
        }
    }

    private fun applyUserRestriction(restriction: String) {
        runCatching {
            dpm?.addUserRestriction(admin, restriction)
        }
    }

    private fun clearUserRestriction(restriction: String) {
        runCatching {
            dpm?.clearUserRestriction(admin, restriction)
        }
    }

    private fun grantManagedRuntimePermissions() {
        if (!isDeviceOwner() || Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            return
        }

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

        permissions.forEach { permission ->
            runCatching {
                dpm?.setPermissionGrantState(
                    admin,
                    context.packageName,
                    permission,
                    DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED
                )
            }
        }
    }

    private fun openRestrictionScreen(lockMessage: String) {
        val directIntent = Intent(context, RestrictionActivity::class.java).apply {
            addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP
            )
            putExtra("lockMessage", lockMessage)
        }
        runCatching { context.startActivity(directIntent) }

        val homeIntent = Intent(Intent.ACTION_MAIN).apply {
            addCategory(Intent.CATEGORY_HOME)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            putExtra("lockMessage", lockMessage)
        }
        runCatching { context.startActivity(homeIntent) }
    }

    private fun launchHomeScreen() {
        val intent = Intent(Intent.ACTION_MAIN).apply {
            addCategory(Intent.CATEGORY_HOME)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
        }
        runCatching { context.startActivity(intent) }
    }

    private fun managedHomeIntentFilter(): IntentFilter {
        return IntentFilter(Intent.ACTION_MAIN).apply {
            addCategory(Intent.CATEGORY_HOME)
            addCategory(Intent.CATEGORY_DEFAULT)
        }
    }

    private fun applyFrpPolicy(frpAccountsCsv: String) {
        if (!isDeviceOwner() || Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            return
        }

        val accounts = frpAccountsCsv
            .split(",")
            .map { it.trim().lowercase() }
            .filter { it.isNotEmpty() }
            .distinct()

        runCatching {
            if (accounts.isEmpty()) {
                dpm?.setFactoryResetProtectionPolicy(admin, null)
            } else {
                val policy = FactoryResetProtectionPolicy.Builder()
                    .setFactoryResetProtectionAccounts(accounts)
                    .setFactoryResetProtectionEnabled(true)
                    .build()
                dpm?.setFactoryResetProtectionPolicy(admin, policy)
            }
        }
    }
}
