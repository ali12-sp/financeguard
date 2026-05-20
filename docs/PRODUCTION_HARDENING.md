# Production Hardening

This project now supports a stronger production deployment model than the original starter architecture.

## What is improved

- Scheduler, notification queue, and backups run inside the production API process to avoid snapshot persistence races.
- API and worker processes should be split only after the database layer is normalized.
- Notification delivery is queued and processed by background jobs.
- Temporary admin/customer credentials require a first-login password change.
- Device enrollment secrets are high-entropy crypto tokens.
- Payments support method, reference number, and receipt URL tracking.
- Dashboard summaries include stale-device counts for phones that have not synced in 24 hours.
- Metrics endpoints are available for platform-owner monitoring:
  - `/api/metrics`
  - `/api/metrics/prometheus`
- Android release signing can be configured with `keystore.properties`.
- Android release builds disable cleartext traffic and app backup.
- Workspace settings now support:
  - agent APK URL
  - agent APK checksum
  - FRP Google accounts
- Backup restore is available with:

```bash
npm --workspace apps/api run restore -- ./apps/api/data/backups/financeguard-<timestamp>.json
```

## Recommended production topology

- `web` service for Next.js admin
- `api` service for request handling, scheduler, notification queue, and backup jobs
- `postgres` for persistence
- reverse proxy / HTTPS terminator

## Android release signing

1. Copy:

```text
apps/android-agent/keystore.properties.example
```

to:

```text
apps/android-agent/keystore.properties
```

2. Fill:

- `storeFile`
- `storePassword`
- `keyAlias`
- `keyPassword`

3. Build release APK from Android Studio or Gradle.

## Backup restore drill

Run a restore drill before live rollout:

1. Create a backup.
2. Copy the backup file to a safe test location.
3. Restore into a non-production environment.
4. Verify:
   - platform owner login
   - workspace counts
   - device list
   - contract list
   - payment list

## Remaining major architecture milestone

The system still persists the application state as collection snapshots in PostgreSQL/SQLite. The production Compose setup keeps writes in one API process to reduce lost-update risk, but the next major scale milestone should replace snapshot persistence with a normalized relational schema, row-level writes, and migration-driven schema changes before scaling horizontally.
