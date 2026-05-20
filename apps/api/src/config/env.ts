import 'dotenv/config';

function parseOrigins(value?: string) {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 4000),
  jwtSecret: process.env.JWT_SECRET || 'change-me',
  publicApiUrl: process.env.PUBLIC_API_URL || `http://localhost:${Number(process.env.PORT || 4000)}`,
  persistenceEngine:
    process.env.PERSISTENCE_ENGINE === 'postgres' || process.env.DATABASE_URL
      ? 'postgres'
      : 'sqlite',
  databaseUrl: process.env.DATABASE_URL || '',
  databaseSslMode: process.env.DATABASE_SSL_MODE || 'disable',
  schedulerIntervalMs: Number(process.env.SCHEDULER_INTERVAL_MS || 60 * 60 * 1000),
  backupIntervalMs: Number(process.env.BACKUP_INTERVAL_MS || 6 * 60 * 60 * 1000),
  notificationDispatchIntervalMs: Number(process.env.NOTIFICATION_DISPATCH_INTERVAL_MS || 30 * 1000),
  bodySizeLimit: process.env.BODY_SIZE_LIMIT || '1mb',
  runBackgroundJobs: process.env.RUN_BACKGROUND_JOBS !== 'false',
  corsAllowedOrigins: parseOrigins(process.env.CORS_ALLOWED_ORIGINS).length > 0
    ? parseOrigins(process.env.CORS_ALLOWED_ORIGINS)
    : ['http://localhost:3000', 'http://127.0.0.1:3000'],
  rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60 * 1000),
  rateLimitMax: Number(process.env.RATE_LIMIT_MAX || 300),
  authRateLimitWindowMs: Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  authRateLimitMax: Number(process.env.AUTH_RATE_LIMIT_MAX || 15),
  smsWebhookUrl: process.env.SMS_WEBHOOK_URL || '',
  smsApiKey: process.env.SMS_API_KEY || '',
  smsSenderId: process.env.SMS_SENDER_ID || 'FinanceGuard',
  emailWebhookUrl: process.env.EMAIL_WEBHOOK_URL || '',
  emailApiKey: process.env.EMAIL_API_KEY || '',
  emailSender: process.env.EMAIL_SENDER || 'alerts@financeguard.local',
  whatsappWebhookUrl: process.env.WHATSAPP_WEBHOOK_URL || '',
  whatsappApiKey: process.env.WHATSAPP_API_KEY || '',
  whatsappSenderId: process.env.WHATSAPP_SENDER_ID || 'FinanceGuard',
  fcmProjectId: process.env.FCM_PROJECT_ID || '',
  fcmClientEmail: process.env.FCM_CLIENT_EMAIL || '',
  fcmPrivateKey: (process.env.FCM_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
};

if (env.nodeEnv === 'production') {
  const issues: string[] = [];

  if (env.jwtSecret === 'change-me') {
    issues.push('JWT_SECRET must be changed for production.');
  }

  if (env.jwtSecret.includes('replace-with')) {
    issues.push('JWT_SECRET must not use the example placeholder value.');
  }

  if (env.jwtSecret.length < 32) {
    issues.push('JWT_SECRET must be at least 32 characters for production.');
  }

  if (!env.publicApiUrl.startsWith('https://')) {
    issues.push('PUBLIC_API_URL must use HTTPS for production.');
  }

  if (env.corsAllowedOrigins.includes('http://localhost:3000')) {
    issues.push('CORS_ALLOWED_ORIGINS must be set explicitly for production.');
  }

  if (env.persistenceEngine !== 'postgres') {
    issues.push('PERSISTENCE_ENGINE=postgres is required for production.');
  }

  if (env.persistenceEngine === 'postgres' && !env.databaseUrl) {
    issues.push('DATABASE_URL must be set when PERSISTENCE_ENGINE=postgres.');
  }

  if (env.databaseUrl.includes('replace-with')) {
    issues.push('DATABASE_URL must not contain example placeholder credentials.');
  }

  if (!env.fcmProjectId || !env.fcmClientEmail || !env.fcmPrivateKey) {
    issues.push('FCM_PROJECT_ID, FCM_CLIENT_EMAIL, and FCM_PRIVATE_KEY are required for production device command delivery.');
  }

  if (
    env.fcmProjectId.includes('your-firebase') ||
    env.fcmClientEmail.includes('example.') ||
    env.fcmPrivateKey.includes('replace-with')
  ) {
    issues.push('Firebase service account values must not use example placeholders.');
  }

  if (issues.length > 0) {
    throw new Error(`Invalid production environment:\n- ${issues.join('\n- ')}`);
  }
}
