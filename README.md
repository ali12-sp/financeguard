# FinanceGuard

FinanceGuard is a **consent-based financed Android device control system** built around the official **Android Enterprise Device Owner** model for company-controlled phones.

It includes:

- web admin dashboard
- backend API and scheduler
- Android Device Owner agent
- reminder, lock, and unlock workflows
- FCM command delivery hooks
- SMS fallback hooks
- provisioning payload support for QR and ADB enrollment

## Project structure

- `apps/api` - Express + TypeScript backend
- `apps/web-admin` - Next.js admin dashboard
- `apps/android-agent` - Kotlin Android Device Owner agent
- `packages/shared` - shared types
- `docs/SETUP_GUIDE.md` - full setup, deployment, build, and enrollment guide

## Tech stack

- **Web Admin:** Next.js, TypeScript, Tailwind-ready structure
- **API:** Node.js, Express, TypeScript, workspace-aware business APIs
- **DB:** SQLite by default, or PostgreSQL with the same multi-tenant data model
- **Android:** Kotlin
- **Auth:** JWT with first-run platform-owner setup and workspace-aware login
- **Realtime / sync:** scheduler, polling fallback, FCM hooks

## Quick start

### 1. Install Node.js
Use Node.js 20.9 or newer. For production, prefer Node.js 22 LTS.

### 2. Install dependencies
```bash
npm install
```

### 3. Start the API
```bash
npm run dev:api
```

API runs on `http://localhost:4000`

### 4. Start the web admin
Open a second terminal:
```bash
npm run dev:web
```

Web app runs on `http://localhost:3000`

### 5. Initialize the first workspace

Open the web app and complete the first-run setup flow at:

- `http://localhost:3000/setup`

This creates:

- the first tenant / workspace
- the first platform-owner admin account
- the workspace slug used for future sign-ins

After that, sign in and use the `Workspaces` page to create additional client tenants from the same deployment.

## Environment files

Create this file:

### `apps/api/.env`
```env
PORT=4000
JWT_SECRET=change-me
PUBLIC_API_URL=http://localhost:4000
SCHEDULER_INTERVAL_MS=3600000
PERSISTENCE_ENGINE=sqlite
DATABASE_URL=
DATABASE_SSL_MODE=disable
SMS_WEBHOOK_URL=
SMS_API_KEY=
SMS_SENDER_ID=FinanceGuard
EMAIL_WEBHOOK_URL=
EMAIL_API_KEY=
EMAIL_SENDER=alerts@financeguard.local
WHATSAPP_WEBHOOK_URL=
WHATSAPP_API_KEY=
WHATSAPP_SENDER_ID=FinanceGuard
FCM_PROJECT_ID=
FCM_CLIENT_EMAIL=
FCM_PRIVATE_KEY=
```

### `apps/web-admin/.env.local`
```env
NEXT_PUBLIC_API_URL=http://localhost:4000/api
```

### Production deployment

The fastest business-ready deployment path in this repo is:

1. copy `.env.production.example` to `.env.production`
2. fill PostgreSQL, JWT, domain, FCM, and alert-provider values
3. run:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml build
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
```

This stack includes:

- PostgreSQL
- API container
- web admin container
- Nginx reverse proxy

## What works now

- first-run platform-owner setup
- multi-tenant workspace management from the admin app
- cross-workspace global search for IMEI, phone, customer, contract, and workspace
- tenant-aware login
- onboard financed customers with phone + installment plan
- persistent backend data in SQLite or PostgreSQL
- record payments
- automatic reminder and overdue-lock scheduler
- manual lock / unlock from dashboard
- Android agent registration and sync endpoints
- provisioning payload endpoint for Android enrollment
- audit logs, command logs, notification logs
- external registration alerts by email, SMS, and WhatsApp webhook integrations
- editable workspace defaults with test-alert delivery from the platform owner console
- Docker production stack with PostgreSQL and reverse-proxy routing

## Android note

The Android app is designed for the **official managed-device path** only:

- Device Owner
- Android Enterprise provisioning
- ADB test enrollment
- QR enrollment

It does **not** rely on deprecated legacy Device Admin activation for normal end users.

## Full guide

Read the full setup and enrollment instructions here:

- [Setup Guide](./docs/SETUP_GUIDE.md)

## Recommended production next steps

1. connect real Firebase and SMS provider credentials
2. add release signing for the Android app
3. host the APK on HTTPS for QR enrollment
4. add zero-touch enrollment for bulk rollout
5. add a background worker process if you want notification fan-out and scheduler work separated from the API
6. enable HTTPS on your front proxy or cloud load balancer before onboarding real customers
