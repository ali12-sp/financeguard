# FinanceGuard Setup Guide

This guide explains how to run the full financed-device control system as a real business platform:

- admin dashboard
- backend API and scheduler
- Android Device Owner agent
- FCM command delivery
- SMS reminder fallback
- ADB and QR enrollment
- multi-workspace operator model
- platform-owner notifications and cross-workspace search

## 1. What The System Does

FinanceGuard is built for company-controlled Android phones sold on installments.

The current flow is:

1. Admin creates a financed customer, phone, and contract from the web dashboard.
2. Backend scheduler checks due dates and queues reminders:
   - 5 days before due date
   - 2 days before due date
   - on due date
3. If payment remains unpaid beyond the grace period, the backend queues a lock command.
4. Android agent receives the command by FCM when configured, or by sync polling fallback.
5. When payment is posted, backend queues an unlock command.
6. Android agent clears the restriction and syncs again.

## 2. Project Layout

- `apps/api`: Node.js + Express backend and scheduler
- `apps/web-admin`: Next.js admin dashboard
- `apps/android-agent`: Kotlin Device Owner agent
- `docs/SETUP_GUIDE.md`: this guide

## 3. Backend Environment

Create or update `apps/api/.env`:

```env
PORT=4000
JWT_SECRET=change-me
PUBLIC_API_URL=http://localhost:4000
SCHEDULER_INTERVAL_MS=3600000
BACKUP_INTERVAL_MS=21600000
BODY_SIZE_LIMIT=1mb
CORS_ALLOWED_ORIGINS=http://localhost:3000
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=300
AUTH_RATE_LIMIT_WINDOW_MS=900000
AUTH_RATE_LIMIT_MAX=15

SMS_WEBHOOK_URL=
SMS_API_KEY=
SMS_SENDER_ID=FinanceGuard

FCM_PROJECT_ID=
FCM_CLIENT_EMAIL=
FCM_PRIVATE_KEY=
```

Notes:

- `PUBLIC_API_URL` is used in provisioning payloads and Android enrollment config.
- `FCM_*` values must come from a Firebase service account with Cloud Messaging access.
- `SMS_WEBHOOK_URL` is optional. If empty, SMS reminders are recorded as skipped.

## 4. Web Environment

Create or update `apps/web-admin/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:4000/api
```

## 5. Start The System

From the repo root:

```powershell
npm install
npm run dev:api
```

Open a second terminal:

```powershell
npm run dev:web
```

Open:

- Admin panel: `http://localhost:3000`
- API health: `http://localhost:4000/api/health`

Initialize the platform at:

- `http://localhost:3000/setup`

This creates:

- the first platform-owner admin account
- the first workspace / tenant
- the workspace slug used during future sign-ins

After setup, sign in and use the `Workspaces` page to create additional client tenants.

## 6. How To Use The Admin Panel

### Onboard a financed customer

Go to `Customers` and fill:

- customer name, phone, CNIC, address
- device model, serial, IMEI
- total phone price
- advance payment
- monthly installment
- total months
- due day
- grace days
- start date

This creates:

- customer
- managed device shell
- installment contract
- installment schedule

### Record payment

Go to `Payments` and:

- choose contract
- enter principal amount
- enter late fee if any
- submit payment

The backend:

- allocates payment to installments
- recalculates restriction state
- queues an unlock command when needed

### Lock or unlock a device manually

Go to `Devices` and use:

- `Lock`
- `Unlock`

These actions create device commands and audit logs.

### Run the scheduler manually

Go to `Dashboard` and click `Run Scheduler Now`.

This forces:

- reminder generation
- overdue lock checks
- unlock checks after payment status changes

## 7. Backend APIs

Main admin APIs:

- `GET /api/setup/status`
- `POST /api/setup/initialize`
- `POST /api/auth/login`
- `GET /api/platform/workspaces`
- `POST /api/platform/workspaces`
- `PATCH /api/platform/workspaces/:id`
- `POST /api/customers/onboard`
- `POST /api/payments`
- `POST /api/devices/:id/state`
- `POST /api/devices/:id/commands`
- `POST /api/policies/recompute`
- `GET /api/devices/:id/provisioning`

Android agent APIs:

- `POST /api/agent/register`
- `POST /api/agent/sync`
- `POST /api/agent/commands/:id/ack`

## 8. Android Agent Setup

Open `apps/android-agent` in Android Studio.

### What the agent already includes

- Device Owner receiver
- provisioning mode activity
- policy compliance activity
- provisioning success activity
- periodic sync worker
- FCM service
- restricted-mode screen
- server register/sync/ack flow

### Firebase setup

1. Create a Firebase project.
2. Add Android app package: `com.financeguard.agent`
3. Download `google-services.json`
4. Place it in:

`apps/android-agent/app/google-services.json`

If `google-services.json` is missing, the app still keeps polling support, but FCM push delivery will not work.

### Build APK

Recommended path: open `apps/android-agent` in Android Studio and use:

- `Build` -> `Build Bundle(s) / APK(s)` -> `Build APK(s)`

APK output:

`apps/android-agent/app/build/outputs/apk/debug/app-debug.apk`

If you prefer CLI builds, first generate a Gradle wrapper from Android Studio or a machine that already has Gradle installed, then run:

```powershell
.\gradlew.bat assembleDebug
```

Release build:

```powershell
.\gradlew.bat assembleRelease
```

## 9. ADB Device Owner Enrollment

Use this only on a fresh or factory-reset test device.

### Steps

1. Enable developer options and USB debugging.
2. Install the APK:

```powershell
adb install app-debug.apk
```

3. Set device owner:

```powershell
adb shell dpm set-device-owner com.financeguard.agent/.FinanceGuardDeviceAdminReceiver
```

4. Launch the app and verify:

- Device Owner shows `true`
- API URL and agent secret are configured
- registration succeeds

Important:

- `set-device-owner` only works on an unprovisioned device.
- If the command fails, factory reset the device and try again.

## 10. QR Enrollment For Android Enterprise

For your current business model, **QR Device Owner enrollment is the main production path**.
You do not need zero-touch yet, but you do need:

- factory reset
- Device Owner provisioning
- QR enrollment during setup

### Provisioning payload source

Call:

`GET /api/devices/:id/provisioning`

The response includes:

- device ID
- agent secret
- API base URL
- admin extras bundle
- sample ADB command

### QR payload contents

Your QR code must include at least:

- Device admin component
- APK download URL on HTTPS
- APK SHA-256 checksum
- admin extras bundle with:
  - `apiBaseUrl`
  - `agentSecret`
  - `deviceId`
  - `organizationId`
  - `organizationName`

Typical admin extras bundle values:

```json
{
  "apiBaseUrl": "https://your-api.example.com",
  "agentSecret": "FG-1234",
  "deviceId": "d1",
  "organizationId": "client-workspace",
  "organizationName": "Client Workspace"
}
```

### Enrollment reminder

Android 12 and later require DPCs to implement:

- provisioning mode activity
- admin policy compliance activity

This project already includes both.

## 11. Factory Reset Survival

No legitimate app survives a factory reset by itself.

The correct Android Enterprise pattern is:

1. use Device Owner provisioning
2. use QR or zero-touch enrollment
3. re-enroll automatically after reset through enterprise provisioning

That is the official and supportable way to restore management after reset.

## 12. Lock / Unlock Behavior On Device

When restricted:

- backend queues a `LOCK` command
- agent stores the restricted state
- agent sets device-owner lock screen info
- agent opens the restricted screen
- agent calls `lockNow()`

When paid:

- backend records payment
- backend queues an `UNLOCK` command
- agent clears lock screen owner info
- agent returns to normal app state

## 13. Production Deployment

### Recommended path

Use the Docker production stack in this repo:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml build
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
```

This gives you:

- PostgreSQL
- API container with scheduler, notification queue, and backup jobs
- web container
- Nginx reverse proxy

Use Node.js 22.5 or newer for production if you deploy without Docker.

## 14. SMS Fallback

If `SMS_WEBHOOK_URL` is configured, the scheduler will POST:

```json
{
  "to": "03001234567",
  "message": "Reminder text here",
  "senderId": "FinanceGuard"
}
```

You can connect this to:

- local SMS gateway
- Twilio bridge
- custom Pakistan SMS provider adapter

## 15. Optional WhatsApp Integration

This project does not directly send WhatsApp messages yet.

Recommended production path:

- Meta WhatsApp Cloud API
- or a provider such as Twilio WhatsApp

Suggested trigger points:

- 5 day reminder
- 2 day reminder
- due date warning
- payment received confirmation
- lock warning before restriction

## 16. Operations Notes

Use this platform like an operator console:

1. your team signs in as the platform owner
2. each shopkeeper gets one workspace
3. each financed phone must be enrolled before delivery
4. registration alerts should be tested per workspace before live onboarding
5. cross-workspace search should be used for support, fraud checks, and recovery operations

For the exact non-zero-touch rollout steps, use:

- [Device Enrollment Runbook](./DEVICE_ENROLLMENT_RUNBOOK.md)
