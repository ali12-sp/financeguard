import type { DeviceRecord } from '../db/mock-db.js';

const STALE_SYNC_MS = 24 * 60 * 60 * 1000;

export function isDeviceSyncStale(device: Pick<DeviceRecord, 'lastSyncAt'>, now = new Date()) {
  if (!device.lastSyncAt) {
    return true;
  }

  return now.getTime() - Date.parse(device.lastSyncAt) > STALE_SYNC_MS;
}
