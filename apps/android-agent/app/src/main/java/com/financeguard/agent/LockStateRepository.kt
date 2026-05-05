package com.financeguard.agent

enum class DeviceState {
    ACTIVE,
    REMINDER,
    GRACE,
    RESTRICTED,
    RELEASED
}

class LockStateRepository {
    fun shouldRestrict(state: DeviceState): Boolean {
        return state == DeviceState.RESTRICTED
    }

    fun fromServer(value: String?): DeviceState {
        return DeviceState.entries.firstOrNull { it.name == value } ?: DeviceState.ACTIVE
    }

    fun statusLabel(state: DeviceState): String {
        return when (state) {
            DeviceState.ACTIVE -> "Active and paid"
            DeviceState.REMINDER -> "Upcoming payment reminder"
            DeviceState.GRACE -> "Inside grace period"
            DeviceState.RESTRICTED -> "Restricted for missed payment"
            DeviceState.RELEASED -> "Installment plan completed"
        }
    }
}
