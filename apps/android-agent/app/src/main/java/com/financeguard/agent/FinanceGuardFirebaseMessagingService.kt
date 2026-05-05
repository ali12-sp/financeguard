package com.financeguard.agent

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class FinanceGuardFirebaseMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        AgentPreferences.from(this).updatePushToken(token)
        SyncScheduler.runImmediate(this)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        if (message.data.isEmpty()) return

        NotificationHelper.ensureChannel(this)
        CommandProcessor(this).processRemoteData(message.data)
    }
}
