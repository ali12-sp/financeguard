package com.financeguard.agent

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.telephony.TelephonyManager
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

data class RecoveryLocation(
    val latitude: Double,
    val longitude: Double,
    val accuracyMeters: Float?,
    val provider: String?,
    val capturedAt: String
)

data class TelemetrySnapshot(
    val uniqueId: String,
    val imeiDetected: String?,
    val serialDetected: String?,
    val batteryLevel: Int?,
    val batteryCharging: Boolean?,
    val networkStatus: String,
    val location: RecoveryLocation?
) {
    fun locationSummary(): String {
        return location?.let {
            "${"%.5f".format(it.latitude)}, ${"%.5f".format(it.longitude)} (${it.provider ?: "provider n/a"})"
        } ?: "No location yet"
    }

    fun batterySummary(): String {
        return batteryLevel?.let { level ->
            "$level%${if (batteryCharging == true) " charging" else ""}"
        } ?: "Battery unavailable"
    }
}

class DeviceTelemetry(
    private val context: Context
) {
    private val policyController = DevicePolicyController(context)

    fun collect(forceLocation: Boolean = false): TelemetrySnapshot {
        val location = if (forceLocation) currentLocation() ?: lastKnownLocation() else lastKnownLocation()

        return TelemetrySnapshot(
            uniqueId = policyController.stableDeviceId(),
            imeiDetected = detectedImei(),
            serialDetected = detectedSerial(),
            batteryLevel = batteryLevel(),
            batteryCharging = batteryCharging(),
            networkStatus = networkStatus(),
            location = location
        )
    }

    fun toJson(snapshot: TelemetrySnapshot, reason: String): JSONObject {
        return JSONObject().apply {
            put("uniqueId", snapshot.uniqueId)
            put("imeiDetected", snapshot.imeiDetected ?: JSONObject.NULL)
            put("serialDetected", snapshot.serialDetected ?: JSONObject.NULL)
            put("osVersion", Build.VERSION.RELEASE ?: "Unknown")
            put("appVersion", BuildConfig.VERSION_NAME)
            put("deviceOwnerPackage", if (policyController.isDeviceOwner()) context.packageName else JSONObject.NULL)
            put("batteryLevel", snapshot.batteryLevel ?: JSONObject.NULL)
            put("batteryCharging", snapshot.batteryCharging ?: JSONObject.NULL)
            put("networkStatus", snapshot.networkStatus)
            put("telemetryReason", reason)
            snapshot.location?.let { location ->
                put(
                    "location",
                    JSONObject().apply {
                        put("latitude", location.latitude)
                        put("longitude", location.longitude)
                        location.accuracyMeters?.let { put("accuracyMeters", it.toDouble()) }
                        put("provider", location.provider ?: "unknown")
                        put("capturedAt", location.capturedAt)
                    }
                )
            }
        }
    }

    fun saveToPreferences(snapshot: TelemetrySnapshot, identifierStatus: String? = null) {
        AgentPreferences.from(context).updateTelemetryCache(
            locationSummary = snapshot.locationSummary(),
            imeiDetected = snapshot.imeiDetected ?: "",
            serialDetected = snapshot.serialDetected ?: "",
            identifierStatus = identifierStatus ?: "",
            batterySummary = snapshot.batterySummary(),
            networkStatus = snapshot.networkStatus
        )
    }

    @SuppressLint("HardwareIds", "MissingPermission")
    private fun detectedImei(): String? {
        if (!hasPermission(Manifest.permission.READ_PHONE_STATE)) {
            return null
        }

        return runCatching {
            val telephony = context.getSystemService(TelephonyManager::class.java) ?: return null
            when {
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE -> telephony.primaryImei
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.O -> telephony.getImei(0)
                else -> @Suppress("DEPRECATION") telephony.deviceId
            }?.takeIf { it.isNotBlank() }
        }.getOrNull()
    }

    @SuppressLint("HardwareIds", "MissingPermission")
    private fun detectedSerial(): String? {
        return runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Build.getSerial()
            } else {
                @Suppress("DEPRECATION")
                Build.SERIAL
            }
        }.getOrNull()?.takeIf { it.isNotBlank() && it.lowercase() != "unknown" }
    }

    private fun batteryLevel(): Int? {
        val battery = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED)) ?: return null
        val level = battery.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
        val scale = battery.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
        if (level < 0 || scale <= 0) return null
        return ((level / scale.toFloat()) * 100).toInt().coerceIn(0, 100)
    }

    private fun batteryCharging(): Boolean? {
        val battery = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED)) ?: return null
        return when (battery.getIntExtra(BatteryManager.EXTRA_STATUS, -1)) {
            BatteryManager.BATTERY_STATUS_CHARGING,
            BatteryManager.BATTERY_STATUS_FULL -> true
            BatteryManager.BATTERY_STATUS_DISCHARGING,
            BatteryManager.BATTERY_STATUS_NOT_CHARGING -> false
            else -> null
        }
    }

    private fun networkStatus(): String {
        val manager = context.getSystemService(ConnectivityManager::class.java) ?: return "offline"
        val network = manager.activeNetwork ?: return "offline"
        val capabilities = manager.getNetworkCapabilities(network) ?: return "connected"
        val transports = buildList {
            if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) add("wifi")
            if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) add("cellular")
            if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) add("ethernet")
            if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) add("vpn")
        }
        return if (capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) {
            transports.ifEmpty { listOf("connected") }.joinToString("+")
        } else {
            "limited"
        }
    }

    @SuppressLint("MissingPermission")
    private fun lastKnownLocation(): RecoveryLocation? {
        if (!hasLocationPermission()) {
            return null
        }

        val manager = context.getSystemService(LocationManager::class.java) ?: return null
        return listOf(
            LocationManager.GPS_PROVIDER,
            LocationManager.NETWORK_PROVIDER,
            LocationManager.PASSIVE_PROVIDER
        )
            .mapNotNull { provider -> runCatching { manager.getLastKnownLocation(provider) }.getOrNull() }
            .maxByOrNull { it.time }
            ?.toRecoveryLocation()
    }

    @SuppressLint("MissingPermission")
    @Suppress("DEPRECATION")
    private fun currentLocation(timeoutSeconds: Long = 8): RecoveryLocation? {
        if (!hasLocationPermission()) {
            return null
        }

        val manager = context.getSystemService(LocationManager::class.java) ?: return null
        val provider = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
            .firstOrNull { candidate -> runCatching { manager.isProviderEnabled(candidate) }.getOrDefault(false) }
            ?: return lastKnownLocation()

        val latch = CountDownLatch(1)
        var location: Location? = null
        val listener = object : LocationListener {
            override fun onLocationChanged(value: Location) {
                location = value
                latch.countDown()
            }
        }

        Handler(Looper.getMainLooper()).post {
            runCatching {
                manager.requestSingleUpdate(provider, listener, Looper.getMainLooper())
            }.onFailure {
                latch.countDown()
            }
        }

        try {
            latch.await(timeoutSeconds, TimeUnit.SECONDS)
        } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
        } finally {
            Handler(Looper.getMainLooper()).post {
                runCatching { manager.removeUpdates(listener) }
            }
        }

        return location?.toRecoveryLocation() ?: lastKnownLocation()
    }

    private fun hasLocationPermission(): Boolean {
        return hasPermission(Manifest.permission.ACCESS_FINE_LOCATION) ||
            hasPermission(Manifest.permission.ACCESS_COARSE_LOCATION)
    }

    private fun hasPermission(permission: String): Boolean {
        return ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED
    }

    private fun Location.toRecoveryLocation(): RecoveryLocation {
        return RecoveryLocation(
            latitude = latitude,
            longitude = longitude,
            accuracyMeters = if (hasAccuracy()) accuracy else null,
            provider = provider,
            capturedAt = isoTimestamp(time.takeIf { it > 0 } ?: System.currentTimeMillis())
        )
    }

    private fun isoTimestamp(epochMillis: Long): String {
        return SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }.format(Date(epochMillis))
    }
}
