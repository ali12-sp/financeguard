import { Router } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { buildPortfolioReport } from '../../services/reporting.js';
import { getTenantIdFromAuth, scopeToTenant } from '../../services/tenancy.js';
import { db } from '../../db/mock-db.js';
import { getContractSummary } from '../contracts/ledger.js';
import { getSchedulerStatus } from '../../services/scheduler.js';
import { getNotificationQueueStats } from '../../services/notifications.js';
import { isDeviceSyncStale } from '../../services/device-health.js';

const router = Router();

router.get('/portfolio', (req, res) => {
  const tenantId = getTenantIdFromAuth(req as AuthRequest);
  res.json(buildPortfolioReport(tenantId));
});

/**
 * GET /api/reports/dashboard
 * Lightweight summary for the admin dashboard home screen.
 * Returns only the key numbers — fast to compute.
 */
router.get('/dashboard', (req, res) => {
  const tenantId = getTenantIdFromAuth(req as AuthRequest);
  const now = new Date();
  const in7days = new Date(now.getTime() + 7 * 86400000).toISOString().slice(0, 10);

  const contracts = scopeToTenant(db.contracts, tenantId);
  const devices   = scopeToTenant(db.devices, tenantId);
  const customers = scopeToTenant(db.customers, tenantId);
  const payments  = scopeToTenant(db.payments, tenantId);
  const auditLogs = scopeToTenant(db.auditLogs, tenantId);

  const contractSummaries = contracts.map((c) => getContractSummary(c, now));
  const activeContracts = contractSummaries.filter(
    (c) => c.status !== 'COMPLETED' && c.status !== 'CANCELLED'
  );
  const restrictedToday = devices.filter((d) => d.state === 'RESTRICTED').length;
  const overdueBalance = contractSummaries
    .filter((c) => c.policyState === 'RESTRICTED' || c.policyState === 'GRACE')
    .reduce((sum, c) => sum + c.remainingBalance, 0);

  // Upcoming payments within the next 7 days
  const upcomingInstallments = scopeToTenant(db.installments, tenantId)
    .filter((inst) => {
      if (inst.amountPaid >= inst.amountDue) return false;
      return inst.dueDate >= now.toISOString().slice(0, 10) && inst.dueDate <= in7days;
    })
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 10)
    .map((inst) => {
      const contract = contracts.find((c) => c.id === inst.contractId);
      const customer = contract
        ? customers.find((cu) => cu.id === contract.customerId)
        : null;
      const device = contract
        ? devices.find((d) => d.id === contract.deviceId)
        : null;
      return {
        installmentId: inst.id,
        contractId: inst.contractId,
        dueDate: inst.dueDate,
        amountDue: inst.amountDue,
        customerName: customer?.fullName ?? 'Unknown',
        customerPhone: customer?.phone ?? '',
        deviceModel: device?.modelName ?? '-'
      };
    });

  // Recent audit events
  const recentEvents = auditLogs
    .slice(0, 5)
    .map((log) => ({
      id: log.id,
      action: log.action,
      actorName: log.actorName,
      entityType: log.entityType,
      entityId: log.entityId,
      reason: log.reason,
      createdAt: log.createdAt
    }));

  const thisMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const collectionsThisMonth = payments
    .filter((p) => p.receivedAt >= thisMonthStart)
    .reduce((sum, p) => sum + p.receivedAmount, 0);

  res.json({
    generatedAt: now.toISOString(),
    totals: {
      customers: customers.length,
      activeContracts: activeContracts.length,
      restrictedDevices: restrictedToday,
      staleDevices: devices.filter((d) => isDeviceSyncStale(d)).length,
      overdueBalance,
      collectionsThisMonth,
      pendingCommands: db.deviceCommands.filter(
        (cmd) => cmd.tenantId === tenantId && (cmd.status === 'PENDING' || cmd.status === 'SENT')
      ).length
    },
    notificationQueue: getNotificationQueueStats(),
    schedulerStatus: getSchedulerStatus(),
    upcomingPayments: upcomingInstallments,
    recentEvents
  });
});

export default router;

