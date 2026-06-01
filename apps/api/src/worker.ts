import { env } from './config/env.js';
import { createBackupSnapshot } from './db/mock-db.js';
import { processQueuedNotifications } from './services/notifications.js';
import { runInstallmentScheduler } from './services/scheduler.js';
import { logger } from './services/logger.js';

async function runSchedulerPass() {
  const result = await runInstallmentScheduler();
  logger.info('Scheduler pass completed', result);
}

async function runNotificationPass() {
  const result = await processQueuedNotifications();
  if (result.processed > 0) {
    logger.info('Notification queue pass completed', result);
  }
}

async function runBackupPass() {
  const backupAt = await createBackupSnapshot();
  logger.info('Backup snapshot created', { backupAt });
}

logger.info('FinanceGuard worker started');

await runSchedulerPass().catch((error) => {
  logger.error('Initial scheduler run failed', error);
});

await runNotificationPass().catch((error) => {
  logger.error('Initial notification dispatch failed', error);
});

if (env.backupIntervalMs > 0) {
  await runBackupPass().catch((error) => {
    logger.error('Initial backup run failed', error);
  });
}

setInterval(() => {
  runSchedulerPass().catch((error) => {
    logger.error('Scheduled reminder run failed', error);
  });
}, env.schedulerIntervalMs);

setInterval(() => {
  runNotificationPass().catch((error) => {
    logger.error('Queued notification dispatch failed', error);
  });
}, env.notificationDispatchIntervalMs);

if (env.backupIntervalMs > 0) {
  setInterval(() => {
    runBackupPass().catch((error) => {
      logger.error('Scheduled backup run failed', error);
    });
  }, env.backupIntervalMs);
}
