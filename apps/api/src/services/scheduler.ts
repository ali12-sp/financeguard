import {
  addReminderEvent,
  db,
  persistDb,
  type NotificationChannel,
  type ReminderStage
} from '../db/mock-db.js';
import {
  deriveContractStatus,
  evaluatePolicy,
  getContractInstallments,
  getNextUnpaidInstallment
} from '../modules/contracts/ledger.js';
import { applyDeviceStateChange, issueDeviceCommand } from './device-control.js';
import { sendSmsReminder } from './notifications.js';
import { scopeToTenant } from './tenancy.js';

export interface SchedulerStatus {
  lastRunStartedAt: string | null;
  lastRunCompletedAt: string | null;
  lastRunSucceededAt: string | null;
  lastRunError: string | null;
  lastRunSummary: {
    processedContracts: number;
    remindersQueued: number;
    autoLocks: number;
    autoUnlocks: number;
  } | null;
}

let lastRunStartedAt: string | null = null;
let lastRunCompletedAt: string | null = null;
let lastRunSucceededAt: string | null = null;
let lastRunError: string | null = null;
let lastRunSummary: SchedulerStatus['lastRunSummary'] = null;

function parseDateOnly(value: string) {
  return new Date(`${value}T00:00:00Z`);
}

function toDayIndex(date: Date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function diffInDays(left: Date, right: Date) {
  return Math.floor((toDayIndex(left) - toDayIndex(right)) / 86400000);
}

function reminderStageForDaysUntilDue(daysUntilDue: number): ReminderStage | null {
  if (daysUntilDue === 5) return 'FIVE_DAYS';
  if (daysUntilDue === 2) return 'TWO_DAYS';
  if (daysUntilDue === 0) return 'DUE_TODAY';
  return null;
}

function reminderMessage(stage: ReminderStage, amountDue: number, dueDate: string) {
  const formattedAmount = `Rs. ${amountDue.toLocaleString('en-PK')}`;
  if (stage === 'FIVE_DAYS') {
    return `Reminder: your installment of ${formattedAmount} is due in 5 days on ${dueDate}.`;
  }
  if (stage === 'TWO_DAYS') {
    return `Reminder: your installment of ${formattedAmount} is due in 2 days on ${dueDate}.`;
  }
  return `Payment due today: please pay ${formattedAmount} today (${dueDate}) to avoid device restriction.`;
}

function hasReminderBeenRecorded(installmentId: string, stage: ReminderStage) {
  return db.reminderEvents.some(
    (item) => item.installmentId === installmentId && item.stage === stage
  );
}

export async function runInstallmentScheduler(now = new Date(), tenantId?: string) {
  lastRunStartedAt = new Date().toISOString();
  lastRunError = null;
  let remindersQueued = 0;
  let autoLocks = 0;
  let autoUnlocks = 0;

  try {
    const tenantContracts = scopeToTenant(db.contracts, tenantId);

    for (const contract of tenantContracts) {
      const device = scopeToTenant(db.devices, contract.tenantId).find((item) => item.id === contract.deviceId) ?? null;
      const customer = scopeToTenant(db.customers, contract.tenantId).find((item) => item.id === contract.customerId) ?? null;
      const nextInstallment = getNextUnpaidInstallment(contract.id, contract.tenantId);
      const desiredState = evaluatePolicy(contract, now);
      const desiredStatus = deriveContractStatus(contract, now);

      if (nextInstallment && customer) {
        const daysUntilDue = diffInDays(parseDateOnly(nextInstallment.dueDate), now);
        const stage = reminderStageForDaysUntilDue(daysUntilDue);

        if (stage && !hasReminderBeenRecorded(nextInstallment.id, stage)) {
          const message = reminderMessage(stage, nextInstallment.amountDue, nextInstallment.dueDate);
          const channels: NotificationChannel[] = [];

          if (customer.phone) {
            await sendSmsReminder({
              tenantId: contract.tenantId,
              phone: customer.phone,
              customerId: customer.id,
              contractId: contract.id,
              message,
              template: `reminder:${stage.toLowerCase()}`
            });
            channels.push('SMS');
          }

          if (device) {
            await issueDeviceCommand({
              deviceId: device.id,
              contractId: contract.id,
              type: 'REMINDER',
              reason: message,
              source: 'SCHEDULER',
              payload: {
                stage,
                dueDate: nextInstallment.dueDate,
                amountDue: nextInstallment.amountDue
              }
            });
            channels.push('FCM');
          }

          addReminderEvent({
            tenantId: contract.tenantId,
            contractId: contract.id,
            installmentId: nextInstallment.id,
            customerId: customer.id,
            deviceId: device?.id ?? '',
            stage,
            channels: channels.length > 0 ? channels : ['SYSTEM']
          });
          remindersQueued += 1;
        }
      }

      contract.status = desiredStatus;

      if (!device) {
        continue;
      }

      if (device.adminLocked) {
        await persistDb();
        continue;
      }

      if (device.adminUnlocked && desiredState !== 'ACTIVE' && desiredState !== 'RELEASED') {
        device.state = 'ACTIVE';
        device.restrictionReason = undefined;
        await persistDb();
        continue;
      }

      if (device.adminUnlocked && (desiredState === 'ACTIVE' || desiredState === 'RELEASED')) {
        device.adminUnlocked = false;
      }

      const previousState = device.state;
      if (previousState === desiredState) {
        if (desiredState !== 'RESTRICTED') {
          device.restrictionReason = undefined;
        }
        await persistDb();
        continue;
      }

      if (desiredState === 'RESTRICTED') {
        await applyDeviceStateChange({
          deviceId: device.id,
          nextState: 'RESTRICTED',
          reason: 'Auto-lock: installment is overdue beyond the grace period.',
          source: 'SCHEDULER',
          actor: { id: 'system', name: 'System' },
          lockMessage: 'Installment overdue. Pay your account to restore access.'
        });
        autoLocks += 1;
        continue;
      }

      if (desiredState === 'RELEASED' || (previousState === 'RESTRICTED' && desiredState === 'ACTIVE')) {
        await applyDeviceStateChange({
          deviceId: device.id,
          nextState: desiredState,
          reason:
            desiredState === 'RELEASED'
              ? 'Installment plan completed. Device fully released.'
              : 'Payment is up to date. Device access restored.',
          source: 'SCHEDULER',
          actor: { id: 'system', name: 'System' }
        });
        autoUnlocks += 1;
        continue;
      }

      device.state = desiredState;
      device.restrictionReason = undefined;
      await persistDb();
    }

    const summary = {
      processedContracts: tenantContracts.length,
      remindersQueued,
      autoLocks,
      autoUnlocks
    };
    lastRunSummary = summary;
    lastRunSucceededAt = new Date().toISOString();
    return summary;
  } catch (error) {
    lastRunError = error instanceof Error ? error.message : 'Unknown scheduler error';
    throw error;
  } finally {
    lastRunCompletedAt = new Date().toISOString();
  }
}

export function buildReminderPreview(now = new Date(), tenantId?: string) {
  return scopeToTenant(db.contracts, tenantId)
    .map((contract) => {
      const customer = scopeToTenant(db.customers, contract.tenantId).find((item) => item.id === contract.customerId);
      const device = scopeToTenant(db.devices, contract.tenantId).find((item) => item.id === contract.deviceId);
      const installment = getNextUnpaidInstallment(contract.id, contract.tenantId);
      if (!installment || !customer) return null;

      const daysUntilDue = diffInDays(parseDateOnly(installment.dueDate), now);
      const stage = reminderStageForDaysUntilDue(daysUntilDue);
      if (!stage) return null;

      return {
        contractId: contract.id,
        installmentId: installment.id,
        customerName: customer.fullName,
        customerPhone: customer.phone,
        deviceModel: device?.modelName ?? '-',
        stage,
        dueDate: installment.dueDate,
        amountDue: installment.amountDue,
        alreadyQueued: hasReminderBeenRecorded(installment.id, stage)
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
}

export function getUpcomingInstallments(limit = 10, tenantId?: string) {
  return scopeToTenant(db.contracts, tenantId)
    .map((contract) => {
      const customer = scopeToTenant(db.customers, contract.tenantId).find((item) => item.id === contract.customerId);
      const device = scopeToTenant(db.devices, contract.tenantId).find((item) => item.id === contract.deviceId);
      const installment = getNextUnpaidInstallment(contract.id, contract.tenantId);
      if (!installment || !customer) return null;

      return {
        contractId: contract.id,
        customerName: customer.fullName,
        deviceModel: device?.modelName ?? '-',
        dueDate: installment.dueDate,
        amountDue: installment.amountDue,
        sequenceNumber: installment.sequenceNumber
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((left, right) => left.dueDate.localeCompare(right.dueDate))
    .slice(0, limit);
}

export function getSchedulerStatus(): SchedulerStatus {
  return {
    lastRunStartedAt,
    lastRunCompletedAt,
    lastRunSucceededAt,
    lastRunError,
    lastRunSummary
  };
}
