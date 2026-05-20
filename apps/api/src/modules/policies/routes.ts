import { Router } from 'express';
import { addAuditLog, db } from '../../db/mock-db.js';
import type { AuthRequest } from '../../middleware/auth.js';
import { getTenantIdFromAuth, scopeToTenant } from '../../services/tenancy.js';
import {
  getContractSummary,
  getDeviceSummary
} from '../contracts/ledger.js';
import {
  buildReminderPreview,
  getUpcomingInstallments,
  runInstallmentScheduler
} from '../../services/scheduler.js';
import { isDeviceSyncStale } from '../../services/device-health.js';

const router = Router();

router.get('/summary', (_req, res) => {
  const tenantId = getTenantIdFromAuth(_req as AuthRequest);
  const contracts = scopeToTenant(db.contracts, tenantId).map((contract) => getContractSummary(contract));
  const devices = scopeToTenant(db.devices, tenantId).map((device) => getDeviceSummary(device));
  const tenantDevices = scopeToTenant(db.devices, tenantId);

  res.json({
    customers: scopeToTenant(db.customers, tenantId).length,
    guarantors: scopeToTenant(db.guarantors, tenantId).length,
    contracts: scopeToTenant(db.contracts, tenantId).length,
    activeContracts: contracts.filter(
      (contract) => contract.status !== 'COMPLETED' && contract.status !== 'CANCELLED'
    ).length,
    payments: scopeToTenant(db.payments, tenantId).length,
    devices: tenantDevices.length,
    enrolledDevices: devices.filter((device) => device.enrollmentStatus === 'ENROLLED').length,
    staleDevices: tenantDevices.filter((device) => isDeviceSyncStale(device)).length,
    lateAccounts: contracts.filter(
      (contract) => contract.policyState === 'GRACE' || contract.policyState === 'RESTRICTED'
    ).length,
    restrictedDevices: devices.filter((device) => device.state === 'RESTRICTED').length,
    outstandingBalance: contracts.reduce((sum, contract) => sum + contract.remainingBalance, 0),
    pendingCommands: scopeToTenant(db.deviceCommands, tenantId).filter((command) => command.status !== 'ACKNOWLEDGED').length,
    queuedNotifications: scopeToTenant(db.notifications, tenantId).filter((notification) => notification.status === 'QUEUED').length,
    recentAuditLogs: scopeToTenant(db.auditLogs, tenantId).slice(0, 5),
    recentCommands: scopeToTenant(db.deviceCommands, tenantId).slice(0, 5),
    recentNotifications: scopeToTenant(db.notifications, tenantId).slice(0, 5),
    upcomingInstallments: getUpcomingInstallments(6, tenantId)
  });
});

router.post('/recompute', async (_req, res) => {
  const tenantId = getTenantIdFromAuth(_req as AuthRequest);
  const tenantContracts = scopeToTenant(db.contracts, tenantId);
  const before = tenantContracts.map((contract) => ({
    contractId: contract.id,
    status: contract.status,
    state: scopeToTenant(db.devices, tenantId).find((device) => device.id === contract.deviceId)?.state ?? 'ACTIVE'
  }));
  const scheduler = await runInstallmentScheduler(new Date(), tenantId);
  const after = tenantContracts.map((contract) => ({
    contractId: contract.id,
    deviceId: contract.deviceId,
    status: contract.status,
    state: scopeToTenant(db.devices, tenantId).find((device) => device.id === contract.deviceId)?.state ?? 'ACTIVE'
  }));

  for (const item of after) {
    const previous = before.find((candidate) => candidate.contractId === item.contractId);
    if (!previous || previous.status !== item.status || previous.state !== item.state) {
      addAuditLog({
        tenantId,
        actorUserId: 'system',
        actorName: 'System',
        action: 'POLICY_RECOMPUTED',
        entityType: 'POLICY',
        entityId: item.contractId,
        reason: 'Policy engine recomputed contract and device state',
        details: `Contract moved from ${previous?.status ?? 'n/a'} to ${item.status}; device moved from ${previous?.state ?? 'n/a'} to ${item.state}.`
      });
    }
  }

  res.json({ ...scheduler, results: after });
});

router.get('/late-customers', (_req, res) => {
  const tenantId = getTenantIdFromAuth(_req as AuthRequest);
  const late = scopeToTenant(db.contracts, tenantId)
    .map((contract) => getContractSummary(contract))
    .filter((item) => item.policyState === 'GRACE' || item.policyState === 'RESTRICTED')
    .map((item) => ({
      contractId: item.id,
      deviceId: item.deviceId,
      customerName: item.customerName,
      phone: item.customerPhone,
      deviceModel: item.deviceModel,
      state: item.policyState,
      manualUnlockUntil: scopeToTenant(db.devices, tenantId).find((device) => device.id === item.deviceId)?.manualUnlockUntil,
      manualUnlockReason: scopeToTenant(db.devices, tenantId).find((device) => device.id === item.deviceId)?.manualUnlockReason,
      dueDayOfMonth: item.dueDayOfMonth,
      monthlyInstallment: item.monthlyInstallment,
      totalPaid: item.totalPaid,
      financedAmount: item.financedAmount,
      remainingBalance: item.remainingBalance,
      nextDueDate: item.nextDueDate,
      overdueInstallments: item.overdueInstallments
    }));

  res.json(late);
});

router.get('/reminders', (_req, res) => {
  const tenantId = getTenantIdFromAuth(_req as AuthRequest);
  res.json({
    upcoming: buildReminderPreview(new Date(), tenantId),
    history: scopeToTenant(db.reminderEvents, tenantId).slice(0, 50)
  });
});

export default router;
