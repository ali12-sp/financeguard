import {
  addAuditLog,
  addDeviceCommand,
  addNotification,
  db,
  persistDb,
  type DeviceCommandRecord,
  type DeviceCommandType,
  type DeviceState,
  type JsonPayload
} from '../db/mock-db.js';
import { getRemainingBalance } from '../modules/contracts/ledger.js';
import { sendFcmDataMessage } from './fcm.js';

const STATE_COMMAND_TYPES = new Set<DeviceCommandType>([
  'LOCK',
  'UNLOCK',
  'RELEASE_CONTROL'
]);
const RECOVERY_MODE_COMMAND_TYPES = new Set<DeviceCommandType>([
  'ENABLE_LOST_MODE',
  'DISABLE_LOST_MODE'
]);

export interface ActorInfo {
  id?: string;
  name?: string;
  email?: string;
}

function getActor(actor?: ActorInfo) {
  return {
    id: actor?.id ?? 'system',
    name: actor?.name ?? actor?.email ?? 'System'
  };
}

function updateLinkedContract(deviceId: string, nextState: DeviceState) {
  const contract = db.contracts.find((item) => item.deviceId === deviceId);
  if (!contract) return null;

  if (nextState === 'RESTRICTED') {
    contract.status = 'RESTRICTED';
  } else if (nextState === 'RELEASED' && getRemainingBalance(contract) <= 0) {
    contract.status = 'COMPLETED';
  } else if (nextState === 'GRACE' || nextState === 'REMINDER') {
    contract.status = 'LATE';
  } else if (contract.status !== 'CANCELLED') {
    contract.status = 'ACTIVE';
  }

  return contract;
}

function auditActionForState(nextState: DeviceState) {
  if (nextState === 'RESTRICTED') return 'DEVICE_RESTRICTED' as const;
  if (nextState === 'RELEASED') return 'DEVICE_RELEASED' as const;
  return 'DEVICE_UNLOCKED' as const;
}

function commandTypeForState(nextState: DeviceState): DeviceCommandType | null {
  if (nextState === 'RESTRICTED') return 'LOCK';
  if (nextState === 'RELEASED') return 'RELEASE_CONTROL';
  if (nextState === 'ACTIVE') return 'UNLOCK';
  return null;
}

function isStateCommand(command: Pick<DeviceCommandRecord, 'type'>) {
  return STATE_COMMAND_TYPES.has(command.type);
}

function isRecoveryModeCommand(command: Pick<DeviceCommandRecord, 'type'>) {
  return RECOVERY_MODE_COMMAND_TYPES.has(command.type);
}

function commandSequence(commandId: string) {
  const match = commandId.match(/^cmd(\d+)$/);
  return match ? Number(match[1]) : null;
}

function compareDeviceCommands(left: DeviceCommandRecord, right: DeviceCommandRecord) {
  const createdAtOrder = left.createdAt.localeCompare(right.createdAt);
  if (createdAtOrder !== 0) {
    return createdAtOrder;
  }

  const leftSequence = commandSequence(left.id);
  const rightSequence = commandSequence(right.id);
  if (leftSequence !== null && rightSequence !== null && leftSequence !== rightSequence) {
    return leftSequence - rightSequence;
  }

  return left.id.localeCompare(right.id);
}

function getLatestStateCommandForDevice(deviceId: string) {
  return db.deviceCommands
    .filter((item) => item.deviceId === deviceId && isStateCommand(item))
    .slice()
    .sort(compareDeviceCommands)
    .at(-1) ?? null;
}

function getLatestRecoveryModeCommandForDevice(deviceId: string) {
  return db.deviceCommands
    .filter((item) => item.deviceId === deviceId && isRecoveryModeCommand(item))
    .slice()
    .sort(compareDeviceCommands)
    .at(-1) ?? null;
}

function supersedeOlderCommands(
  deviceId: string,
  supersedingCommand: DeviceCommandRecord,
  commandSet: Set<DeviceCommandType>
) {
  if (!commandSet.has(supersedingCommand.type)) {
    return false;
  }

  let changed = false;
  const now = new Date().toISOString();

  for (const command of db.deviceCommands) {
    if (
      command.deviceId !== deviceId ||
      command.id === supersedingCommand.id ||
      command.status === 'ACKNOWLEDGED' ||
      command.status === 'FAILED' ||
      !commandSet.has(command.type) ||
      compareDeviceCommands(command, supersedingCommand) > 0
    ) {
      continue;
    }

    command.status = 'ACKNOWLEDGED';
    command.acknowledgedAt = now;
    command.responseNote = `Superseded by ${supersedingCommand.id}.`;
    changed = true;
  }

  return changed;
}

function supersedeOlderExclusiveCommands(deviceId: string, supersedingCommand: DeviceCommandRecord) {
  const stateChanged = supersedeOlderCommands(deviceId, supersedingCommand, STATE_COMMAND_TYPES);
  const recoveryChanged = supersedeOlderCommands(deviceId, supersedingCommand, RECOVERY_MODE_COMMAND_TYPES);
  return stateChanged || recoveryChanged;
}

function toFcmPayload(command: DeviceCommandRecord) {
  const payload: Record<string, string> = {
    commandId: command.id,
    type: command.type,
    reason: command.reason,
    createdAt: command.createdAt
  };

  if (command.lockMessage) {
    payload.lockMessage = command.lockMessage;
  }

  for (const [key, value] of Object.entries(command.payload ?? {})) {
    payload[key] = value === null ? '' : String(value);
  }

  return payload;
}

export async function issueDeviceCommand(options: {
  deviceId: string;
  contractId?: string;
  type: DeviceCommandType;
  reason: string;
  source: DeviceCommandRecord['source'];
  lockMessage?: string;
  payload?: JsonPayload;
}) {
  const device = db.devices.find((item) => item.id === options.deviceId);
  if (!device) {
    throw new Error('Device not found');
  }

  const command = addDeviceCommand({
    ...options,
    tenantId: device.tenantId
  });
  supersedeOlderExclusiveCommands(device.id, command);
  device.lastCommandId = command.id;
  await persistDb();

  if (!device.pushToken) {
    addNotification({
      tenantId: device.tenantId,
      channel: 'FCM',
      status: 'SKIPPED',
      recipient: device.uniqueId ?? device.serial,
      deviceId: device.id,
      contractId: options.contractId,
      message: options.reason,
      template: `command:${options.type}`,
      providerResponse: 'Device has no FCM registration token.'
    });
    return command;
  }

  try {
    const result = await sendFcmDataMessage(device.pushToken, toFcmPayload(command));
    addNotification({
      tenantId: device.tenantId,
      channel: 'FCM',
      status: result.ok ? 'SENT' : result.skipped ? 'SKIPPED' : 'FAILED',
      recipient: device.pushToken,
      deviceId: device.id,
      contractId: options.contractId,
      message: options.reason,
      template: `command:${options.type}`,
      providerResponse: result.providerResponse,
      sentAt: result.ok ? new Date().toISOString() : undefined
    });

    if (result.ok) {
      command.status = 'SENT';
      command.sentAt = new Date().toISOString();
      await persistDb();
    }
  } catch (error) {
    addNotification({
      tenantId: device.tenantId,
      channel: 'FCM',
      status: 'FAILED',
      recipient: device.pushToken,
      deviceId: device.id,
      contractId: options.contractId,
      message: options.reason,
      template: `command:${options.type}`,
      providerResponse: error instanceof Error ? error.message : 'Unknown FCM error'
    });
  }

  return command;
}

export async function applyDeviceStateChange(options: {
  deviceId: string;
  nextState: DeviceState;
  reason: string;
  source: DeviceCommandRecord['source'];
  actor?: ActorInfo;
  lockMessage?: string;
}) {
  const device = db.devices.find((item) => item.id === options.deviceId);
  if (!device) {
    throw new Error('Device not found');
  }

  const actor = getActor(options.actor);
  const previousState = device.state;
  const contract = updateLinkedContract(device.id, options.nextState);

  device.state = options.nextState;
  device.manualUnlockUntil = undefined;
  device.manualUnlockReason = undefined;
  if (options.source === 'ADMIN') {
    device.adminLocked = options.nextState === 'RESTRICTED';
    device.adminUnlocked = options.nextState !== 'RESTRICTED';
  } else if (options.nextState !== 'RESTRICTED') {
    device.adminLocked = false;
    device.adminUnlocked = false;
  } else {
    device.adminUnlocked = false;
  }
  device.restrictionReason =
    options.nextState === 'RESTRICTED' ? options.reason : undefined;

  addAuditLog({
    tenantId: device.tenantId,
    actorUserId: actor.id,
    actorName: actor.name,
    action: auditActionForState(options.nextState),
    entityType: 'DEVICE',
    entityId: device.id,
    reason: options.reason,
    details: `Device state changed from ${previousState} to ${options.nextState}.`
  });

  await persistDb();

  const commandType = commandTypeForState(options.nextState);
  const command =
    commandType
      ? await issueDeviceCommand({
          deviceId: device.id,
          contractId: contract?.id,
          type: commandType,
          reason: options.reason,
          source: options.source,
          lockMessage: options.lockMessage
        })
      : null;

  return { device, contract, command };
}

export async function applyManualUnlockOverride(options: {
  deviceId: string;
  reason: string;
  actor?: ActorInfo;
  hours?: number;
}) {
  const device = db.devices.find((item) => item.id === options.deviceId);
  if (!device) {
    throw new Error('Device not found');
  }

  const actor = getActor(options.actor);
  const previousState = device.state;
  const contract = db.contracts.find((item) => item.deviceId === device.id) ?? null;
  const hours = options.hours ?? 24;
  const manualUnlockUntil = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();

  device.state = 'ACTIVE';
  device.adminLocked = false;
  device.adminUnlocked = true;
  device.restrictionReason = undefined;
  device.manualUnlockUntil = manualUnlockUntil;
  device.manualUnlockReason = options.reason;

  addAuditLog({
    tenantId: device.tenantId,
    actorUserId: actor.id,
    actorName: actor.name,
    action: 'MANUAL_OVERRIDE',
    entityType: 'DEVICE',
    entityId: device.id,
    reason: options.reason,
    details: `Manual unlock override changed device state from ${previousState} to ACTIVE until ${manualUnlockUntil}.`
  });

  await persistDb();

  const command = await issueDeviceCommand({
    deviceId: device.id,
    contractId: contract?.id,
    type: 'UNLOCK',
    reason: `Manual unlock override until ${manualUnlockUntil}: ${options.reason}`,
    source: 'ADMIN'
  });

  return { device, contract, command, manualUnlockUntil };
}

export function getPendingCommandsForDevice(deviceId: string) {
  const latestStateCommand = getLatestStateCommandForDevice(deviceId);
  const latestRecoveryModeCommand = getLatestRecoveryModeCommandForDevice(deviceId);

  return db.deviceCommands
    .filter((item) =>
      item.deviceId === deviceId &&
      (item.status === 'PENDING' || item.status === 'SENT') &&
      (!isStateCommand(item) || item.id === latestStateCommand?.id) &&
      (!isRecoveryModeCommand(item) || item.id === latestRecoveryModeCommand?.id)
    )
    .slice()
    .sort(compareDeviceCommands);
}

export async function acknowledgeDeviceCommand(options: {
  commandId: string;
  deviceId: string;
  note?: string;
  success: boolean;
}) {
  const command = db.deviceCommands.find(
    (item) => item.id === options.commandId && item.deviceId === options.deviceId
  );
  if (!command) {
    throw new Error('Command not found');
  }

  command.status = options.success ? 'ACKNOWLEDGED' : 'FAILED';
  command.acknowledgedAt = new Date().toISOString();
  command.responseNote = options.note;
  await persistDb();
  return command;
}
