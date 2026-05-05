export {
  createBackupSnapshot,
  getPersistenceStatus,
  persistDb
} from './mock-db.js';

export function initializeDb() {
  // The SQLite-backed store initializes itself when mock-db is imported.
}
