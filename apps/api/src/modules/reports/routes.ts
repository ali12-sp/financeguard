import { Router } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { buildPortfolioReport } from '../../services/reporting.js';
import { getTenantIdFromAuth } from '../../services/tenancy.js';

const router = Router();

router.get('/portfolio', (req, res) => {
  const tenantId = getTenantIdFromAuth(req as AuthRequest);
  res.json(buildPortfolioReport(tenantId));
});

export default router;

