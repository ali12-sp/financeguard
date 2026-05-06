import { env } from './config/env.js';
import { createBackupSnapshot } from './db/mock-db.js';
import { processQueuedNotifications } from './services/notifications.js';
import { runInstallmentScheduler } from './services/scheduler.js';

async function runSchedulerPass() {
  const result = await runInstallmentScheduler();
  console.log('Scheduler pass completed', result);
}

async function runNotificationPass() {
  const result = await processQueuedNotifications();
  if (result.processed > 0) {
    console.log('Notification queue pass completed', result);
  }
}

async function runBackupPass() {
  const backupAt = await createBackupSnapshot();
  console.log('Backup snapshot created', { backupAt });
}

console.log('FinanceGuard worker started');

await runSchedulerPass().catch((error) => {
  console.error('Initial scheduler run failed', error);
});

await runNotificationPass().catch((error) => {
  console.error('Initial notification dispatch failed', error);
});

if (env.backupIntervalMs > 0) {
  await runBackupPass().catch((error) => {
    console.error('Initial backup run failed', error);
  });
}

setInterval(() => {
  runSchedulerPass().catch((error) => {
    console.error('Scheduled reminder run failed', error);
  });
}, env.schedulerIntervalMs);

setInterval(() => {
  runNotificationPass().catch((error) => {
    console.error('Queued notification dispatch failed', error);
  });
}, env.notificationDispatchIntervalMs);

if (env.backupIntervalMs > 0) {
  setInterval(() => {
    runBackupPass().catch((error) => {
      console.error('Scheduled backup run failed', error);
    });
  }, env.backupIntervalMs);
}
