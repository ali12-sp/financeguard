package com.financeguard.agent

import android.content.Intent
import android.os.Bundle
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

class ProvisioningSuccessActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val title = TextView(this).apply {
            text = "Device enrollment complete"
            textSize = 24f
        }

        val copy = TextView(this).apply {
            text = "FinanceGuard is now configured as the device controller. Open the agent to confirm server registration and sync."
            textSize = 16f
        }

        val button = Button(this).apply {
            text = "Open FinanceGuard"
            setOnClickListener {
                startActivity(Intent(this@ProvisioningSuccessActivity, MainActivity::class.java))
                finish()
            }
        }

        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 80, 48, 48)
            addView(title)
            addView(copy)
            addView(button)
        }

        setContentView(container)
    }
}
