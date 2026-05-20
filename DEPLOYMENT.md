# FinanceGuard Deployment Checklist

## Minimum production setup

1. Use Node.js 22.5 or newer. For production, prefer the current Node.js 22 LTS line.
2. Set `NODE_ENV=production`.
3. Change `JWT_SECRET` to a long random value.
4. Set `PUBLIC_API_URL` to your real HTTPS API origin.
5. Set `CORS_ALLOWED_ORIGINS` to your real admin/customer web origins.
6. Use `PERSISTENCE_ENGINE=postgres` with `DATABASE_URL` for business rollout.
7. Keep automated backups enabled with `BACKUP_INTERVAL_MS`.
8. Configure real Firebase Cloud Messaging credentials.
9. Test Device Owner enrollment on spare phones before any customer rollout.

## Recommended API environment variables

```env
NODE_ENV=production
PORT=4000
JWT_SECRET=replace-this-with-a-long-random-secret
PUBLIC_API_URL=https://api.your-domain.com
CORS_ALLOWED_ORIGINS=https://app.your-domain.com
SCHEDULER_INTERVAL_MS=3600000
BACKUP_INTERVAL_MS=21600000
BODY_SIZE_LIMIT=1mb
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=300
AUTH_RATE_LIMIT_WINDOW_MS=900000
AUTH_RATE_LIMIT_MAX=15
PERSISTENCE_ENGINE=postgres
DATABASE_URL=postgres://financeguard:password@db-host:5432/financeguard
DATABASE_SSL_MODE=require
SMS_WEBHOOK_URL=
SMS_API_KEY=
SMS_SENDER_ID=FinanceGuard
EMAIL_WEBHOOK_URL=
EMAIL_API_KEY=
EMAIL_SENDER=alerts@your-domain.com
WHATSAPP_WEBHOOK_URL=
WHATSAPP_API_KEY=
WHATSAPP_SENDER_ID=FinanceGuard
FCM_PROJECT_ID=your-firebase-project-id
FCM_CLIENT_EMAIL=firebase-adminsdk@example.iam.gserviceaccount.com
FCM_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nreplace-with-firebase-private-key\n-----END PRIVATE KEY-----\n"
```

## First launch flow

1. Deploy the API and web admin.
2. Open the web app at `/setup`.
3. Create the first platform-owner account and first workspace.
4. Sign in with that account.
5. Use the `Workspaces` page to create each client tenant and its first admin login.
6. Open `Global Search` to verify cross-workspace lookup is working.
7. Open each workspace in `Workspaces`, confirm its default policy setup, and send a test registration alert.

## Recommended production path for this repo

This repo is now set up to deploy fastest through Docker Compose:

1. Copy `.env.production.example` to `.env.production`
2. Fill all required secrets and URLs
3. Run:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml build
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
```

Services included:

- `db`: PostgreSQL 16
- `api`: FinanceGuard API, scheduler, notification queue, and backup jobs
- `web`: Next.js admin/customer web server
- `proxy`: Nginx reverse proxy serving `/` and `/api`

Important:

- Set `PUBLIC_API_URL` to your real HTTPS origin such as `https://financeguard.example.com`
- Set `CORS_ALLOWED_ORIGINS` to your real web origin such as `https://financeguard.example.com`
- Keep `NEXT_PUBLIC_API_URL=/api` if you use the bundled Nginx reverse proxy

## Before onboarding real customers

1. Confirm `/api/health` is healthy.
2. Confirm `/api/health/ready` returns `200`.
3. Run `npm run verify:release` in CI or on a machine that allows Next.js build workers.
4. Run `npm run audit:prod` and review any remaining advisories before launch.
5. Create a manual backup with `npm run backup:api`.
6. Verify `/api/health` reports `"engine": "postgres"`.
7. Test platform-owner login.
8. Create a second workspace from the `Workspaces` page and verify that workspace login works.
9. Run one `Global Search` query against a known device IMEI or customer phone number.
10. Send one test registration alert from the workspace editor and verify email/SMS/WhatsApp webhook delivery.
11. Test customer portal login and first-login password change.
12. Test one lock flow, unlock flow, and sync command on a spare managed device.
13. Test payment posting, receipt/reference tracking, and automatic unlock.
14. Verify backup files are created under `apps/api/data/backups`.

## Rollout guidance

- SQLite is acceptable only for local development or internal staging.
- PostgreSQL is required by the production environment validation.
- Keep the bundled single API process while this project uses snapshot persistence. Split a separate worker only after the persistence layer is migrated to normalized relational tables.
- The platform owner console is now designed for a central operations team that manages many client workspaces from one deployment.
- Expand only after a real pilot confirms lock, unlock, backup, payment, enrollment, search, and alert flows are stable.
