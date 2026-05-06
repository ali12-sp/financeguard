# Production Hardening

This project now supports a stronger production deployment model than the original starter architecture.

## What is improved

- API and worker processes can be split.
- Notification delivery is queued and processed by the worker.
- Metrics endpoints are available for platform-owner monitoring:
  - `/api/metrics`
  - `/api/metrics/prometheus`
- Android release signing can be configured with `keystore.properties`.
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
- `api` service for request handling only
- `worker` service for scheduler, notification queue, and backup jobs
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

The system still persists the application state as collection snapshots in PostgreSQL/SQLite. That is acceptable for early production and pilot use, but the next major scale milestone should replace snapshot persistence with a normalized relational schema and migration-driven writes.
