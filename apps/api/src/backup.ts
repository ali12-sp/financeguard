import { createBackupSnapshot, getPersistenceStatus } from './db/mock-db.js';

const backupAt = await createBackupSnapshot();
const status = getPersistenceStatus();

console.log(
  JSON.stringify(
    {
      ok: true,
      backupAt,
      persistence: status
    },
    null,
    2
  )
);
