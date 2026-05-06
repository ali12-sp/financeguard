import fs from 'node:fs';
import path from 'node:path';
import { db, persistDb, type DatabaseRecord } from './db/mock-db.js';

const backupPath = process.argv[2];

if (!backupPath) {
  console.error('Usage: node dist/restore.js <path-to-backup-json>');
  process.exit(1);
}

const resolvedPath = path.resolve(backupPath);
if (!fs.existsSync(resolvedPath)) {
  console.error(`Backup file not found: ${resolvedPath}`);
  process.exit(1);
}

const snapshot = JSON.parse(fs.readFileSync(resolvedPath, 'utf8')) as DatabaseRecord;

db.tenants = snapshot.tenants ?? [];
db.users = snapshot.users ?? [];
db.customers = snapshot.customers ?? [];
db.guarantors = snapshot.guarantors ?? [];
db.devices = snapshot.devices ?? [];
db.contracts = snapshot.contracts ?? [];
db.installments = snapshot.installments ?? [];
db.payments = snapshot.payments ?? [];
db.auditLogs = snapshot.auditLogs ?? [];
db.deviceCommands = snapshot.deviceCommands ?? [];
db.reminderEvents = snapshot.reminderEvents ?? [];
db.notifications = snapshot.notifications ?? [];

await persistDb();

console.log(
  JSON.stringify(
    {
      ok: true,
      restoredFrom: resolvedPath,
      tenants: db.tenants.length,
      users: db.users.length,
      devices: db.devices.length,
      contracts: db.contracts.length,
      notifications: db.notifications.length
    },
    null,
    2
  )
);
