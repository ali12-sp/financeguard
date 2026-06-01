import {
  addAuditLog,
  db,
  persistDb,
  type DeviceCommandRecord,
  type DeviceRecord
} from '../db/mock-db.js';
import { type ActorInfo, issueDeviceCommand } from './device-control.js';

export interface DeletionResult {
  deleted: boolean;
  releaseQueued: boolean;
  message: string;
  pendingDeviceIds?: string[];
}

function actorName(actor?: ActorInfo) {
  return actor?.name ?? actor?.email ?? 'System';
}

function actorId(actor?: ActorInfo) {
  return actor?.id ?? 'system';
}

function hasAcknowledgedReleaseAfterLastSync(device: DeviceRecord) {
  const latestAcknowledgedRelease = db.deviceCommands
    .filter((item) =>
      item.deviceId === device.id &&
      item.type === 'RELEASE_CONTROL' &&
      item.status === 'ACKNOWLEDGED'
    )
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .at(0);

  if (!latestAcknowledgedRelease?.acknowledgedAt) {
    return false;
  }

  return !device.lastSyncAt || latestAcknowledgedRelease.acknowledgedAt >= device.lastSyncAt;
}

function needsControlRelease(device: DeviceRecord) {
  if (pendingReleaseCommand(device.id)) {
    return true;
  }

  if (device.enrollmentStatus === 'ENROLLED') {
    return true;
  }

  if (device.state === 'RELEASED' && hasAcknowledgedReleaseAfterLastSync(device)) {
    return false;
  }

  return Boolean(
    device.uniqueId ||
    device.pushToken ||
    device.deviceOwnerPackage ||
    device.lastSyncAt
  );
}

function canQueueReleaseCommand(device: DeviceRecord) {
  return Boolean(
    pendingReleaseCommand(device.id) ||
    device.enrollmentStatus === 'ENROLLED' ||
    device.uniqueId ||
    device.pushToken ||
    device.deviceOwnerPackage ||
    device.lastSyncAt
  );
}

function removeContractRecords(contractIds: Set<string>) {
  if (contractIds.size === 0) return;

  db.installments = db.installments.filter((item) => !contractIds.has(item.contractId));
  db.payments = db.payments.filter((item) => !contractIds.has(item.contractId));
  db.reminderEvents = db.reminderEvents.filter((item) => !contractIds.has(item.contractId));
  db.notifications = db.notifications.filter((item) => !item.contractId || !contractIds.has(item.contractId));
  db.auditLogs = db.auditLogs.filter((item) => !contractIds.has(item.entityId));
  db.contracts = db.contracts.filter((item) => !contractIds.has(item.id));
}

function removeDeviceNow(deviceId: string) {
  const device = db.devices.find((item) => item.id === deviceId);
  if (!device) return;

  const contractIds = new Set(
    db.contracts
      .filter((contract) => contract.deviceId === deviceId)
      .map((contract) => contract.id)
  );

  for (const contractId of contractIds) {
    for (const guarantor of db.guarantors) {
      if (guarantor.contractId === contractId) {
        guarantor.contractId = undefined;
      }
    }
  }

  removeContractRecords(contractIds);
  db.deviceCommands = db.deviceCommands.filter((item) => item.deviceId !== deviceId);
  db.notifications = db.notifications.filter((item) => item.deviceId !== deviceId);
  db.reminderEvents = db.reminderEvents.filter((item) => item.deviceId !== deviceId);
  db.auditLogs = db.auditLogs.filter((item) => item.entityId !== deviceId);
  db.devices = db.devices.filter((item) => item.id !== deviceId);
}

function linkedDeviceIdsForCustomer(customerId: string) {
  const ids = new Set<string>();

  for (const device of db.devices) {
    if (device.assignedCustomerId === customerId) {
      ids.add(device.id);
    }
  }

  for (const contract of db.contracts) {
    if (contract.customerId === customerId) {
      ids.add(contract.deviceId);
    }
  }

  return ids;
}

function removeCustomerNow(customerId: string) {
  const deviceIds = linkedDeviceIdsForCustomer(customerId);
  for (const deviceId of deviceIds) {
    removeDeviceNow(deviceId);
  }

  const remainingContractIds = new Set(
    db.contracts
      .filter((contract) => contract.customerId === customerId)
      .map((contract) => contract.id)
  );
  removeContractRecords(remainingContractIds);

  db.guarantors = db.guarantors.filter((item) => item.customerId !== customerId);
  db.users = db.users.filter((item) => item.customerId !== customerId);
  db.auditLogs = db.auditLogs.filter((item) => item.entityId !== customerId);
  db.notifications = db.notifications.filter((item) => item.customerId !== customerId);
  db.customers = db.customers.filter((item) => item.id !== customerId);
}

function removeWorkspaceNow(tenantId: string) {
  db.tenants = db.tenants.filter((item) => item.id !== tenantId);
  db.users = db.users.filter((item) => item.tenantId !== tenantId);
  db.customers = db.customers.filter((item) => item.tenantId !== tenantId);
  db.guarantors = db.guarantors.filter((item) => item.tenantId !== tenantId);
  db.devices = db.devices.filter((item) => item.tenantId !== tenantId);
  db.contracts = db.contracts.filter((item) => item.tenantId !== tenantId);
  db.installments = db.installments.filter((item) => item.tenantId !== tenantId);
  db.payments = db.payments.filter((item) => item.tenantId !== tenantId);
  db.auditLogs = db.auditLogs.filter((item) => item.tenantId !== tenantId);
  db.deviceCommands = db.deviceCommands.filter((item) => item.tenantId !== tenantId);
  db.reminderEvents = db.reminderEvents.filter((item) => item.tenantId !== tenantId);
  db.notifications = db.notifications.filter((item) => item.tenantId !== tenantId);
}

function pendingReleaseCommand(deviceId: string) {
  return db.deviceCommands.find(
    (item) =>
      item.deviceId === deviceId &&
      item.type === 'RELEASE_CONTROL' &&
      item.status !== 'ACKNOWLEDGED'
  ) ?? null;
}

async function queueReleaseControl(options: {
  device: DeviceRecord;
  reason: string;
  actor?: ActorInfo;
  deleteAfterAck?: {
    scope: NonNullable<DeviceRecord['pendingDeletionScope']>;
    parentId: string;
  };
}) {
  const now = new Date().toISOString();
  const { device } = options;

  device.state = 'RELEASED';
  device.adminLocked = false;
  device.adminUnlocked = false;
  device.restrictionReason = undefined;
  device.lostModeEnabled = false;
  device.lostModeMessage = undefined;
  device.locationRequestPending = false;

  if (options.deleteAfterAck) {
    device.pendingDeletion = true;
    device.deletionRequestedAt = now;
    device.deletionReason = options.reason;
    device.pendingDeletionScope = options.deleteAfterAck.scope;
    device.pendingDeletionParentId = options.deleteAfterAck.parentId;
  }

  const existing = pendingReleaseCommand(device.id);
  if (existing) {
    await persistDb();
    return existing;
  }

  addAuditLog({
    tenantId: device.tenantId,
    actorUserId: actorId(options.actor),
    actorName: actorName(options.actor),
    action: 'DEVICE_CONTROL_RELEASE_REQUESTED',
    entityType: 'DEVICE',
    entityId: device.id,
    reason: options.reason,
    details: options.deleteAfterAck
      ? 'Device Owner control will be removed before this record is deleted.'
      : 'Device Owner control release was requested from the dashboard.'
  });

  return issueDeviceCommand({
    deviceId: device.id,
    type: 'RELEASE_CONTROL',
    reason: options.reason,
    source: 'ADMIN',
    payload: {
      deleteAfterAck: Boolean(options.deleteAfterAck)
    }
  });
}

export async function requestDeviceControlRelease(options: {
  deviceId: string;
  reason: string;
  actor?: ActorInfo;
}) {
  const device = db.devices.find((item) => item.id === options.deviceId);
  if (!device) {
    throw new Error('Device not found');
  }

  if (!canQueueReleaseCommand(device)) {
    device.state = 'RELEASED';
    device.enrollmentStatus = 'SUSPENDED';
    device.adminLocked = false;
    device.adminUnlocked = false;
    device.restrictionReason = undefined;
    device.pushToken = undefined;
    device.deviceOwnerPackage = undefined;
    device.lostModeEnabled = false;
    device.lostModeMessage = undefined;
    device.locationRequestPending = false;
    await persistDb();
    return { released: true, command: null as DeviceCommandRecord | null };
  }

  const command = await queueReleaseControl({
    device,
    reason: options.reason,
    actor: options.actor
  });

  return { released: false, command };
}

export async function requestDeviceDeletion(options: {
  deviceId: string;
  reason: string;
  actor?: ActorInfo;
  scope?: NonNullable<DeviceRecord['pendingDeletionScope']>;
  parentId?: string;
}): Promise<DeletionResult> {
  const device = db.devices.find((item) => item.id === options.deviceId);
  if (!device) {
    throw new Error('Device not found');
  }

  if (needsControlRelease(device)) {
    await queueReleaseControl({
      device,
      reason: options.reason,
      actor: options.actor,
      deleteAfterAck: {
        scope: options.scope ?? 'DEVICE',
        parentId: options.parentId ?? device.id
      }
    });

    return {
      deleted: false,
      releaseQueued: true,
      message: 'Release-control command queued. The record will be deleted after the phone syncs and acknowledges it.',
      pendingDeviceIds: [device.id]
    };
  }

  removeDeviceNow(device.id);
  await persistDb();
  return {
    deleted: true,
    releaseQueued: false,
    message: 'Device deleted.'
  };
}

export async function requestCustomerDeletion(options: {
  customerId: string;
  reason: string;
  actor?: ActorInfo;
}): Promise<DeletionResult> {
  const customer = db.customers.find((item) => item.id === options.customerId);
  if (!customer) {
    throw new Error('Customer not found');
  }

  const pendingDeviceIds: string[] = [];
  customer.pendingDeletion = true;
  customer.deletionRequestedAt = new Date().toISOString();
  customer.deletionReason = options.reason;

  for (const deviceId of linkedDeviceIdsForCustomer(customer.id)) {
    const device = db.devices.find((item) => item.id === deviceId);
    if (!device) continue;

    if (needsControlRelease(device)) {
      await requestDeviceDeletion({
        deviceId: device.id,
        reason: options.reason,
        actor: options.actor,
        scope: 'CUSTOMER',
        parentId: customer.id
      });
      pendingDeviceIds.push(device.id);
    } else {
      removeDeviceNow(device.id);
    }
  }

  if (pendingDeviceIds.length > 0) {
    await persistDb();
    return {
      deleted: false,
      releaseQueued: true,
      message: 'Customer deletion is waiting for registered phone control to be released.',
      pendingDeviceIds
    };
  }

  removeCustomerNow(customer.id);
  await persistDb();
  return {
    deleted: true,
    releaseQueued: false,
    message: 'Customer deleted.'
  };
}

export async function requestGuarantorDeletion(options: {
  guarantorId: string;
  reason: string;
  actor?: ActorInfo;
}): Promise<DeletionResult> {
  const guarantor = db.guarantors.find((item) => item.id === options.guarantorId);
  if (!guarantor) {
    throw new Error('Guarantor not found');
  }

  for (const contract of db.contracts) {
    contract.guarantorIds = contract.guarantorIds.filter((id) => id !== guarantor.id);
  }

  db.auditLogs = db.auditLogs.filter((item) => item.entityId !== guarantor.id);
  db.guarantors = db.guarantors.filter((item) => item.id !== guarantor.id);
  await persistDb();

  return {
    deleted: true,
    releaseQueued: false,
    message: 'Guarantor deleted.'
  };
}

export async function requestWorkspaceDeletion(options: {
  tenantId: string;
  reason: string;
  actor?: ActorInfo;
}): Promise<DeletionResult> {
  const tenant = db.tenants.find((item) => item.id === options.tenantId);
  if (!tenant) {
    throw new Error('Workspace not found');
  }

  if (db.users.some((item) => item.tenantId === tenant.id && item.isPlatformOwner)) {
    throw new Error('You cannot delete the workspace that owns platform access.');
  }

  const pendingDeviceIds: string[] = [];
  tenant.pendingDeletion = true;
  tenant.status = 'SUSPENDED';
  tenant.deletionRequestedAt = new Date().toISOString();
  tenant.deletionReason = options.reason;

  for (const device of db.devices.filter((item) => item.tenantId === tenant.id)) {
    if (needsControlRelease(device)) {
      await requestDeviceDeletion({
        deviceId: device.id,
        reason: options.reason,
        actor: options.actor,
        scope: 'WORKSPACE',
        parentId: tenant.id
      });
      pendingDeviceIds.push(device.id);
    } else {
      removeDeviceNow(device.id);
    }
  }

  if (pendingDeviceIds.length > 0) {
    await persistDb();
    return {
      deleted: false,
      releaseQueued: true,
      message: 'Workspace deletion is waiting for registered phone control to be released.',
      pendingDeviceIds
    };
  }

  removeWorkspaceNow(tenant.id);
  await persistDb();
  return {
    deleted: true,
    releaseQueued: false,
    message: 'Workspace deleted.'
  };
}

export async function finalizeReleaseControlAcknowledgement(command: DeviceCommandRecord) {
  if (command.type !== 'RELEASE_CONTROL' || command.status !== 'ACKNOWLEDGED') {
    return;
  }

  const device = db.devices.find((item) => item.id === command.deviceId);
  if (!device) {
    return;
  }

  const scope = device.pendingDeletionScope;
  const parentId = device.pendingDeletionParentId;
  const shouldDelete = device.pendingDeletion;

  if (shouldDelete) {
    removeDeviceNow(device.id);

    if (scope === 'CUSTOMER' && parentId) {
      const customer = db.customers.find((item) => item.id === parentId);
      if (customer?.pendingDeletion && linkedDeviceIdsForCustomer(customer.id).size === 0) {
        removeCustomerNow(customer.id);
      }
    }

    if (scope === 'WORKSPACE' && parentId) {
      const tenant = db.tenants.find((item) => item.id === parentId);
      const remainingDevices = db.devices.filter((item) => item.tenantId === parentId);
      if (tenant?.pendingDeletion && remainingDevices.length === 0) {
        removeWorkspaceNow(parentId);
      }
    }
  } else {
    device.enrollmentStatus = 'SUSPENDED';
    device.state = 'RELEASED';
    device.adminLocked = false;
    device.adminUnlocked = false;
    device.restrictionReason = undefined;
    device.pushToken = undefined;
    device.deviceOwnerPackage = undefined;
    device.lostModeEnabled = false;
    device.lostModeMessage = undefined;
    device.locationRequestPending = false;
  }

  await persistDb();
}
