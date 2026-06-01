import fs from 'node:fs';
import path from 'node:path';
import { db, persistDb, type DatabaseRecord } from './db/mock-db.js';
import { decryptBackup, isEncryptedBackup } from './services/backup-crypto.js';
import { logger } from './services/logger.js';

const backupPath = process.argv[2];

if (!backupPath) {
  logger.error('Usage: node dist/restore.js <path-to-backup.fgb-or-backup.json>');
  process.exit(1);
}

const resolvedPath = path.resolve(backupPath);
if (!fs.existsSync(resolvedPath)) {
  logger.error(`Backup file not found: ${resolvedPath}`);
  process.exit(1);
}

const raw = fs.readFileSync(resolvedPath);
let json: string;

if (isEncryptedBackup(raw)) {
  logger.info('Detected encrypted backup – decrypting…');
  try {
    json = decryptBackup(raw);
  } catch (err) {
    logger.error('Failed to decrypt backup. Check JWT_SECRET / BACKUP_ENCRYPTION_KEY.', err);
    process.exit(1);
  }
} else {
  logger.info('Detected plain-text JSON backup – loading directly.');
  json = raw.toString('utf8');
}

const snapshot = JSON.parse(json) as DatabaseRecord;

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

logger.info('Restore completed', {
  restoredFrom: resolvedPath,
  tenants: db.tenants.length,
  users: db.users.length,
  devices: db.devices.length,
  contracts: db.contracts.length,
  notifications: db.notifications.length
});
