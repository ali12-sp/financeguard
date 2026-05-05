package com.financeguard.agent

import android.os.Bundle
import android.view.KeyEvent
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

class RestrictionActivity : AppCompatActivity() {
    private lateinit var status: TextView
    private lateinit var lockMessageView: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val title = TextView(this).apply {
            text = "Device access restricted"
            textSize = 24f
        }

        status = TextView(this).apply {
            textSize = 16f
        }

        lockMessageView = TextView(this).apply {
            textSize = 18f
        }

        val syncButton = Button(this).apply {
            text = "I have paid - check again"
            setOnClickListener {
                status.text = "Checking payment status with server..."
                SyncScheduler.runImmediate(this@RestrictionActivity)
            }
        }

        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 80, 48, 48)
            addView(title)
            addView(lockMessageView)
            addView(status)
            addView(syncButton)
        }

        setContentView(container)
        refresh()
    }

    override fun onResume() {
        super.onResume()
        refresh()
        runCatching { startLockTask() }
    }

    override fun onBackPressed() {
        if (AgentPreferences.from(this).snapshot().currentState != DeviceState.RESTRICTED) {
            super.onBackPressed()
        }
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (
            AgentPreferences.from(this).snapshot().currentState == DeviceState.RESTRICTED &&
            event.action == KeyEvent.ACTION_DOWN &&
            (event.keyCode == KeyEvent.KEYCODE_VOLUME_DOWN || event.keyCode == KeyEvent.KEYCODE_VOLUME_UP)
        ) {
            return true
        }

        return super.dispatchKeyEvent(event)
    }

    private fun refresh() {
        val snapshot = AgentPreferences.from(this).snapshot()
        if (snapshot.currentState != DeviceState.RESTRICTED) {
            runCatching { stopLockTask() }
            finish()
            return
        }

        lockMessageView.text = snapshot.lockMessage.ifBlank {
            intent.getStringExtra("lockMessage")
                ?: "Installment overdue. Please contact the shop after payment."
        }
        status.text = "Customer: ${snapshot.customerName.ifBlank { "Unassigned" }}\nContract: ${snapshot.contractId.ifBlank { "Pending" }}"
    }
}
