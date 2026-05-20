import express, { type NextFunction, type Request, type Response } from 'express';
import cors, { type CorsOptions } from 'cors';
import morgan from 'morgan';
import { env } from './config/env.js';
import { createBackupSnapshot, getPersistenceStatus } from './db/mock-db.js';
import authRoutes from './modules/auth/routes.js';
import setupRoutes from './modules/setup/routes.js';
import platformRoutes from './modules/platform/routes.js';
import customerRoutes from './modules/customers/routes.js';
import guarantorRoutes from './modules/guarantors/routes.js';
import deviceRoutes from './modules/devices/routes.js';
import contractRoutes from './modules/contracts/routes.js';
import paymentRoutes from './modules/payments/routes.js';
import auditLogRoutes from './modules/audit-logs/routes.js';
import policyRoutes from './modules/policies/routes.js';
import agentRoutes from './modules/agent/routes.js';
import portalRoutes from './modules/portal/routes.js';
import reportRoutes from './modules/reports/routes.js';
import exportRoutes from './modules/exports/routes.js';
import {
  requireAuth,
  requirePasswordChangeSatisfied,
  requirePlatformOwner,
  requireStaffAccess
} from './middleware/auth.js';
import { createRateLimiter } from './middleware/rate-limit.js';
import { securityHeaders } from './middleware/security.js';
import { getSchedulerStatus, runInstallmentScheduler } from './services/scheduler.js';
import { getMetricsSnapshot, recordHttpRequest, renderPrometheusMetrics } from './services/metrics.js';

const app = express();

const corsOptions: CorsOptions = {
  origin(origin, callback) {
    if (!origin || env.corsAllowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error(`Origin not allowed: ${origin}`));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type'],
  maxAge: 86400
};

app.disable('x-powered-by');
app.set('trust proxy', env.nodeEnv === 'production' ? 1 : 0);
app.use(cors(corsOptions));
app.use(securityHeaders);
app.use(morgan('dev'));
app.use(express.json({ limit: env.bodySizeLimit }));
app.use((req, res, next) => {
  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const route = req.route?.path
      ? `${req.baseUrl || ''}${req.route.path}`
      : req.path;
    recordHttpRequest(req.method, route, res.statusCode, durationMs);
  });
  next();
});
app.use('/api', createRateLimiter({
  keyPrefix: 'api',
  windowMs: env.rateLimitWindowMs,
  max: env.rateLimitMax
}));
app.use('/api/auth', createRateLimiter({
  keyPrefix: 'auth',
  windowMs: env.authRateLimitWindowMs,
  max: env.authRateLimitMax
}));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'financeguard-api',
    time: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    persistence: getPersistenceStatus(),
    scheduler: getSchedulerStatus()
  });
});

app.get('/api/health/ready', (_req, res) => {
  const persistence = getPersistenceStatus();
  const ready = Boolean(persistence.lastPersistedAt);
  res.status(ready ? 200 : 503).json({
    ok: ready,
    persistence,
    scheduler: getSchedulerStatus()
  });
});

app.get('/api/metrics', requireAuth, requirePasswordChangeSatisfied, requirePlatformOwner, (_req, res) => {
  res.json(getMetricsSnapshot());
});

app.get('/api/metrics/prometheus', requireAuth, requirePasswordChangeSatisfied, requirePlatformOwner, (_req, res) => {
  res.type('text/plain').send(renderPrometheusMetrics());
});

app.use('/api/auth', authRoutes);
app.use('/api/setup', setupRoutes);
app.use('/api/platform', requireAuth, requirePasswordChangeSatisfied, requirePlatformOwner, platformRoutes);
app.use('/api/agent', agentRoutes);
app.use('/api/portal', requireAuth, requirePasswordChangeSatisfied, portalRoutes);
app.use('/api/customers', requireAuth, requirePasswordChangeSatisfied, requireStaffAccess, customerRoutes);
app.use('/api/guarantors', requireAuth, requirePasswordChangeSatisfied, requireStaffAccess, guarantorRoutes);
app.use('/api/devices', requireAuth, requirePasswordChangeSatisfied, requireStaffAccess, deviceRoutes);
app.use('/api/contracts', requireAuth, requirePasswordChangeSatisfied, requireStaffAccess, contractRoutes);
app.use('/api/payments', requireAuth, requirePasswordChangeSatisfied, requireStaffAccess, paymentRoutes);
app.use('/api/audit-logs', requireAuth, requirePasswordChangeSatisfied, requireStaffAccess, auditLogRoutes);
app.use('/api/policies', requireAuth, requirePasswordChangeSatisfied, requireStaffAccess, policyRoutes);
app.use('/api/reports', requireAuth, requirePasswordChangeSatisfied, requireStaffAccess, reportRoutes);
app.use('/api/exports', requireAuth, requirePasswordChangeSatisfied, requireStaffAccess, exportRoutes);

app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  if (error.message.startsWith('Origin not allowed:')) {
    return res.status(403).json({ message: error.message });
  }

  console.error('Unhandled server error', error);
  return res.status(500).json({ message: 'Internal server error' });
});

app.listen(env.port, () => {
  console.log(`FinanceGuard API running on http://localhost:${env.port}`);
});

if (env.runBackgroundJobs) {
  runInstallmentScheduler().catch((error) => {
    console.error('Initial scheduler run failed', error);
  });

  setInterval(() => {
    runInstallmentScheduler().catch((error) => {
      console.error('Scheduled reminder run failed', error);
    });
  }, env.schedulerIntervalMs);

  if (env.backupIntervalMs > 0) {
    setInterval(() => {
      createBackupSnapshot().catch((error) => {
        console.error('Scheduled backup run failed', error);
      });
    }, env.backupIntervalMs);
  }
}
