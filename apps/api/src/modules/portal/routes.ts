import { Router } from 'express';
import { db } from '../../db/mock-db.js';
import { requireCustomerAccess, type AuthRequest } from '../../middleware/auth.js';
import { scopeToTenant } from '../../services/tenancy.js';
import { getCustomerDetail, getPaymentSummary } from '../contracts/ledger.js';

const router = Router();

router.use(requireCustomerAccess);

router.get('/summary', (req, res) => {
  const authUser = (req as AuthRequest).user;
  const customerId = authUser?.customerId;
  const tenantId = authUser?.tenantId;

  if (!customerId || !tenantId) {
    return res.status(400).json({ message: 'Customer account is not linked correctly' });
  }

  const user = scopeToTenant(db.users, tenantId).find((item) => item.id === authUser.id) ?? null;
  const customer = getCustomerDetail(customerId, new Date(), tenantId);

  if (!customer) {
    return res.status(404).json({ message: 'Customer profile not found' });
  }

  const activeContracts = customer.contracts.filter(
    (contract) => contract.status !== 'COMPLETED' && contract.status !== 'CANCELLED'
  );

  const latestContract = activeContracts[0] ?? customer.contracts[0] ?? null;
  const latestDevice = customer.devices[0] ?? null;

  return res.json({
    user: user
      ? {
          id: user.id,
          name: user.name,
          phone: user.phone,
          role: user.role,
          customerId: user.customerId
        }
      : null,
    customer,
    activeContract: latestContract,
    activeDevice: latestDevice,
    nextPaymentDate: latestContract?.nextDueDate ?? null,
    nextPaymentAmount: latestContract?.monthlyInstallment ?? 0,
    remainingBalance: customer.remainingBalance,
    restricted: latestContract?.policyState === 'RESTRICTED'
  });
});

router.get('/payments', (req, res) => {
  const customerId = (req as AuthRequest).user?.customerId;
  const tenantId = (req as AuthRequest).user?.tenantId;

  if (!customerId || !tenantId) {
    return res.status(400).json({ message: 'Customer account is not linked correctly' });
  }

  const rows = scopeToTenant(db.payments, tenantId)
    .filter((item) => {
      const contract = scopeToTenant(db.contracts, tenantId).find((contractRow) => contractRow.id === item.contractId);
      return contract?.customerId === customerId;
    })
    .map((item) => getPaymentSummary(item));

  res.json(rows);
});

export default router;
